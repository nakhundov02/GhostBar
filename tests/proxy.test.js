'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProxyController, TLS_PASSTHROUGH } = require('../core/ghostbar');
function setup(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostbar-test-'));
  const p = new ProxyController({ directory, root: directory, bridge: {}, run });
  return { p, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}
test('Apple cloud and AI account services retain end-to-end TLS', () => {
  const passthrough = new RegExp(TLS_PASSTHROUGH);
  for (const host of ['api.openai.com', 'auth.openai.com', 'chatgpt.com', 'generativelanguage.googleapis.com', 'p01-content.icloud.com', 'cvws.icloud-content.com', 'api.apple-cloudkit.com', 'idmsa.apple.com', 'appleid.cdn-apple.com', 'probe.icloud.com']) {
    assert.equal(passthrough.test(host + ':443'), true, host);
  }
  for (const host of ['ghostbar.test', 'example.com', 'icloud.com.other.test', 'fakeapple.com']) {
    assert.equal(passthrough.test(host + ':443'), false, host);
  }
});
test('Monitor servers and their documented CDN dependencies keep their original TLS sessions', () => {
  const passthrough = new RegExp(TLS_PASSTHROUGH);
  for (const host of ['smc-service-cloud.respondus2.com', 'download.respondus.com', 'static-public-downloads-cloud.respondus.com', 'server-profiles-respondus-com.s3-external-1.amazonaws.com', 'd1hvyp8wapcgir.cloudfront.net', 'support.knowledgeowl.com']) {
    assert.equal(passthrough.test(host + ':443'), true, host);
  }
  for (const host of ['ghostbar.test', 'example.com', 'respondus2.com.other.test', 'fakerespondus.com', 'cloudfront.net.other.test']) {
    assert.equal(passthrough.test(host + ':443'), false, host);
  }
});
test('stopping without a backup never changes unrelated proxy settings', () => {
  const { p, cleanup } = setup(() => { throw new Error('Must not run networksetup'); });
  try { p.stop(); } finally { cleanup(); }
});
test('restore preserves existing proxy hosts and enabled states', () => {
  const calls = [];
  const { p, cleanup } = setup((command, args) => { calls.push(args); return ''; });
  try {
    fs.writeFileSync(p.backup, JSON.stringify({ 'Wi-Fi': {
      webproxy: { server: 'office.local', port: '3128', enabled: true },
      securewebproxy: { server: '', port: '0', enabled: false }
    } }));
    p.restore();
    assert.deepEqual(calls, [
      ['-setwebproxy', 'Wi-Fi', 'office.local', '3128'],
      ['-setwebproxystate', 'Wi-Fi', 'on'], ['-setsecurewebproxystate', 'Wi-Fi', 'off']
    ]);
    assert.equal(fs.existsSync(p.backup), false);
  } finally { cleanup(); }
});
test('failed restoration keeps recovery data for the next launch', () => {
  const { p, cleanup } = setup(() => { throw new Error('denied'); });
  try {
    fs.writeFileSync(p.backup, JSON.stringify({ 'Wi-Fi': {
      webproxy: { server: '', port: '0', enabled: false },
      securewebproxy: { server: '', port: '0', enabled: false }
    } }));
    assert.throws(() => p.restore(), /kept/);
    assert.equal(fs.existsSync(p.backup), true);
  } finally { cleanup(); }
});
test('network service names are arguments, never shell commands', () => {
  const name = 'Wi-Fi $(do-not-execute)';
  const calls = [];
  const { p, cleanup } = setup((command, args) => {
    calls.push(args);
    if (args[0] === '-listallnetworkservices') return 'An asterisk denotes disabled services.\n' + name + '\n*Disabled\n';
    return 'Enabled: No\nServer: \nPort: 0\nAuthenticated Proxy Enabled: 0\n';
  });
  try {
    assert.deepEqual(Object.keys(p.snapshot()), [name]);
    assert.equal(calls[1][1], name);
  } finally { cleanup(); }
});

test('a newly attached adapter is backed up, configured, and restored on stop', () => {
  let names = ['Wi-Fi'];
  const settings = {
    'Wi-Fi': { webproxy: { enabled: false, server: '', port: '0' }, securewebproxy: { enabled: false, server: '', port: '0' } },
    Ethernet: { webproxy: { enabled: true, server: 'office.test', port: '8080' }, securewebproxy: { enabled: false, server: '', port: '0' } }
  };
  const { p, cleanup } = setup((command, [action, name, value, port]) => {
    if (action === '-listallnetworkservices') return 'Services\n' + names.join('\n');
    const kind = action.includes('securewebproxy') ? 'securewebproxy' : 'webproxy';
    const item = settings[name][kind];
    if (action.startsWith('-get')) return `Enabled: ${item.enabled ? 'Yes' : 'No'}\nServer: ${item.server}\nPort: ${item.port}\nAuthenticated Proxy Enabled: 0\n`;
    if (action.endsWith('state')) item.enabled = value === 'on';
    else { item.server = value; item.port = port; }
    return '';
  });
  try {
    p.port = 12345; p.snapshot(); p.running = true;
    p.reconcileNetworks();
    names.push('Ethernet'); p.reconcileNetworks();
    assert.equal(settings.Ethernet.webproxy.server, '127.0.0.1');
    assert.equal(settings.Ethernet.securewebproxy.enabled, true);
    assert.equal(JSON.parse(fs.readFileSync(p.backup)).Ethernet.webproxy.server, 'office.test');
    // A network transition that resets the system proxy gets repaired.
    settings['Wi-Fi'].securewebproxy.enabled = false;
    p.reconcileNetworks();
    assert.equal(settings['Wi-Fi'].securewebproxy.enabled, true);
    p.stop();
    assert.deepEqual(settings.Ethernet.webproxy, { enabled: true, server: 'office.test', port: '8080' });
    assert.equal(settings.Ethernet.securewebproxy.enabled, false);
    assert.equal(settings['Wi-Fi'].webproxy.enabled, false);
  } finally { p.stop(); cleanup(); }
});

test('network watcher stops before restoring settings', () => {
  const { p, cleanup } = setup(() => { throw new Error('Unexpected network command'); });
  try {
    p.watchNetworks();
    const timer = p.networkTimer;
    p.stop();
    assert.equal(timer._destroyed, true);
  } finally { cleanup(); }
});
