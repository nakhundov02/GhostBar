GhostBar 2.0.4 adds a configurable keyboard shortcut to open and close the browser chat.

## Downloads

- **Apple Silicon (M-series):** `GhostBar-2.0.4-arm64.zip`
- **Intel Macs:** `GhostBar-2.0.4-x64.zip`
- **Source:** `GhostBar-source.zip`
- **Checksums:** `SHA256SUMS.txt`

Requires **macOS 13 or newer**. Unzip the correct app, move GhostBar.app into Applications, and open it. No Node.js, Python, or Homebrew installation is needed. Downloaded builds are ad-hoc signed and not Apple-notarized, so macOS may require approval in System Settings → Privacy & Security.

## Setup

1. Connect your own ChatGPT account or enter your own Gemini API key.
2. Follow Certificate setup once on your Mac.
3. Start Proxy and reload your webpage.
4. Press **Control + backtick (`)** to open or close the chat. Change it under **Chat shortcut → Change shortcut**.

Each person uses their own account. These downloads contain no personal credentials or certificates.

The white chat theme, faint launcher, outside-click dismissal, background service, and page-loading fixes are included. Network filtering, reserved browser keys, and restricted browser policies may affect compatibility.

## Verification

20 JavaScript and 15 Python checks passed. Twelve real-browser policy scenarios and default/custom shortcut checks passed. Native settings tests verified recording, cancellation, persistence across restart, and reset. Both app archives and signatures were verified locally. Full institution-specific browser and network behavior still requires testing there.
