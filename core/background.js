'use strict';
const { Vault } = require('./storage');
const { Preferences } = require('./preferences');
const { ChatGPT, USAGE_URL } = require('./chatgpt');
const { createBridge } = require('./bridge');
const { ProxyController } = require('./ghostbar');
const { socketPath, serve } = require('./service-channel');

async function createBackground({ directory, root, resources, safeStorage, shell, quit, proxyRun, fetchImpl }) {
  const vault = new Vault(directory, safeStorage);
  const preferences = new Preferences(directory);
  const ai = new ChatGPT({ vault, openExternal: url => shell.openExternal(url), fetchImpl });
  const bridge = await createBridge({ ai, root, getShortcut: () => preferences.shortcut });
  const proxy = new ProxyController({ directory, root, resources, bridge, run: proxyRun });
  try { proxy.restore(); } catch (error) { proxy.lastError = error.message; }
  let releaseTimer;
  const status = () => {
    clearTimeout(releaseTimer);
    return { ...ai.status(), shortcut: preferences.shortcut, proxy: proxy.status(), servicePid: process.pid };
  };
  const actions = {
    status,
    shortcut: value => { preferences.setShortcut(value); return status(); },
    signIn: id => ai.signIn(typeof id === 'string' ? id : ''),
    cancelSignIn: () => { ai.cancelSignIn(); return status(); },
    switchAccount: id => { ai.switchAccount(id); return status(); },
    signOut: () => ai.signOut(),
    models: () => ai.models(true),
    model: async id => {
      if (!(await ai.models()).some(m => m.id === id)) throw new Error('Choose an available model.');
      ai.profile.model = id; vault.save(); return status();
    },
    provider: provider => {
      if (!['chatgpt', 'gemini'].includes(provider)) throw new Error('Unknown AI provider.');
      ai.abortRequests(); ai.data.provider = provider; vault.save(); return status();
    },
    saveGemini: (key, model) => {
      if (typeof key !== 'string' || typeof model !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Enter a valid Gemini model.');
      if (key.trim()) ai.data.geminiKey = key.trim();
      ai.data.geminiModel = model; vault.save(); return status();
    },
    clearGemini: () => { delete ai.data.geminiKey; vault.save(); return status(); },
    noticeSeen: () => { if (ai.profile) { ai.profile.noticeSeen = true; vault.save(); } },
    usage: () => shell.openExternal(USAGE_URL),
    start: () => proxy.start(),
    stop: () => proxy.stop(),
    certificate: async () => {
      const cert = await proxy.prepareCertificate();
      const error = await shell.openPath(cert);
      if (error) throw new Error(error);
      return 'In Keychain Access, open the mitmproxy certificate, expand Trust, and set Secure Sockets Layer (SSL) to Always Trust. macOS will ask you to confirm.';
    },
    openChat: () => {
      if (!proxy.running) throw new Error('Start the proxy first.');
      return shell.openExternal('https://ghostbar.test/');
    },
    release: () => {
      // Quitting the control app must never stop an active proxy or sign-in.
      if (!proxy.running && !proxy.starting && !ai.pending) releaseTimer = setTimeout(quit, 100);
    }
  };
  let server;
  try { server = await serve(socketPath(directory), actions); }
  catch (error) { bridge.close(); throw error; }
  return {
    close() {
      clearTimeout(releaseTimer);
      ai.cancelSignIn(); ai.abortRequests();
      try { proxy.stop(); } finally { server.close(); bridge.close(); }
    }
  };
}
module.exports = { createBackground };
