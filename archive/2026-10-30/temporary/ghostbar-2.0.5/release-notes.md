GhostBar 2.0.5 fixes certificate setup for Macs showing **“Unable to import mitmproxy — error -25294.”** The app now selects the login keychain explicitly instead of relying on Keychain Access’s default destination.

## Downloads

- **Apple Silicon (M-series):** `GhostBar-2.0.5-arm64.zip`
- **Intel Macs:** `GhostBar-2.0.5-x64.zip`
- **Source:** `GhostBar-source.zip`
- **Checksums:** `SHA256SUMS.txt`

Requires macOS 13 or newer. Stop the proxy in the older version, quit GhostBar, unzip the matching download, and replace GhostBar.app in Applications. These builds are ad-hoc signed and not Apple-notarized; macOS may require approval in System Settings → Privacy & Security.

## Certificate setup

Click **Certificate setup**. GhostBar imports this Mac’s public CA into **login** and opens Keychain Access. Select **login → Certificates**, open **mitmproxy**, expand **Trust**, and set **Secure Sockets Layer (SSL) → Always Trust**. Close the certificate window and confirm with macOS. If there are several mitmproxy certificates, match the SHA-256 fingerprint shown in GhostBar. Then start the proxy.

The app validates the public certificate and handles repeat imports. It does not reset keychains or automatically change certificate trust. Every Mac generates its own CA, and every person uses their own account. The downloads contain no personal credentials or generated CA.

If keeping an older version, use Keychain Access → File → Import Items → Options and explicitly choose **login**, then import `~/Library/Application Support/GhostBar/mitmproxy/mitmproxy-ca-cert.pem` from that Mac. [Apple’s explanation and workaround](https://developer.apple.com/forums/thread/675290).

## Verification

28 JavaScript and 15 Python checks passed. On macOS, a fresh bundled proxy generated a CA and the new import flow successfully imported it twice into a disposable test keychain. Both app archives, versions, contents, and signatures were checked. The Apple Silicon app opened successfully with a fresh profile. Intel execution and the affected friend’s Mac still require testing there.
