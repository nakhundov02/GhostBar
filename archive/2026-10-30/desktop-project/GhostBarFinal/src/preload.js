const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ghostbarAPI', {
  openExternal:    (url) => ipcRenderer.invoke('gb:openExternal', url),
  getStatus:       ()    => ipcRenderer.invoke('gb:status'),
  saveKey:         (k)   => ipcRenderer.invoke('gb:saveKey', k),
  getKey:          ()    => ipcRenderer.invoke('gb:getKey'),
  validateKey:     (k)   => ipcRenderer.invoke('gb:validateKey', k),
  testKeyLive:     (k)   => ipcRenderer.invoke('gb:testKeyLive', k),
  start:           ()    => ipcRenderer.invoke('gb:start'),
  stop:            ()    => ipcRenderer.invoke('gb:stop'),
  chat:            (h)   => ipcRenderer.invoke('gb:chat', h),
  paste:           ()    => ipcRenderer.invoke('gb:paste'),
  licenseOk:       ()    => ipcRenderer.invoke('gb:licenseOk'),
  autoTrustCert:   ()    => ipcRenderer.invoke('gb:autoTrustCert'),
  activateLicense: (k)   => ipcRenderer.invoke('gb:activateLicense', k),
  clearLicense:    ()    => ipcRenderer.invoke('gb:clearLicense'),
  getTier:         ()    => ipcRenderer.invoke('gb:getTier'),
  saveTier:        (t)   => ipcRenderer.invoke('gb:saveTier', t),
});
