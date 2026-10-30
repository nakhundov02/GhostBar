/**
 * core/ghostbar.js
 * All real GhostBar logic: key storage, proxy control, mitmproxy, Gemini API.
 */

const { net }             = require('electron');
const fs                  = require('fs');
const path                = require('path');
const os                  = require('os');
const { execSync, spawn, exec } = require('child_process');

// ── Storage ───────────────────────────────────────────────────
const DATA_FILE = path.join(os.homedir(), '.ghostbar_data.json');

function loadData() {
  try { if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch {}
  return {};
}
function saveData(obj) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify({ ...loadData(), ...obj }, null, 2)); }
  catch (e) { console.error('saveData error', e); }
}

// ── State ─────────────────────────────────────────────────────
let _running  = false;
let _mitmProc = null;

const PROXY_HOST = '127.0.0.1';
const PROXY_PORT = '8080';

// ── API Key ───────────────────────────────────────────────────
function getKey()     { return loadData().gem_key || ''; }
function saveKey(key) { saveData({ gem_key: key }); }

// ── macOS network services ───────────────────────────────────
// Returns ALL active network services (Wi-Fi + Ethernet + VPN etc)
// so we set proxy on ALL of them — user stays connected regardless
function getAllNetworkServices() {
  try {
    const lines = execSync('networksetup -listallnetworkservices 2>/dev/null', { encoding: 'utf8' })
      .split('\n').map(s => s.trim())
      .filter(s => s && !s.startsWith('*'));
    return lines.length ? lines : ['Wi-Fi'];
  } catch { return ['Wi-Fi']; }
}

// ── Save original proxy state before we touch anything ────────
// This is the SAFETY NET — if app crashes we can still restore
const SAVED_PROXY_FILE = path.join(os.homedir(), '.ghostbar_proxy_backup.json');

function saveOriginalProxyState() {
  try {
    const services = getAllNetworkServices();
    const backup = {};
    for (const svc of services) {
      try {
        const web   = execSync(`networksetup -getwebproxy "${svc}" 2>/dev/null`,       { encoding: 'utf8' });
        const https = execSync(`networksetup -getsecurewebproxy "${svc}" 2>/dev/null`, { encoding: 'utf8' });
        const parseProxy = (out) => ({
          enabled: out.includes('Enabled: Yes'),
          server:  (out.match(/Server: (.+)/) || [])[1]?.trim() || '',
          port:    (out.match(/Port: (\d+)/) || [])[1]?.trim() || '0'
        });
        backup[svc] = { web: parseProxy(web), https: parseProxy(https) };
      } catch {}
    }
    fs.writeFileSync(SAVED_PROXY_FILE, JSON.stringify(backup, null, 2));
    console.log('✅ Proxy state saved for', Object.keys(backup).length, 'services');
  } catch (e) { console.error('Could not save proxy state:', e.message); }
}

function restoreOriginalProxyState() {
  try {
    if (!fs.existsSync(SAVED_PROXY_FILE)) {
      // No backup — just turn off proxy on all services (safe default)
      for (const svc of getAllNetworkServices()) {
        try {
          execSync(`networksetup -setwebproxystate "${svc}" off 2>/dev/null`);
          execSync(`networksetup -setsecurewebproxystate "${svc}" off 2>/dev/null`);
        } catch {}
      }
      return;
    }
    const backup = JSON.parse(fs.readFileSync(SAVED_PROXY_FILE, 'utf8'));
    for (const [svc, state] of Object.entries(backup)) {
      try {
        // Restore HTTP proxy
        if (state.web.server && state.web.port !== '0') {
          execSync(`networksetup -setwebproxy "${svc}" ${state.web.server} ${state.web.port} 2>/dev/null`);
        }
        execSync(`networksetup -setwebproxystate "${svc}" ${state.web.enabled ? 'on' : 'off'} 2>/dev/null`);

        // Restore HTTPS proxy
        if (state.https.server && state.https.port !== '0') {
          execSync(`networksetup -setsecurewebproxy "${svc}" ${state.https.server} ${state.https.port} 2>/dev/null`);
        }
        execSync(`networksetup -setsecurewebproxystate "${svc}" ${state.https.enabled ? 'on' : 'off'} 2>/dev/null`);
      } catch {}
    }
    fs.unlinkSync(SAVED_PROXY_FILE);
    console.log('✅ Original proxy state restored for', Object.keys(backup).length, 'services');
  } catch (e) { console.error('Could not restore proxy state:', e.message); }
}

// ── System proxy ──────────────────────────────────────────────
function setSystemProxy(enable) {
  try {
    const services = getAllNetworkServices();
    let anyOk = false;
    for (const svc of services) {
      try {
        if (enable) {
          execSync(`networksetup -setwebproxy "${svc}" ${PROXY_HOST} ${PROXY_PORT} 2>/dev/null`);
          execSync(`networksetup -setsecurewebproxy "${svc}" ${PROXY_HOST} ${PROXY_PORT} 2>/dev/null`);
          execSync(`networksetup -setwebproxystate "${svc}" on 2>/dev/null`);
          execSync(`networksetup -setsecurewebproxystate "${svc}" on 2>/dev/null`);
        } else {
          execSync(`networksetup -setwebproxystate "${svc}" off 2>/dev/null`);
          execSync(`networksetup -setsecurewebproxystate "${svc}" off 2>/dev/null`);
        }
        anyOk = true;
      } catch (e) {
        console.error(`Proxy set failed for ${svc}:`, e.message);
      }
    }
    return { ok: anyOk, services };
  } catch (e) { return { ok: false, msg: e.message }; }
}

function getProxyState() {
  try {
    const svc   = getAllNetworkServices()[0];
    const web   = execSync(`networksetup -getwebproxy "${svc}" 2>/dev/null`,       { encoding: 'utf8' });
    const https = execSync(`networksetup -getsecurewebproxy "${svc}" 2>/dev/null`, { encoding: 'utf8' });
    return { webOn: web.includes('Enabled: Yes'), httpsOn: https.includes('Enabled: Yes') };
  } catch { return { webOn: false, httpsOn: false }; }
}

// ── Find bundled mitmdump ─────────────────────────────────────
function findMitmdump() {
  // Detect architecture
  const arch = process.arch; // 'arm64' or 'x64' (x64 = Intel)
  const archSuffix = arch === 'arm64' ? 'arm64' : 'x86_64';

  // 1. Inside .app bundle (production DMG install) — arch-specific first, then generic
  if (process.resourcesPath) {
    const archSpecific = path.join(process.resourcesPath, `mitmdump-${archSuffix}`);
    if (fs.existsSync(archSpecific)) {
      try { execSync(`chmod +x "${archSpecific}"`); } catch {}
      return archSpecific;
    }
    const generic = path.join(process.resourcesPath, 'mitmdump');
    if (fs.existsSync(generic)) {
      try { execSync(`chmod +x "${generic}"`); } catch {}
      return generic;
    }
  }
  // 2. Dev mode: assets/ beside package.json — arch-specific first
  const devArch = path.join(__dirname, '..', 'assets', `mitmdump-${archSuffix}`);
  if (fs.existsSync(devArch)) {
    try { execSync(`chmod +x "${devArch}"`); } catch {}
    return devArch;
  }
  const dev = path.join(__dirname, '..', 'assets', 'mitmdump');
  if (fs.existsSync(dev)) {
    try { execSync(`chmod +x "${dev}"`); } catch {}
    return dev;
  }
  // 3. System fallback
  try { const w = execSync('which mitmdump 2>/dev/null', { encoding: 'utf8' }).trim(); if (w) return w; } catch {}
  for (const p of [
    '/opt/homebrew/bin/mitmdump', '/usr/local/bin/mitmdump',
    os.homedir() + '/.local/bin/mitmdump',
    '/Library/Frameworks/Python.framework/Versions/3.13/bin/mitmdump',
    '/Library/Frameworks/Python.framework/Versions/3.12/bin/mitmdump',
  ]) { try { if (fs.existsSync(p)) return p; } catch {} }
  return null;
}

// ── Resolve addon + snippet paths ────────────────────────────
function getAddonPaths() {
  if (process.resourcesPath) {
    const a = path.join(process.resourcesPath, 'addon.py');
    if (fs.existsSync(a)) return { addonPath: a, cwd: process.resourcesPath };
  }
  const addonPath  = path.join(__dirname, 'addon.py');
  const snippetSrc = path.join(__dirname, '..', 'src', 'snippet.html');
  const snippetDst = path.join(__dirname, 'snippet.html');
  try { if (!fs.existsSync(snippetDst)) fs.copyFileSync(snippetSrc, snippetDst); } catch {}
  return { addonPath, cwd: __dirname };
}

// ── mitmproxy lifecycle ───────────────────────────────────────
async function startMitmproxy() {
  if (_mitmProc) return { ok: true };
  const mitmdump = findMitmdump();
  if (!mitmdump) return { ok: false, msg: 'mitmdump binary missing — please reinstall GhostBar.' };

  const { addonPath, cwd } = getAddonPaths();

  return new Promise((resolve) => {
    _mitmProc = spawn(mitmdump, [
      '--listen-host', PROXY_HOST, '--listen-port', PROXY_PORT,
      '--ssl-insecure', '-s', addonPath, '--set', 'connection_strategy=lazy'
    ], { cwd, detached: false });

    _mitmProc.stdout.on('data', d => process.stdout.write('mitm: ' + d));
    _mitmProc.stderr.on('data', d => process.stdout.write('mitm: ' + d));
    _mitmProc.on('error', err => resolve({ ok: false, msg: err.message }));
    _mitmProc.on('exit',  ()  => { _mitmProc = null; });
    setTimeout(() => resolve({ ok: true }), 1800);
  });
}

function stopMitmproxy() {
  if (_mitmProc) { try { _mitmProc.kill('SIGTERM'); } catch {} _mitmProc = null; }
}

// ── Watchdog — if mitmproxy dies, restore proxy immediately ──
let _watchdog = null;

function startWatchdog() {
  if (_watchdog) return;
  _watchdog = setInterval(() => {
    if (_running && !_mitmProc) {
      console.error('⚠ mitmproxy died unexpectedly — restoring network!');
      restoreOriginalProxyState();
      _running = false;
      clearInterval(_watchdog);
      _watchdog = null;
    }
  }, 3000);
}

function stopWatchdog() {
  if (_watchdog) { clearInterval(_watchdog); _watchdog = null; }
}

// ── Start / Stop ──────────────────────────────────────────────
async function start() {
  if (_running) return getStatus();

  // Save BEFORE touching anything — this is our safety net
  saveOriginalProxyState();

  const mitmResult = await startMitmproxy();
  if (!mitmResult.ok) {
    // mitmproxy failed to start — restore immediately, don't enable proxy
    restoreOriginalProxyState();
    return { ...getStatus(), mitmOk: false, mitmMsg: mitmResult.msg };
  }

  const proxyResult = setSystemProxy(true);
  _running = true;
  startWatchdog();
  return { ...getStatus(), mitmOk: true, proxyOk: proxyResult.ok, proxyMsg: proxyResult.msg || null };
}

function stop() {
  stopWatchdog();
  stopMitmproxy();
  restoreOriginalProxyState(); // Always restore original state, not just "off"
  _running = false;
  return getStatus();
}

// ── Status ────────────────────────────────────────────────────
function getStatus() {
  const key = getKey();
  // Use _running as the source of truth — networksetup queries are slow
  // and can lag behind the actual state, causing false "Off" readings
  const proxyOn = _running && !!_mitmProc;
  return {
    running:      _running,
    hasKey:       !!key && key.startsWith('AIza'),
    webProxy:     proxyOn ? `${PROXY_HOST}:${PROXY_PORT}` : 'Off',
    secureProxy:  proxyOn ? `${PROXY_HOST}:${PROXY_PORT}` : 'Off',
    webProxyOn:   proxyOn,
    httpsProxyOn: proxyOn,
    apiLabel:     !!key && key.startsWith('AIza') ? 'Connected' : 'Not Connected'
  };
}

// ── Key validation ────────────────────────────────────────────
function validateKeyFormat(key) {
  if (!key || typeof key !== 'string') return { ok: false, msg: 'No key provided.' };
  if (!key.startsWith('AIza'))         return { ok: false, msg: 'Key must start with AIza…' };
  if (key.length < 35)                 return { ok: false, msg: 'Key looks too short.' };
  return { ok: true, msg: 'Key format looks valid.' };
}

// ── Live Gemini test ──────────────────────────────────────────
async function testKeyLive(key) {
  const fmt = validateKeyFormat(key);
  if (!fmt.ok) return { ok: false, msg: fmt.msg };

  const TEST_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];
  const body = JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }] });

  function tryModel(modelName) {
    return new Promise((res) => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${key}`;
      const req = net.request({ method: 'POST', url });
      let data = '';
      req.on('response', r => {
        r.on('data', c => { data += c; });
        r.on('end', () => {
          try {
            const j = JSON.parse(data);
            if (j.candidates) {
              res({ ok: true, skip: false, msg: `Connected via ${modelName} ✓` });
            } else if (j.error) {
              const m = j.error.message || '';
              const skip = m.includes('quota') || m.includes('not found') ||
                           m.includes('RESOURCE') || m.includes('deprecated') ||
                           m.includes('not supported');
              res({ ok: false, skip, msg: m });
            } else {
              res({ ok: false, skip: false, msg: 'Unexpected response.' });
            }
          } catch { res({ ok: false, skip: false, msg: 'Parse error.' }); }
        });
      });
      req.on('error', e => res({ ok: false, skip: false, msg: e.message }));
      req.setHeader('Content-Type', 'application/json');
      req.write(body); req.end();
    });
  }

  let lastMsg = '';
  for (const model of TEST_MODELS) {
    const result = await tryModel(model);
    if (result.ok)    return { ok: true,  msg: result.msg };
    if (!result.skip) return { ok: false, msg: result.msg };
    lastMsg = result.msg;
  }

  if (lastMsg.includes('quota') || lastMsg.includes('RESOURCE')) {
    return { ok: false, msg: 'Quota limit is 0 — key not activated. Delete it on aistudio.google.com, wait 5 min, create a fresh one.' };
  }
  return { ok: false, msg: lastMsg || 'No working Gemini model found.' };
}

// ── Gemini chat ───────────────────────────────────────────────
async function geminiChat(history) {
  return new Promise((resolve) => {
    const key = getKey();
    if (!key) return resolve({ ok: false, msg: 'No API key saved.' });
    const url  = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
    const body = JSON.stringify({ contents: history, generationConfig: { temperature: 0.7, maxOutputTokens: 4096 } });
    const req  = net.request({ method: 'POST', url });
    let data = '';
    req.on('response', r => {
      r.on('data', c => { data += c; });
      r.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.error) resolve({ ok: false, msg: j.error.message });
          else         resolve({ ok: true, text: j.candidates[0].content.parts[0].text });
        } catch { resolve({ ok: false, msg: 'Could not parse Gemini response.' }); }
      });
    });
    req.on('error', e => resolve({ ok: false, msg: e.message }));
    req.setHeader('Content-Type', 'application/json');
    req.write(body); req.end();
  });
}

// ── Auto-trust mitmproxy certificate ─────────────────────────
async function autoTrustCert() {
  const certPath  = path.join(os.homedir(), '.mitmproxy', 'mitmproxy-ca-cert.pem');
  const certPathP = path.join(os.homedir(), '.mitmproxy', 'mitmproxy-ca-cert.p12');

  // Certificate not generated yet — need to start GhostBar first
  if (!fs.existsSync(certPath)) {
    return { ok: false, msg: 'Certificate not found. Click Start GhostBar first (wait 3 seconds), then try this button.' };
  }

  // Try login keychain first (no admin needed, just user password)
  const loginKeychain = path.join(os.homedir(), 'Library', 'Keychains', 'login.keychain-db');
  const loginKeychainAlt = path.join(os.homedir(), 'Library', 'Keychains', 'login.keychain');

  const keychainPath = fs.existsSync(loginKeychain) ? loginKeychain : loginKeychainAlt;

  return new Promise((resolve) => {
    const cmd = `security add-trusted-cert -d -r trustRoot -k "${keychainPath}" "${certPath}"`;
    exec(cmd, (err) => {
      if (!err) {
        resolve({ ok: true, msg: 'Done! Restart your browser — the ✦ button will now work on all HTTPS sites.' });
        return;
      }
      // Try system keychain (needs admin password via macOS dialog)
      const cmd2 = `security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${certPath}"`;
      exec(cmd2, (err2) => {
        if (!err2) {
          resolve({ ok: true, msg: 'Done! Restart your browser — the ✦ button will now work on all HTTPS sites.' });
          return;
        }
        // Both failed — open Keychain Access directly to the cert
        exec(`open "${path.join(os.homedir(), '.mitmproxy', 'mitmproxy-ca-cert.pem')}"`, () => {});
        resolve({ ok: false, msg: 'Auto-trust failed. Opening the certificate file — double-click it, then set Trust to Always Trust and enter your password.' });
      });
    });
  });
}

// Called on startup to fix any leftover proxy from a previous crash
function checkAndFixLeftoverProxy() {
  const backupExists = fs.existsSync(SAVED_PROXY_FILE);
  if (backupExists) {
    console.log('⚠ Found leftover proxy backup from previous crash — restoring...');
    restoreOriginalProxyState();
  }
}

function getTier() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')).tier || 'free'; }
  catch { return 'free'; }
}

function saveTier(tier) {
  try {
    const data = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : {};
    data.tier = tier === 'paid' ? 'paid' : 'free';
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    return { ok: true };
  } catch(e) { return { ok: false, msg: e.message }; }
}

module.exports = { getKey, saveKey, getTier, saveTier, validateKeyFormat, testKeyLive, geminiChat, start, stop, getStatus, autoTrustCert, checkAndFixLeftoverProxy };
