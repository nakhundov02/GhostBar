'use strict';
const { app, BrowserWindow, ipcMain, shell, safeStorage, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { fileURLToPath } = require('node:url');
const { connectService } = require('../core/service-client');
const { createBackground } = require('../core/background');

app.setName('GhostBar');
const root = path.join(__dirname, '..');
const isService = process.argv.includes('--ghostbar-service');
const directory = process.env.GHOSTBAR_DATA_DIR || app.getPath('userData');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
// Separate locks let the control app quit/reopen without replacing its service.
app.setPath('userData', isService ? path.join(directory, 'background-runtime') : directory);
let win, callService, serviceReady, background, quitting = false;
const ownsLock = app.requestSingleInstanceLock();

function showWindow() {
  if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }
  win = new BrowserWindow({
    width: 1220, height: 900, minWidth: 850, minHeight: 650,
    title: 'GhostBar', backgroundColor: '#0B0B0F', titleBarStyle: 'hiddenInset',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
}
function handle(name) {
  ipcMain.handle('gb:' + name, async (event, ...args) => {
    const url = event.senderFrame?.url || '';
    let trusted = false;
    try { trusted = url.startsWith('file:') && fileURLToPath(url) === path.join(__dirname, 'index.html'); } catch {}
    if (!trusted || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted app frame.');
    try {
      const call = callService || await serviceReady;
      return { ok: true, value: await call(name, ...args) };
    }
    catch (error) { return { ok: false, error: error.message }; }
  });
}
if (!ownsLock) {
  app.quit();
} else {
  if (!isService) app.on('second-instance', () => { if (callService) showWindow(); });
  app.whenReady().then(async () => {
    if (isService) {
      app.dock?.hide();
      background = await createBackground({ directory, root,
        resources: app.isPackaged ? process.resourcesPath : null,
        safeStorage, shell, quit: () => app.quit()
      });
      return;
    }
    serviceReady = connectService({ directory, root, packaged: app.isPackaged });
    for (const method of ['status', 'shortcut', 'signIn', 'cancelSignIn', 'switchAccount', 'signOut', 'models', 'model',
      'provider', 'saveGemini', 'clearGemini', 'noticeSeen', 'usage', 'start', 'stop', 'certificate', 'openChat']) handle(method);
    showWindow();
    app.on('activate', showWindow);
    callService = await serviceReady;
  }).catch(error => {
    if (isService) fs.writeFileSync(path.join(directory, 'service-startup-error.txt'), error.message, { mode: 0o600 });
    else dialog.showErrorBox('GhostBar could not start', error.message);
    app.quit();
  });
}
app.on('before-quit', event => {
  if (quitting || !ownsLock) return;
  quitting = true;
  if (isService) {
    try { background?.close(); }
    catch (error) { fs.writeFileSync(path.join(directory, 'service-startup-error.txt'), error.message, { mode: 0o600 }); }
  } else if (callService) {
    event.preventDefault();
    // Release only stops an idle service. Active AI and proxy processes persist.
    Promise.race([callService('release'), new Promise(resolve => setTimeout(resolve, 1500))])
      .catch(() => {}).finally(() => app.quit());
  }
});
app.on('window-all-closed', () => { if (!isService) app.quit(); });
process.on('SIGTERM', () => app.quit());
process.on('SIGINT', () => app.quit());
