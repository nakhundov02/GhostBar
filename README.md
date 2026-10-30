# GhostBar

GhostBar is a macOS app that adds a small chat launcher to browser pages through a local HTTPS proxy. Press **Control + `** to open or close the chat, or click the faint star in the top-right corner. Use **Chat shortcut → Change shortcut** in the app to record another key combination; **Reset default** restores Control + `. Reload webpages after changing it. The shortcut also works while typing inside the chat and after the control app closes. The chat uses a white background with dark text. The launcher stays at 10% opacity, including on hover. Click outside the chat to dismiss it; reopening preserves that page’s conversation.

This personal version has no GhostBar activation key, machine lock, remote license check, integrity gate, deliberate request failures, self-deletion, or timed shutdown. It includes **Continue with ChatGPT**, saved account connections, account switching, model discovery, sign-out, and optional Gemini API access.

## Download the app

Get the ready-to-run apps from [GhostBar 2.0.5](https://github.com/nakhundov02/GhostBar/releases/tag/v2.0.5).

| Mac | Download |
| --- | --- |
| Apple Silicon (M-series) | [GhostBar-2.0.5-arm64.zip](https://github.com/nakhundov02/GhostBar/releases/download/v2.0.5/GhostBar-2.0.5-arm64.zip) |
| Intel | [GhostBar-2.0.5-x64.zip](https://github.com/nakhundov02/GhostBar/releases/download/v2.0.5/GhostBar-2.0.5-x64.zip) |
| Source code | [GhostBar-source.zip](https://github.com/nakhundov02/GhostBar/releases/download/v2.0.5/GhostBar-source.zip) |

Requires **macOS 13 or newer**. Unzip the matching download, move **GhostBar.app** into **Applications**, and open it. Node.js, Python, and Homebrew are not required for the packaged app. If replacing an older version, stop its proxy before replacing the app. Follow the account and certificate setup steps below on each Mac.

These builds are ad-hoc signed, not Apple-notarized. A downloaded app may need approval in **System Settings → Privacy & Security → Open Anyway**. The release also includes SHA-256 checksums.

Your friend uses their own ChatGPT connection or Gemini API key. No account, API key, certificate, or existing chat history is shared in these downloads.

## Run on your Mac

Requires macOS 13 or newer and Node.js 22 or newer. Use a current Node LTS release.

~~~sh
npm ci
npm run setup:proxy
npm start
~~~

The setup command downloads the complete official mitmproxy app bundle for your Mac and checks its SHA-256 checksum. Python and Homebrew are not required. Source and installers support Apple Silicon and Intel.

1. Choose **ChatGPT · use my plan** and click **Continue with ChatGPT**.
2. Complete the official OpenAI browser sign-in and approve ChatGPT plan usage. Eligible personal Plus or Pro accounts can use their existing allowance. Free-plan access is not guaranteed.
3. Choose an available model. **Manage usage** opens ChatGPT’s usage settings.
4. Click **Certificate setup**. GhostBar imports this Mac’s public CA into the **login** keychain and opens Keychain Access. Select **login → Certificates**, open the mitmproxy certificate, expand **Trust**, and set **Secure Sockets Layer (SSL) → Always Trust**. Close its window and confirm the change with macOS. If several mitmproxy certificates appear, match the SHA-256 fingerprint shown in GhostBar.
5. Click **Start Proxy**, reload a browser page, and click its top-right corner.
6. Choose **Use page text** to attach page text or selected text to your next message. You can also attach a PNG, JPEG, or WebP image.
7. Close or quit GhostBar whenever you like. The proxy and chat backend continue in a separate background process. Reopen GhostBar and click **Stop Proxy** to restore the previous proxy settings.

Each person, including a friend who clones this repository, signs in with their own account. Their usage counts against their own plan. A shared source archive does not contain your account or tokens. Signing in does not import existing ChatGPT chats or memory.

Neither the ChatGPT desktop app nor the GhostBar control window needs to remain open. This applies to both AI providers. Keep the Mac awake and connected to the internet; quitting the macOS user session or restarting ends background processes.

The existing Gemini option remains available; enter your own API key and model in the app. Keys are sent only by the local backend.

## Certificate import error -25294

This macOS error means the destination keychain could not be found. Keychain Access can show it when importing into Local Items/iCloud. Version 2.0.5 explicitly imports the public CA into the login keychain; SSL trust still requires your confirmation.

For an older build, open **Keychain Access → File → Import Items**, click **Options**, and select **login** as the destination. Press **Command + Shift + G** in the file picker and enter:

~~~text
~/Library/Application Support/GhostBar/mitmproxy/mitmproxy-ca-cert.pem
~~~

Import it, then follow the SSL trust step above. Use the certificate generated on that Mac; do not share certificates or import `mitmproxy-ca.pem`, which also contains a private key. If login is locked, unlock it in Keychain Access before retrying. GhostBar does not reset or create a replacement login keychain.

[Apple explains error -25294 and choosing the target keychain explicitly.](https://developer.apple.com/forums/thread/675290)

## Build a distributable app

~~~sh
npm ci
npm run setup:proxy -- arm64 x64
npm test
npm run build:mac -- --publish never
~~~

Installers are written to dist/. Share the arm64 build with Apple Silicon Macs and the x64 build with Intel Macs. The GitHub Actions workflow can build both versions manually or from a version tag. Do not commit node_modules, runtime, dist, certificates, or account data.

These builds do not include an Apple Developer ID or notarization. A locally built app can be opened normally, but a downloaded unsigned app may require approval in macOS Privacy & Security. For public distribution, configure your own Apple signing/notarization credentials in the build environment. The app never edits its installed bundle or silently removes macOS quarantine attributes.

## How the connection works

The control app connects to its background service through an owner-only Unix socket. Closing the window or pressing Cmd+Q exits only the control app. Reopening connects to the same running service and proxy port.

The injected launcher opens a separate https://ghostbar.test frame (a reserved test hostname intercepted locally, avoiding macOS’s default *.local proxy bypass) served by GhostBar's proxy. The frame sends messages to a loopback backend, which talks to OpenAI using the official OAuth grant. OAuth access, refresh, and ID tokens never appear in visited pages, browser storage, source files, or logs.

Credentials are encrypted using Electron safeStorage backed by macOS Keychain, with an owner-only, atomically written vault in ~/Library/Application Support/GhostBar. Each installation has its own stable random host identifier; it is not a license or machine restriction.

GhostBar discovers account-specific models and sends complete chat context to the public Responses API using stream=true and store=false. It requires the stream's completion event before treating a reply as successful. Chat history stays in the panel's memory; closing or reloading the page clears it. Switching accounts requires a fresh panel connection before messages can be sent.

GhostBar modifies CSP only as needed for its launcher and frame. It preserves unrelated response protections, passes OpenAI authentication/API and Apple cloud/system service traffic through without HTTPS inspection, and verifies upstream TLS certificates. Browsers must use the macOS system proxy and trust the local certificate. Browsers with separate proxy or certificate settings may need manual configuration; apps that pin certificates are not guaranteed to work.

While running, GhostBar checks network services every five seconds, applies its proxy to newly added or enabled adapters, and repairs settings reset by a network transition. Ordinary Wi-Fi network changes retain the same system proxy; Ethernet and other adapters are configured too. This requires browsers to honor macOS proxy settings and the network to permit the provider connection. Browser-specific bypass rules, forced VPN routing, authenticated upstream proxies, and managed network policies can require separate configuration; no local proxy can promise compatibility with every possible network configuration.

Proxy settings are saved before changes, restored after startup failure or an unexpected proxy exit, and recovered at the next launch if the background service is forcibly terminated. Stop without a saved backup does not change unrelated settings. No application can run cleanup after a power loss or SIGKILL; reopen GhostBar to recover, or turn off its HTTP/HTTPS proxy entries in macOS Network settings.

Version 2.0.3 fixes a page-loading regression in the CSP rewrite. It preserves existing inline scripts, styles, nonces, hashes, multiple policies, and attribute permissions. It does not add restrictions to otherwise unrestricted directives or rewrite HTML-looking strings inside page scripts.

Version 2.0.4 adds a saved keyboard shortcut to toggle the chat. The key is handled by the loaded webpage; browser or macOS reserved keys can take priority. Choose a different combination if a browser consumes it.

A local proxy does not create a VPN tunnel or bypass network filtering. A network blocking VPN servers may still allow GhostBar’s regular HTTPS connections, but blocked destinations, authenticated network proxies, or TLS inspection can prevent connections. Compatibility with a university network requires testing on that network.

## Verification

~~~sh
npm test
python3 -m unittest discover -s tests -p '*_test.py'
~~~

The optional browser suite in `tests/browser-compat.cjs` requires Playwright and Chrome. It compares direct and proxied rendering across 12 policy cases using a temporary proxy without changing system settings. Set `GHOSTBAR_LIVE=1` to also check public sites.

Tests use fake credentials and cover OAuth state/PKCE and client binding, identity validation, refresh serialization, stream completion/error handling, bridge origin isolation, account switching, network restoration, and the private service channel. Live sign-in and a real reply require the account owner to authorize GhostBar.

## Official references

- [ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source)
- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Using and managing your plan in apps](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)
- [mitmproxy installation](https://docs.mitmproxy.org/stable/overview/installation/)

OpenAI's personal/local-app eligibility and your account's available models and limits apply. This project does not supply a shared paid account or API key.

Apple service pass-through follows [Apple’s network guidance](https://support.apple.com/en-us/101555), because those services reject HTTPS inspection. This also keeps iCloud Drive downloads working while GhostBar is active.

Version 2.0.2 passes Respondus service domains and their documented AWS/CloudFront dependencies through unchanged, following [Respondus’s network guidance](https://support.respondus.com/hc/en-us/articles/29456577007003-Firewalls-Content-Filters-and-Proxy-Servers). This addresses proxy interference with Monitor connections; it does not guarantee that restricted browsers permit the GhostBar chat panel. End-to-end Monitor startup must be verified in the user’s institution environment.


## Historical project backup

Older GhostBar projects, guides, source snapshots, and development scripts are preserved in [the 30 October 2026 archive](archive/2026-10-30/README.md). Historical installers are available in the [Mac cleanup backup release](https://github.com/nakhundov02/GhostBar/releases/tag/mac-cleanup-2026-10-30).
