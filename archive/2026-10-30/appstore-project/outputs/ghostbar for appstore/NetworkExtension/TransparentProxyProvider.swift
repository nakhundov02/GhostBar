import Foundation
import Network
import NetworkExtension

@objc(GhostBarTransparentProxyProvider)
final class GhostBarTransparentProxyProvider: NETransparentProxyProvider {
    private let queue=DispatchQueue(label:"com.ghostbar.flows")
    private var relays:[UUID:FlowRelay]=[:]
    private var proxyPort:UInt16=0
    private var authorization=""
    private var excluded:Set<String>=[]
    private var ready=false
    override func startProxy(options:[String:Any]?=nil,completionHandler:@escaping(Error?)->Void) {
        guard let configuration=(protocolConfiguration as? NETunnelProviderProtocol)?.providerConfiguration,
              let port=configuration["proxyPort"] as? Int,port>0,port<65536,
              let password=configuration["proxyPassword"] as? String,password.count>=32 else {
            completionHandler(NSError(domain:"GhostBar",code:1,userInfo:[NSLocalizedDescriptionKey:"Missing proxy configuration."]));return
        }
        proxyPort=UInt16(port)
        authorization=Data("ghostbar:\(password)".utf8).base64EncodedString()
        excluded=Set(configuration["excludedIdentifiers"] as? [String] ?? [])
        let settings=NETransparentProxyNetworkSettings(tunnelRemoteAddress:"127.0.0.1")
        settings.includedNetworkRules=["0.0.0.0","::"].flatMap{host in ["80","443"].map{port in
            NENetworkRule(destinationNetwork:NWHostEndpoint(hostname:host,port:port),prefix:0,protocol:.TCP)
        }}
        setTunnelNetworkSettings(settings){ [weak self] error in
            self?.queue.async { self?.ready = error == nil;completionHandler(error) }
        }
    }
    override func handleNewFlow(_ flow:NEAppProxyFlow)->Bool {
        guard let tcp=flow as? NEAppProxyTCPFlow,let endpoint=tcp.remoteEndpoint as? NWHostEndpoint,
              ["80","443"].contains(endpoint.port),!excluded.contains(flow.metaData.sourceAppSigningIdentifier) else{return false}
        // Return false until configured. No security policy or browser-specific exceptions are altered.
        return queue.sync {
            guard ready,relays.count<256 else{return false}
            let id=UUID()
            let relay=FlowRelay(flow:tcp,host:endpoint.hostname,port:endpoint.port,proxyPort:proxyPort,authorization:authorization,queue:queue){ [weak self] in self?.relays.removeValue(forKey:id) }
            relays[id]=relay;relay.start();return true
        }
    }
    override func stopProxy(with reason:NEProviderStopReason,completionHandler:@escaping()->Void) {
        queue.async { [self] in ready=false;let current=Array(relays.values);current.forEach{$0.finish(nil)};relays.removeAll();completionHandler() }
    }
}

private final class FlowRelay {
    let flow:NEAppProxyTCPFlow
    let host:String,port:String,authorization:String
    let connection:NWConnection
    let queue:DispatchQueue
    let onClose:()->Void
    var closed=false,established=false
    init(flow:NEAppProxyTCPFlow,host:String,port:String,proxyPort:UInt16,authorization:String,queue:DispatchQueue,onClose:@escaping()->Void) {
        self.flow=flow;self.host=host;self.port=port;self.authorization=authorization;self.queue=queue;self.onClose=onClose
        connection=NWConnection(host:"127.0.0.1",port:NWEndpoint.Port(rawValue:proxyPort)!,using:.tcp)
    }
    func start() {
        connection.stateUpdateHandler={ [weak self] state in
            guard let self=self else{return}
            switch state {
            case .ready:self.connect()
            case .failed(let error):self.finish(error)
            case .cancelled:self.finish(nil)
            default:break
            }
        }
        connection.start(queue:queue)
        queue.asyncAfter(deadline:.now()+15){[weak self] in
            guard let self=self,!self.established else{return}
            self.finish(NSError(domain:"GhostBar",code:2,userInfo:[NSLocalizedDescriptionKey:"Proxy connection timed out."]))
        }
    }
    func connect() {
        guard !host.contains("\r"),!host.contains("\n"),!host.contains(" ") else{finish(nil);return}
        let authority=(host.contains(":") ? "[\(host)]":host)+":"+port
        let request="CONNECT \(authority) HTTP/1.1\r\nHost: \(authority)\r\nProxy-Authorization: Basic \(authorization)\r\n\r\n"
        connection.send(content:Data(request.utf8),completion:.contentProcessed{ [weak self] error in
            if let error=error {self?.finish(error)} else {self?.handshake(Data())}
        })
    }
    func handshake(_ buffer:Data) {
        connection.receive(minimumIncompleteLength:1,maximumLength:8192){ [weak self] data,_,complete,error in
            guard let self=self else{return}
            var buffer=buffer;if let data=data {buffer.append(data)}
            if let range=buffer.range(of:Data("\r\n\r\n".utf8)) {
                let line=String(data:buffer.prefix(64),encoding:.utf8) ?? ""
                guard line.hasPrefix("HTTP/1.1 200 ") || line.hasPrefix("HTTP/1.0 200 ") else{self.finish(NSError(domain:"GhostBar",code:3));return}
                let remainder=Data(buffer[range.upperBound...])
                self.flow.open(withLocalEndpoint:nil){error in
                    self.queue.async {
                        guard error==nil else{self.finish(error);return}
                        self.established=true;self.readFromApp()
                        if remainder.isEmpty {self.readFromProxy()} else {
                            self.flow.write(remainder){error in self.queue.async {if let error=error{self.finish(error)}else{self.readFromProxy()}}}
                        }
                    }
                };return
            }
            guard error==nil,!complete,buffer.count<8192 else{self.finish(error);return}
            self.handshake(buffer)
        }
    }
    func readFromApp() {
        guard !closed else{return}
        flow.readData{[weak self] data,error in
            guard let self=self else{return}
            self.queue.async {
                guard error==nil,let data=data,!data.isEmpty else{self.finish(error);return}
                self.connection.send(content:data,completion:.contentProcessed{error in
                    if let error=error{self.finish(error)}else{self.readFromApp()}
                })
            }
        }
    }
    func readFromProxy() {
        guard !closed else{return}
        connection.receive(minimumIncompleteLength:1,maximumLength:65536){[weak self] data,_,complete,error in
            guard let self=self else{return}
            guard let data=data,!data.isEmpty else{self.finish(error);return}
            self.flow.write(data){writeError in self.queue.async {
                if writeError != nil || complete || error != nil {self.finish(writeError ?? error)}else{self.readFromProxy()}
            }}
        }
    }
    func finish(_ error:Error?) {
        guard !closed else{return};closed=true
        connection.stateUpdateHandler=nil;connection.cancel()
        flow.closeReadWithError(error);flow.closeWriteWithError(error);onClose()
    }
}
