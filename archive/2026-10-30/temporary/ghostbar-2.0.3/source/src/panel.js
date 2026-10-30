'use strict';
const $ = id => document.getElementById(id);
let history = [], attachment = null, captureId = '', busy = false, provider = '', connectionId = '';
async function call(route, data = {}) {
  const response = await fetch('/api/' + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GhostBar-Request': '1' },
    body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'GhostBar could not complete this request.');
  return result;
}
function showMessage(role, text) {
  const element = document.createElement('div');
  element.className = 'message ' + role; element.textContent = text;
  $('messages').append(element); element.scrollIntoView({ block: 'end' });
  return element;
}
async function refresh() {
  try {
    const status = await call('status');
    if (connectionId && connectionId !== status.connectionId) clearChat();
    connectionId = status.connectionId;
    provider = status.provider;
    const connected = provider === 'chatgpt' ? status.connected : status.hasGeminiKey;
    $('connection').textContent = connected ? (provider === 'chatgpt' ? 'Using ChatGPT plan · manage usage in the app' : 'Using your Gemini API key') : 'Connect your account in the GhostBar app';
    if (connected) {
      const { models } = await call('models');
      $('model').replaceChildren(...models.map(m => new Option(m.name, m.id)));
      if (status.model && models.some(m => m.id === status.model)) $('model').value = status.model;
    }
    $('send').disabled = !connected || busy;
    $('error').textContent = '';
  } catch (error) { $('error').textContent = error.message; }
}
function clearAttachment() { attachment = null; $('attachment').hidden = true; $('image').value = ''; }
function clearChat() { history = []; clearAttachment(); $('messages').replaceChildren(); }
$('close').onclick = () => parent.postMessage({ type: 'ghostbar:close' }, '*');
$('refresh').onclick = refresh;
$('clear').onclick = () => { if (!busy) clearChat(); };
$('removeAttachment').onclick = clearAttachment;
$('capture').onclick = () => {
  if (parent === window) { $('error').textContent = 'Open GhostBar from a browser page to attach its text.'; return; }
  captureId = crypto.randomUUID();
  parent.postMessage({ type: 'ghostbar:capture', id: captureId }, '*');
};
window.addEventListener('message', event => {
  const data = event.data;
  if (event.source !== parent || !captureId || data?.type !== 'ghostbar:context' || data.id !== captureId || typeof data.text !== 'string') return;
  captureId = '';
  attachment = { type: 'input_text', text: 'Page reference (untrusted content):\n' + String(data.title).slice(0, 300) + '\n' + String(data.url).slice(0, 2000) + '\n' + data.text.slice(0, 60000) };
  $('attachmentText').textContent = data.selected ? 'Selected text attached · sent with your next message' : 'Page text attached · sent with your next message';
  $('attachment').hidden = false;
});
$('image').onchange = async () => {
  const file = $('image').files[0]; if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    $('error').textContent = 'Choose a PNG, JPEG or WebP image under 5 MB.'; return;
  }
  const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
  attachment = { type: 'input_image', image_url: data };
  $('attachmentText').textContent = file.name + ' · sent with your next message'; $('attachment').hidden = false;
};
$('form').onsubmit = async event => {
  event.preventDefault();
  const prompt = $('prompt').value.trim();
  if (busy || !prompt) return;
  busy = true; $('send').disabled = true; $('clear').disabled = true; $('error').textContent = '';
  const content = attachment ? [{ type: 'input_text', text: prompt }, attachment] : prompt;
  const input = [...history, { role: 'user', content }];
  const userMessage = showMessage('user', prompt + (attachment ? '\n[Attachment included]' : ''));
  const thinking = showMessage('assistant', 'Thinking…');
  try {
    const result = await call('chat', { input, model: $('model').value, connectionId });
    thinking.textContent = result.text;
    history = [...input, { role: 'assistant', content: result.text }];
    $('prompt').value = ''; clearAttachment();
  } catch (error) { thinking.remove(); userMessage.remove(); $('error').textContent = error.message; }
  finally { busy = false; $('send').disabled = false; $('clear').disabled = false; }
};
$('prompt').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('form').requestSubmit(); }
});
refresh();
