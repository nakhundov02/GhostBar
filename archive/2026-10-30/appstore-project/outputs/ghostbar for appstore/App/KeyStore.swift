import Foundation
import Security

enum KeyStore {
    private static let service = "com.ghostbar.appstore.gemini"
    static func read() -> String? {
        let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:service,
                                   kSecAttrAccount as String:"api-key", kSecReturnData as String:true, kSecMatchLimit as String:kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data=result as? Data else { return nil }
        return String(data:data,encoding:.utf8)
    }
    static func save(_ value: String) throws {
        let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:"api-key"]
        if value.isEmpty { SecItemDelete(query as CFDictionary); return }
        let attributes:[String:Any] = [kSecValueData as String:Data(value.utf8)]
        var status=SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item=query.merging(attributes){_,new in new}
            item[kSecAttrAccessible as String]=kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status=SecItemAdd(item as CFDictionary,nil)
        }
        guard status == errSecSuccess else { throw NSError(domain:NSOSStatusErrorDomain,code:Int(status)) }
    }
}

func randomToken() throws -> String {
    var bytes=[UInt8](repeating:0,count:32)
    let status=SecRandomCopyBytes(kSecRandomDefault,bytes.count,&bytes)
    guard status == errSecSuccess else { throw NSError(domain:NSOSStatusErrorDomain,code:Int(status)) }
    return bytes.map{String(format:"%02x",$0)}.joined()
}
