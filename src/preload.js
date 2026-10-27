'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const methods = ['status', 'shortcut', 'signIn', 'cancelSignIn', 'switchAccount', 'signOut', 'models', 'model',
  'provider', 'saveGemini', 'clearGemini', 'noticeSeen', 'usage', 'start', 'stop', 'certificate', 'openChat'];
const api = {};
for (const method of methods) {
  api[method] = async (...args) => {
    const result = await ipcRenderer.invoke('gb:' + method, ...args);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };
}
contextBridge.exposeInMainWorld('ghostbarAPI', api);
