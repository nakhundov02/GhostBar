/**
 * src/renderer.js — GhostBar UI logic.
 * All backend calls go through window.ghostbarAPI (preload.js).
 */

const api = window.ghostbarAPI;
let keyVisible       = false;
let certShownOnce    = false;

function $(id) { return document.getElementById(id); }

// ── Message box ───────────────────────────────────────────────
function setMessage(text, type = 'info') {
  const box = $('messageBox');
  box.textContent = text;
  box.className   = `message-box ${type}`;
}

// ── Activity list ─────────────────────────────────────────────
function setActivity(items) {
  // Each item: string  → muted bullet
  //            { text, ok }  → green check
  //            { text, warn } → amber warn
  $('activityList').innerHTML = items.map(item => {
    if (typeof item === 'string') {
      return `<div class="activity-item"><span class="check muted">•</span><span>${item}</span></div>`;
    }
    const cls  = item.ok ? 'ok' : item.warn ? 'warn' : 'muted';
    const icon = item.ok ? '✓' : item.warn ? '!' : '•';
    return `<div class="activity-item"><span class="check ${cls}">${icon}</span><span>${item.text}</span></div>`;
  }).join('');
}

// ── Apply full status to UI ───────────────────────────────────
function applyStatus(s) {
  // Pill
  $('topStatus').textContent = s.running ? 'Running' : 'Waiting';
  $('topStatus').className   = s.running ? 'status-pill active' : 'status-pill';

  // Proxy cards
  $('webProxyValue').textContent    = s.webProxy;
  $('secureProxyValue').textContent = s.secureProxy;
  $('webDot').className   = s.webProxyOn   ? 'dot on' : 'dot off';
  $('httpsDot').className = s.httpsProxyOn ? 'dot on' : 'dot off';

  // API card
  $('apiValue').textContent = s.apiLabel;
  $('apiDot').className     = s.hasKey ? 'dot on' : 'dot off';

  // Hero
  if (s.running) {
    $('heroBanner').textContent    = '✦ GhostBar is running';
    $('heroBanner').className      = 'hero-banner active';
    $('runningSubtext').textContent = 'Proxy active. Open any site → click ✦ for Gemini.';
  } else {
    $('heroBanner').textContent    = 'GhostBar is waiting';
    $('heroBanner').className      = 'hero-banner waiting';
    $('runningSubtext').textContent = 'Press Start to activate.';
  }
}

// ── Auto-refresh status every 2 seconds when running ─────────
let _statusPoller = null;

function startStatusPoller() {
  if (_statusPoller) return;
  _statusPoller = setInterval(async () => {
    try {
      const s = await api.getStatus();
      applyStatus(s);
      // If mitmproxy died (watchdog killed it), update UI
      if (!s.running && $('startBtn').disabled) {
        $('startBtn').disabled    = false;
        $('startBtn').textContent = 'Start GhostBar';
        $('stopBtn').style.display  = 'none';
        $('startBtn').style.display = '';
        stopStatusPoller();
      }
    } catch {}
  }, 2000);
}

function stopStatusPoller() {
  if (_statusPoller) { clearInterval(_statusPoller); _statusPoller = null; }
}

// ── START ─────────────────────────────────────────────────────
async function startGhostBar() {
  $('startBtn').textContent = 'Starting…';
  $('startBtn').disabled    = true;
  // Safety: always re-enable button after 15 seconds max
  var safetyTimer = setTimeout(function() {
    if ($('startBtn').disabled) {
      $('startBtn').disabled    = false;
      $('startBtn').textContent = 'Start GhostBar';
    }
  }, 15000);
  $('heroBanner').textContent = 'Starting GhostBar…';
  $('heroBanner').className   = 'hero-banner waiting';

  setActivity([
    'Launching mitmproxy…',
    'Enabling system proxy…',
    'Connecting Gemini…'
  ]);

  clearTimeout(safetyTimer);
  const s = await api.start();
  applyStatus(s);
  if (s.running) startStatusPoller();

  const items = [];

  if (s.mitmOk === false) {
    items.push({ text: `mitmproxy error: ${s.mitmMsg}`, warn: true });
  } else {
    items.push({ text: 'mitmproxy running on 127.0.0.1:8080', ok: true });
  }

  if (s.proxyOk === false) {
    items.push({ text: `Proxy error: ${s.proxyMsg}`, warn: true });
  } else {
    items.push({ text: 'System proxy enabled (HTTP + HTTPS)', ok: true });
  }

  items.push(s.hasKey
    ? { text: 'Gemini API key loaded', ok: true }
    : { text: 'No Gemini key saved — paste one in Step 2', warn: true }
  );

  if (s.running) {
    items.push({ text: 'Open any website → click ✦ top-right for Gemini', ok: true });
  }

  setActivity(items);

  // Show certificate panel the first time the user starts
  if (!certShownOnce) {
    certShownOnce = true;
    $('certPanel').style.display = 'block';
  }

  $('startBtn').textContent = '▶  Start GhostBar';
  $('startBtn').disabled    = false;
}

// ── STOP ──────────────────────────────────────────────────────
async function stopGhostBar() {
  stopStatusPoller();
  $('stopBtn').textContent = 'Stopping…';
  $('stopBtn').disabled    = true;

  const s = await api.stop();
  applyStatus(s);
  setActivity([
    { text: 'mitmproxy stopped', ok: true },
    { text: 'System proxy disabled', ok: true },
    'Ready for next launch'
  ]);

  $('certPanel').style.display = 'none';
  $('stopBtn').textContent = '■  Stop GhostBar';
  $('stopBtn').disabled    = false;
}

// ── TIER — auto-detected from API key ─────────────────────────
// Calls both v1beta (free) and v1 (paid) endpoints
// If v1 works → paid. If only v1beta works → free.
async function autoDetectTier(apiKey) {
  if (!apiKey || !apiKey.startsWith('AIza')) return;
  $('tierSpinner').style.display = '';
  $('tierFreeBtn').classList.remove('tier-active','tier-paid-active');
  $('tierPaidBtn').classList.remove('tier-active','tier-paid-active');
  $('tierInfo').textContent = 'Detecting tier from your API key…';

  const body = JSON.stringify({
    contents: [{ role:'user', parts:[{ text:'hi' }] }],
    generationConfig: { maxOutputTokens: 1 }
  });
  const model = 'gemini-2.0-flash-lite';

  // Test paid (v1) endpoint first
  let isPaid = false;
  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1/models/' + model + ':generateContent?key=' + apiKey,
      { method:'POST', headers:{'Content-Type':'application/json'}, body, signal: AbortSignal.timeout(8000) }
    );
    const j = await r.json();
    // Paid endpoint works if no billing error
    const err = (j.error && j.error.message) || '';
    const isBillingError = err.includes('billing') || err.includes('PERMISSION_DENIED') || err.includes('not enabled');
    if (!j.error || !isBillingError) isPaid = true;
  } catch {}

  $('tierSpinner').style.display = 'none';
  const tier = isPaid ? 'paid' : 'free';
  await api.saveTier(tier);

  if (isPaid) {
    $('tierPaidBtn').classList.add('tier-paid-active');
    $('tierFreeBtn').classList.remove('tier-active');
    $('tierInfo').textContent = '✓ Paid tier detected — no rate limits, pay-per-token.';
  } else {
    $('tierFreeBtn').classList.add('tier-active');
    $('tierPaidBtn').classList.remove('tier-paid-active');
    $('tierInfo').textContent = '✓ Free tier detected — ~15 requests/min. Enable billing on Google AI Studio for unlimited.';
  }
}

// ── SAVE KEY ──────────────────────────────────────────────────
async function saveKey() {
  const key = $('apiKeyInput').value.trim();
  const s   = await api.saveKey(key);
  applyStatus(s);
  setMessage(key ? '✓ API key saved successfully. Detecting tier…' : 'Saved an empty key.', key ? 'success' : 'error');
  if (key) autoDetectTier(key);
}

// ── TEST KEY ──────────────────────────────────────────────────
async function testKey() {
  const key = $('apiKeyInput').value.trim();
  if (!key) { setMessage('Paste your API key first.', 'error'); return; }

  const fmt = await api.validateKey(key);
  if (!fmt.ok) { setMessage(fmt.msg, 'error'); return; }

  setMessage('Testing live connection to Gemini…', 'info');
  $('testBtn').textContent = 'Testing…';
  $('testBtn').disabled    = true;

  const live = await api.testKeyLive(key);
  setMessage(live.msg, live.ok ? 'success' : 'error');
  if (live.ok) { $('apiValue').textContent = 'Connected'; $('apiDot').className = 'dot on'; }

  $('testBtn').textContent = 'Test Connection';
  $('testBtn').disabled    = false;
}

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {

  // Intercept ALL external link clicks → open in default browser
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      e.preventDefault();
      api.openExternal(href);
    }
  });

  // Google AI Studio button (not an anchor, so handle separately)
  $('openStudioBtn').addEventListener('click', () => {
    api.openExternal('https://aistudio.google.com/app/apikey');
  });

  // Keychain Access button
  // Auto-trust certificate button
  $('autoTrustBtn')?.addEventListener('click', async () => {
    const btn  = $('autoTrustBtn');
    const note = $('autoTrustNote');
    btn.disabled    = true;
    btn.textContent = '⏳ Trusting certificate…';
    note.textContent = 'macOS may ask for your password — click OK to allow.';
    try {
      const result = await api.autoTrustCert();
      if (result.ok) {
        btn.textContent      = '✅ Certificate Trusted!';
        btn.style.background = '#1a7a3a';
        note.textContent     = result.msg;
        note.style.color     = '#4ade80';
      } else {
        btn.disabled    = false;
        btn.textContent = '✅ Trust Certificate Automatically';
        note.textContent = '⚠ ' + result.msg;
        note.style.color = '#f87171';
        $('manualSteps').style.display = 'block';
      }
    } catch(e) {
      btn.disabled    = false;
      btn.textContent = '✅ Trust Certificate Automatically';
      note.textContent = '⚠ Error: ' + e.message;
      note.style.color = '#f87171';
    }
  });

  $('openKeychainBtn').addEventListener('click', () => {
    api.openExternal('x-apple.systempreferences:');
    // Fallback: open Finder to Keychain app
    setTimeout(() => {
      try { require('child_process'); } catch {}
    }, 100);
  });

  // Pre-fill saved key
  const savedKey = await api.getKey();
  if (savedKey) $('apiKeyInput').value = savedKey;

  // Show saved tier immediately (no spinner), then quietly re-verify
  try {
    const savedTier = await api.getTier();
    if (savedTier === 'paid') {
      $('tierPaidBtn').classList.add('tier-paid-active');
      $('tierInfo').textContent = '✓ Paid tier — no rate limits, pay-per-token.';
    } else {
      $('tierFreeBtn').classList.add('tier-active');
      $('tierInfo').textContent = '✓ Free tier — ~15 requests/min.';
    }
  } catch {
    $('tierFreeBtn').classList.add('tier-active');
  }
  // Re-verify tier in background (don't await — let UI load first)
  if (savedKey) setTimeout(() => autoDetectTier(savedKey), 1500);

  // Load current state
  const status = await api.getStatus();
  applyStatus(status);
  if (status.running) {
    $('certPanel').style.display = 'block';
    certShownOnce = true;
  }

  // Paste
  $('pasteBtn').addEventListener('click', async () => {
    try {
      const text = await api.paste();
      if (text && text.trim()) {
        $('apiKeyInput').value = text.trim();
        setMessage('Pasted from clipboard.', 'info');
      }
    } catch { setMessage('Clipboard read failed. Paste manually.', 'error'); }
  });

  // Show/Hide
  $('showBtn').addEventListener('click', () => {
    keyVisible = !keyVisible;
    $('apiKeyInput').type    = keyVisible ? 'text' : 'password';
    $('showBtn').textContent = keyVisible ? 'Hide' : 'Show';
  });

  // Tier is read-only — no click listeners on chips
  $('testBtn').addEventListener('click', testKey);
  $('saveBtn').addEventListener('click', saveKey);
  $('startBtn').addEventListener('click', startGhostBar);
  $('stopBtn').addEventListener('click', stopGhostBar);

  $('refreshUiBtn').addEventListener('click', async () => {
    const s = await api.getStatus();
    applyStatus(s);
    setMessage('Status refreshed.', 'info');
  });

  // Live dot update while typing
  $('apiKeyInput').addEventListener('input', () => {
    const has = $('apiKeyInput').value.trim().startsWith('AIza');
    $('apiDot').className     = has ? 'dot on' : 'dot off';
    $('apiValue').textContent = has ? 'Connected' : 'Not Connected';
  });
});
