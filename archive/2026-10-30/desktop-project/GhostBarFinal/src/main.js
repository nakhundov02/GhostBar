const { app, BrowserWindow, ipcMain, clipboard, shell, dialog } = require('electron');
const path    = require('path');
const http    = require('http');
const fs      = require('fs');
const os      = require('os');
const gb        = require('../core/ghostbar');
const { exec }  = require('child_process');
const license   = require('../core/license');
const integrity = require('../core/integrity');
const { startGuardian } = require('../core/guardian');

// ── Auto-remove macOS quarantine flag ────────────────────────
// Silently fixes "damaged app" warning — no terminal needed from user
try {
  const { execSync } = require('child_process');
  const _ap = process.execPath;
  const _bundle = _ap.includes('.app/') ? _ap.substring(0, _ap.indexOf('.app/') + 4) : null;
  if (_bundle) execSync(`xattr -cr "${_bundle}" 2>/dev/null || true`);
} catch(e) { /* silent */ }

// ── Security checks run before anything else ────────────────
// Tell integrity where the .app bundle Resources folder is
// so the receipt file lives inside the bundle (deleted on uninstall)
const resourcesPath = process.resourcesPath || path.join(__dirname, '..');
integrity.setReceiptDir(resourcesPath);

// Layer 1: integrity check
const integrityResult = integrity.checkIntegrity();
// Layer 2: license check  
const licenseResult   = integrity.checkLicense();
// Guardian: silent anti-tamper (runs in background)
startGuardian();

console.log('Integrity:', integrityResult.ok ? '✅' : '❌', integrityResult.reason || '');
console.log('License:',   licenseResult.ok   ? '✅' : '❌', licenseResult.msg    || '');

// ── Key server on port 9999 ───────────────────────────────────
const DATA_FILE = path.join(os.homedir(), '.ghostbar_data.json');

function loadKey() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')).gem_key || ''; }
  catch { return ''; }
}

const keyServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  if (req.url === '/getkey') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(loadKey());
  } else if (req.url === '/ping') {
    // Health check — browser can verify key server is alive
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  } else {
    res.writeHead(404); res.end();
  }
});

keyServer.listen(9999, '127.0.0.1', () => {
  console.log('✅ Key server on http://127.0.0.1:9999');
});

// ── Window ────────────────────────────────────────────────────
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1240, minHeight: 820,
    title: 'GhostBar', backgroundColor: '#0B0B0F',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  // On macOS: clicking red X hides the window (standard macOS behaviour)
  // The app stays in dock — clicking dock icon just shows it again
  // This means license is NEVER re-checked on dock click
  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  // Async server re-verify after app loads (non-blocking)
  // If revoked remotely, show a dialog and quit
  win.webContents.once('did-finish-load', async () => {
    try {
      const result = await integrity.verifyLicenseWithServer();
      if (!result.ok && !result.offline) {
        const { dialog } = require('electron');
        await dialog.showMessageBox(win, {
          type:    'error',
          title:   'GhostBar — License Revoked',
          message: result.msg || 'Your license is no longer valid.',
          detail:  'The app will now close. Contact support if you believe this is an error.',
          buttons: ['OK']
        });
        app.quit();
      }
    } catch { /* network error — allow offline */ }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); shell.openExternal(url); }
  });
}

let activateWin = null;

function showActivateWindow(options = {}) {
  if (activateWin && !activateWin.isDestroyed()) {
    activateWin.focus(); return;
  }
  activateWin = new BrowserWindow({
    width: 480, height: 520, resizable: false,
    title: 'GhostBar — Activate',
    backgroundColor: '#0a0a10',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });

  // Build query params for error states
  const params = new URLSearchParams();
  if (options.tampered && options.tampered.length > 0) {
    params.set('tampered', options.tampered.join(','));
  }
  if (options.msg) params.set('msg', options.msg);

  const query = params.toString();
  const filePath = path.join(__dirname, 'activate.html');
  activateWin.loadFile(filePath, query ? { query: Object.fromEntries(params) } : {});
  activateWin.on('closed', () => { activateWin = null; });
}

function showLockedWindow() {
  const fresh = integrity.checkLicense();
  showActivateWindow({ msg: fresh.msg || 'Enter your license key.' });
}

// ── IPC ───────────────────────────────────────────────────────
ipcMain.handle('gb:openExternal', (_, url) => shell.openExternal(url));
ipcMain.handle('gb:status',      ()       => gb.getStatus());
ipcMain.handle('gb:saveKey',     (_, key) => { gb.saveKey(key.trim()); return gb.getStatus(); });
ipcMain.handle('gb:getKey',      ()       => gb.getKey());
ipcMain.handle('gb:validateKey', (_, key) => gb.validateKeyFormat(key));
ipcMain.handle('gb:testKeyLive', (_, key) => gb.testKeyLive(key));
ipcMain.handle('gb:start',       ()       => gb.start());
ipcMain.handle('gb:stop',        ()       => gb.stop());
ipcMain.handle('gb:chat',        (_, h)   => gb.geminiChat(h));
ipcMain.handle('gb:paste',       ()       => clipboard.readText());
ipcMain.handle('gb:licenseOk', () => {
  // Re-check license from disk (fresh read after activation saved the file)
  const freshCheck = integrity.checkLicense();
  if (!freshCheck.ok) return false;
  if (activateWin && !activateWin.isDestroyed()) activateWin.close();
  setTimeout(createWindow, 300);
  return true;
});
ipcMain.handle('gb:activateLicense', async (_, key) => await integrity.activateLicense(key));
ipcMain.handle('gb:saveTier', (_, tier) => gb.saveTier(tier));
ipcMain.handle('gb:getTier',  ()         => gb.getTier());
ipcMain.handle('gb:clearLicense', () => { try { const f = require('path').join(require('os').homedir(), '.ghostbar_license'); if (require('fs').existsSync(f)) require('fs').unlinkSync(f); } catch {} return true; });
ipcMain.handle('gb:autoTrustCert', ()      => gb.autoTrustCert());

// ── Fix any leftover proxy from previous crash ───────────────
try { if (gb.checkAndFixLeftoverProxy) gb.checkAndFixLeftoverProxy(); } catch {}

// ── Lifecycle ─────────────────────────────────────────────────
app.whenReady().then(() => {
  // Layer 1: Integrity check — only block if we have a manifest AND files are tampered
  // Don't block on first install (no integrity.json yet) or missing files during dev
  if (!integrityResult.ok && !integrityResult.firstRun && integrityResult.tampered && integrityResult.tampered.length > 0) {
    showActivateWindow({ tampered: integrityResult.tampered, msg: integrityResult.reason });
    return;
  }
  // Layer 2: License check — always read fresh from disk
  const currentLicense = integrity.checkLicense();
  if (!currentLicense.ok) {
    showLockedWindow();
  } else {
    createWindow();
  }

  app.on('activate', () => {
    // User clicked dock icon — just reopen the window
    // NEVER re-check license here — user already activated this session
    // License is only checked on cold start (app.whenReady above)
    const allWins = BrowserWindow.getAllWindows();
    if (allWins.length === 0) {
      // Window was closed — reopen it (no license re-check)
      createWindow();
    } else {
      // Window exists but hidden — just show it
      allWins[0].show();
    }
  });
});

// ── Ensure network is ALWAYS restored on exit ────────────────
// Called on: normal quit, force quit, crash, Cmd+Q, window close
function emergencyRestore() {
  try { gb.stop(); } catch {}
  try { keyServer.close(); } catch {}
}

app.on('before-quit', () => { app.isQuitting = true; emergencyRestore(); });
app.on('will-quit',   emergencyRestore);

// Handle process signals (force kill, crash)
process.on('SIGTERM', () => { emergencyRestore(); process.exit(0); });
process.on('SIGINT',  () => { emergencyRestore(); process.exit(0); });
process.on('uncaughtException', (err) => {
  // Only emergency restore + exit for fatal errors, not all exceptions
  console.error('Uncaught exception:', err.message);
  // Don't kill the app for minor errors (e.g. port already in use)
  if (err.code === 'EADDRINUSE') {
    console.log('Port 9999 already in use — key server skipped');
    return;
  }
  // For truly fatal errors, restore network but keep app alive if possible
  try { if (gb && gb.checkAndFixLeftoverProxy) gb.checkAndFixLeftoverProxy(); } catch {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
