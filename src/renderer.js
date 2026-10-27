'use strict';
const api = window.ghostbarAPI;
const shortcuts = window.GhostBarShortcut;
let recordingShortcut = false;
const $ = id => document.getElementById(id);
let previousAccount = '', wasConnected = false, busy = false, lastError = '';
function message(text, error = false) {
  $('messageBox').textContent = text;
  $('messageBox').className = 'message-box ' + (error ? 'error' : 'success');
}
async function action(button, task) {
  const target = $(button); target.disabled = true; busy = true;
  try { await task(); await refresh(); } catch (error) { message(error.message, true); }
  finally { target.disabled = false; busy = false; }
}
async function loadModels() {
  const models = await api.models();
  $('models').replaceChildren(...models.map(m => new Option(m.name, m.id)));
  const state = await api.status();
  $('models').value = state.model;
  $('models').disabled = false;
}
async function refresh() {
  const s = await api.status();
  $('shortcutValue').textContent = shortcuts.label(s.shortcut || shortcuts.DEFAULT);
  $('provider').value = s.provider;
  $('chatgptSettings').classList.toggle('hidden', s.provider !== 'chatgpt');
  $('geminiSettings').classList.toggle('hidden', s.provider !== 'gemini');
  const options = [new Option('Add a ChatGPT account', ''), ...s.accounts.map(a => new Option(a.label, a.id))];
  $('accounts').replaceChildren(...options);
  $('accounts').value = s.activeId;
  $('accountStatus').textContent = s.signingIn ? 'Finish signing in in your browser…' : s.connected ? 'Connected · Using ChatGPT plan' : 'Not connected. Continue with ChatGPT to enable plan usage.';
  $('signIn').disabled = s.signingIn;
  $('addAccount').disabled = s.signingIn;
  $('cancelSignIn').classList.toggle('hidden', !s.signingIn);
  $('signOut').disabled = !s.connected;
  $('geminiStatus').textContent = s.hasGeminiKey ? 'Your key is saved securely on this Mac.' : 'No key saved.';
  $('geminiModel').placeholder = s.geminiModel;
  $('topStatus').textContent = s.proxy.running ? 'Running' : 'Ready';
  $('topStatus').className = 'status-pill' + (s.proxy.running ? ' active' : '');
  $('heroBanner').textContent = s.proxy.running ? '✦ GhostBar is running' : 'Ready when you are';
  $('heroBanner').className = 'hero-banner ' + (s.proxy.running ? 'active' : 'waiting');
  $('proxyAddress').textContent = s.proxy.address;
  $('start').disabled = s.proxy.running || s.proxy.starting;
  $('stop').disabled = !s.proxy.running && !s.proxy.error;
  $('openChat').disabled = !s.proxy.running;
  const error = s.signInError || s.proxy.error;
  if (error && error !== lastError) message(error, true);
  lastError = error;
  if (s.connected && (!wasConnected || previousAccount !== s.activeId)) {
    previousAccount = s.activeId; wasConnected = true;
    try { await loadModels(); } catch (error) { message(error.message, true); }
  }
  if (!s.connected) {
    wasConnected = false;
    $('models').replaceChildren(new Option('Connect your account first', ''));
    $('models').disabled = true;
  }
  if (s.usageNotice && !$('welcome').open) $('welcome').showModal();
}
$('signIn').onclick = () => action('signIn', () => api.signIn($('accounts').value));
$('addAccount').onclick = () => action('addAccount', () => api.signIn(''));
$('cancelSignIn').onclick = () => action('cancelSignIn', () => api.cancelSignIn());
$('accounts').onchange = () => action('accounts', () => $('accounts').value ? api.switchAccount($('accounts').value) : api.signIn(''));
$('signOut').onclick = () => action('signOut', async () => message((await api.signOut()).message));
$('provider').onchange = () => action('provider', () => api.provider($('provider').value));
$('models').onchange = () => action('models', () => api.model($('models').value));
$('refreshModels').onclick = () => action('refreshModels', loadModels);
$('usage').onclick = () => action('usage', () => api.usage());
$('welcomeDone').onclick = async () => { await api.noticeSeen(); $('welcome').close(); };
$('welcome').addEventListener('cancel', () => api.noticeSeen());
$('saveGemini').onclick = () => action('saveGemini', async () => {
  await api.saveGemini($('geminiKey').value, $('geminiModel').value.trim());
  $('geminiKey').value = ''; message('Gemini connection saved.');
});
$('clearGemini').onclick = () => action('clearGemini', () => api.clearGemini());
$('certificate').onclick = () => action('certificate', async () => message(await api.certificate()));
$('start').onclick = () => action('start', async () => { await api.start(); message('Proxy is running in the background. You can close GhostBar. Reload a browser page and click its top-right corner.'); });
$('stop').onclick = () => action('stop', async () => { await api.stop(); message('GhostBar stopped. Your proxy settings were restored.'); });
$('openChat').onclick = () => action('openChat', () => api.openChat());
refresh().catch(error => message(error.message, true));
setInterval(() => { if (!busy) refresh().catch(error => message(error.message, true)); }, 1500);

function recordShortcut(active) {
  recordingShortcut = active;
  $('changeShortcut').textContent = active ? 'Cancel recording' : 'Change shortcut';
  $('changeShortcut').setAttribute('aria-pressed', String(active));
  $('shortcutHint').textContent = active ? 'Press your key combination now. Use Control, Option, or Command plus another key. Escape cancels.' : 'Works on a loaded browser page, even after closing GhostBar. Reload webpages after changing the shortcut.';
}
$('changeShortcut').onclick = () => recordShortcut(!recordingShortcut);
$('resetShortcut').onclick = () => action('resetShortcut', async () => {
  recordShortcut(false); await api.shortcut(shortcuts.DEFAULT); message('Default shortcut restored: Control + `. Reload your webpages.');
});
document.addEventListener('keydown', event => {
  if (!recordingShortcut) return;
  event.preventDefault(); event.stopPropagation();
  if (event.key === 'Escape') { recordShortcut(false); return; }
  if (event.repeat || event.isComposing || ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
  let shortcut;
  try { shortcut = shortcuts.normalize({ enabled: true, code: event.code, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey }); }
  catch (error) { $('shortcutHint').textContent = error.message; return; }
  recordShortcut(false);
  action('changeShortcut', async () => {
    await api.shortcut(shortcut); message('Shortcut saved: ' + shortcuts.label(shortcut) + '. Reload your webpages.');
  });
}, true);
window.addEventListener('blur', () => { if (recordingShortcut) recordShortcut(false); });
