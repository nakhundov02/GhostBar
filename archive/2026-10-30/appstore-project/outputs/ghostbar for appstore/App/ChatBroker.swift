import Foundation
import Network

/// Only the embedded proxy can reach the API broker. Provider credentials never enter HTML.
final class ChatBroker {
    struct Grant { let origin:String; let expires:Date; var requests:[Date]=[] }
    let secret:String
    private let apiKey:String
    private let model:String
    private let queue=DispatchQueue(label:"com.ghostbar.broker")
    private var listener:NWListener?
    private var connections:[UUID:NWConnection]=[:]
    private var sessions:[String:Grant]=[:]
    private var requestTimes:[Date]=[]
    private let http:URLSession
    init(apiKey:String,model:String) throws {
        self.apiKey=apiKey; self.model=model; self.secret=try randomToken()
        let configuration=URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest=70
        configuration.timeoutIntervalForResource=80
        configuration.httpCookieStorage=nil
        http=URLSession(configuration:configuration)
    }
    func start(_ completion:@escaping(Result<UInt16,Error>)->Void) throws {
        let parameters=NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host:"127.0.0.1",port:.any)
        let listener=try NWListener(using:parameters)
        self.listener=listener
        var reported=false
        listener.stateUpdateHandler={state in
            switch state {
            case .ready:
                if !reported,let port=listener.port { reported=true; completion(.success(port.rawValue)) }
            case .failed(let error):
                if !reported { reported=true; completion(.failure(error)) }
            default:break
            }
        }
        listener.newConnectionHandler={ [weak self] connection in
            guard let self=self,self.connections.count<24 else { connection.cancel();return }
            let id=UUID();self.connections[id]=connection
            connection.start(queue:self.queue)
            self.queue.asyncAfter(deadline:.now()+90){ [weak self] in self?.connections.removeValue(forKey:id)?.cancel() }
            self.read(connection,id:id,buffer:Data())
        }
        listener.start(queue:queue)
    }
    func stop() {
        queue.async { [self] in listener?.cancel(); listener=nil; connections.values.forEach{$0.cancel()};connections.removeAll();sessions.removeAll();http.invalidateAndCancel() }
    }
    private func respond(_ connection:NWConnection,id:UUID,status:Int,object:[String:Any]) {
        let body=(try? JSONSerialization.data(withJSONObject:object)) ?? Data("{}".utf8)
        let head="HTTP/1.1 \(status) Response\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: \(body.count)\r\n\r\n"
        connection.send(content:Data(head.utf8)+body,completion:.contentProcessed{ [weak self] _ in
            self?.queue.async { self?.connections.removeValue(forKey:id)?.cancel() }
        })
    }
    private func read(_ connection:NWConnection,id:UUID,buffer:Data) {
        connection.receive(minimumIncompleteLength:1,maximumLength:32768){ [weak self] data,_,complete,error in
            guard let self=self else{return}
            var buffer=buffer;if let data=data {buffer.append(data)}
            guard buffer.count<=196608 else {self.respond(connection,id:id,status:413,object:["error":"Request too large."]);return}
            if let delimiter=buffer.range(of:Data("\r\n\r\n".utf8)) {
                guard delimiter.lowerBound<8192,let head=String(data:buffer[..<delimiter.lowerBound],encoding:.utf8) else {
                    self.respond(connection,id:id,status:400,object:["error":"Invalid headers."]);return
                }
                let lines=head.components(separatedBy:"\r\n")
                let start=lines[0].split(separator:" ")
                var headers:[String:String]=[:]
                for line in lines.dropFirst() {
                    guard let colon=line.firstIndex(of:":") else{continue}
                    let key=line[..<colon].lowercased()
                    guard headers[key]==nil else {self.respond(connection,id:id,status:400,object:["error":"Duplicate header."]);return}
                    headers[key]=line[line.index(after:colon)...].trimmingCharacters(in:.whitespaces)
                }
                guard start.count==3,start[0]=="POST",headers["transfer-encoding"]==nil,
                      let size=Int(headers["content-length"] ?? ""),size>=0,size<=180000 else {
                    self.respond(connection,id:id,status:400,object:["error":"Invalid request."]);return
                }
                guard headers["authorization"]=="Bearer "+self.secret else {
                    self.respond(connection,id:id,status:401,object:["error":"Unauthorized."]);return
                }
                let body=buffer[delimiter.upperBound...]
                if body.count>=size {
                    guard let object=(try? JSONSerialization.jsonObject(with:Data(body.prefix(size)))) as? [String:Any] else{
                        self.respond(connection,id:id,status:400,object:["error":"Invalid JSON."]);return
                    }
                    self.handle(path:String(start[1]),object:object,connection:connection,id:id);return
                }
            }
            if complete || error != nil {self.connections.removeValue(forKey:id)?.cancel();return}
            self.read(connection,id:id,buffer:buffer)
        }
    }
    private func handle(path:String,object:[String:Any],connection:NWConnection,id:UUID) {
        let now=Date();sessions=sessions.filter{$0.value.expires>now}
        if path=="/register" {
            guard sessions.count<256,let origin=object["origin"] as? String,let url=URL(string:origin),
                  ["http","https"].contains(url.scheme ?? ""),url.host != nil,let token=try? randomToken() else {
                respond(connection,id:id,status:429,object:["error":"Too many open pages."]);return
            }
            sessions[token]=Grant(origin:origin,expires:now.addingTimeInterval(3600))
            respond(connection,id:id,status:200,object:["session":token]);return
        }
        guard path=="/chat",let token=object["session"] as? String,var grant=sessions[token],
              object["origin"] as? String==grant.origin else{
            respond(connection,id:id,status:403,object:["error":"Session expired. Reload the page."]);return
        }
        grant.requests=grant.requests.filter{now.timeIntervalSince($0)<60}
        requestTimes=requestTimes.filter{now.timeIntervalSince($0)<60}
        guard grant.requests.count<8,requestTimes.count<24 else{
            respond(connection,id:id,status:429,object:["error":"Please wait a moment before sending again."]);return
        }
        guard let messages=object["messages"] as? [[String:String]],!messages.isEmpty,messages.count<=21,
              messages.last?["role"]=="user",messages.allSatisfy({["user","assistant"].contains($0["role"] ?? "") && ($0["text"]?.utf8.count ?? 999999)<=64000}),
              messages.reduce(0,{$0+($1["text"]?.utf8.count ?? 0)})<=128000 else {
            respond(connection,id:id,status:400,object:["error":"The conversation is too long. Start a new chat."]);return
        }
        grant.requests.append(now);sessions[token]=grant;requestTimes.append(now)
        let contents=messages.map{["role":$0["role"]=="assistant" ? "model":"user","parts":[["text":$0["text"] ?? ""]]] as [String:Any]}
        guard let url=URL(string:"https://generativelanguage.googleapis.com/v1beta/models/\(model):generateContent") else{return}
        var request=URLRequest(url:url);request.httpMethod="POST"
        request.setValue(apiKey,forHTTPHeaderField:"x-goog-api-key")
        request.setValue("application/json",forHTTPHeaderField:"Content-Type")
        request.httpBody=try? JSONSerialization.data(withJSONObject:["contents":contents])
        http.dataTask(with:request){[weak self] data,response,error in
            guard let self=self else{return}
            self.queue.async {
                guard error==nil,let response=response as? HTTPURLResponse else {
                    self.respond(connection,id:id,status:502,object:["error":"Could not reach Gemini. Check your connection."]);return
                }
                guard (200..<300).contains(response.statusCode),let data=data,data.count<2*1024*1024,
                      let object=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any] else {
                    self.respond(connection,id:id,status:502,object:["error":"Gemini returned HTTP \(response.statusCode). Check the key, model, and quota in GhostBar."]);return
                }
                let candidates=object["candidates"] as? [[String:Any]]
                let content=candidates?.first?["content"] as? [String:Any]
                let parts=content?["parts"] as? [[String:Any]] ?? []
                let text=parts.filter{($0["thought"] as? Bool) != true}.compactMap{$0["text"] as? String}.joined(separator:"\n")
                self.respond(connection,id:id,status:text.isEmpty ? 502:200,object:text.isEmpty ? ["error":"Gemini returned no text. Try another question."]:["text":text])
            }
        }.resume()
    }
}
