# GhostBar — How to Build the DMG

## Prerequisites (one-time, on your Mac)

```bash
# Install Node.js if you don't have it
# Download from https://nodejs.org  (LTS version)

# Install mitmproxy (needed to bundle it)
brew install mitmproxy
# — OR —
pip3 install mitmproxy
```

---

## Build the DMG (every release)

```bash
# 1. Install JS dependencies
npm install

# 2. Build the DMG
#    This automatically:
#    - Finds mitmdump on your Mac
#    - Copies it into assets/
#    - Packages everything into a universal .app
#    - Wraps it in a DMG
npm run build:dmg
```

The finished file will be at:
```
dist/GhostBar-1.3.0.dmg
```

That's the file you sell/distribute. **Users just drag it to Applications and open it.**

---

## To make a truly universal DMG (works on ALL Macs)

The best way: run `npm run build:dmg` on an **Apple Silicon Mac** (M1/M2/M3).
Homebrew on Apple Silicon installs a universal mitmdump that works on both chip types.

If you need to verify:
```bash
lipo -archs assets/mitmdump
# Should output: x86_64 arm64
```

---

## What the customer does (nothing technical)

1. Download the `.dmg`
2. Open it → drag GhostBar to Applications
3. Open GhostBar
4. Go to aistudio.google.com → get free API key
5. Paste key → Save Key → Start GhostBar
6. **One-time:** Trust the mitmproxy certificate in Keychain Access (shown in app)
7. Open any website in Safari or Chrome → click ✦ → chat with Gemini

---

## Version bump before release

Edit `package.json` → change `"version": "1.3.0"` to whatever you want.
The DMG filename will update automatically.

---

## 🔐 Security & License System

### Three Layers of Protection

**Layer 1 — File Integrity**
At build time, `npm run build:dmg` generates `integrity.json` containing SHA-256 hashes of all core files, signed with a secret key. On every launch, GhostBar verifies all files match. If anything is modified, the app shows an error and refuses to start.

**Layer 2 — Machine-Locked License Keys**
- License keys follow the format: `GHOST-XXXX-XXXX-XXXX-XXXX`
- On first activation, the key is encrypted with AES-256 using the Mac's hardware fingerprint (serial number + UUID)
- The encrypted key is saved to `~/.ghostbar_license`
- On every launch, the key is decrypted and verified — it only works on the exact Mac it was activated on
- If someone shares the `.ghostbar_license` file to another Mac, it won't decrypt (wrong machine fingerprint)
- If someone shares the raw key, it still only activates on one machine per key

**Layer 3 — Runtime XOR Encryption**
API keys stored in memory are XOR-encrypted with a key derived from `BASE_KEY + machine fingerprint`. Makes it harder to extract keys from memory dumps.

### Generating License Keys to Sell

Use this Node.js snippet to generate keys for customers:
```js
function generateKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  const group = () => Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  return `GHOST-${group()}-${group()}-${group()}-${group()}`;
}
console.log(generateKey()); // e.g. GHOST-K7MN-PQ3R-VWXY-Z248
```

### Build Steps
1. `npm install`
2. `npm run build:dmg` — this auto-generates `integrity.json` and builds the DMG
3. Distribute the DMG — each customer enters their `GHOST-XXXX-XXXX-XXXX-XXXX` key on first launch
