'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { execFileSync, spawn } = require('node:child_process');

class ProxyController {
  constructor({ directory, root, resources, bridge, run = execFileSync }) {
    this.directory = directory; this.root = root; this.resources = resources;
    this.bridge = bridge; this.run = run;
    this.backup = path.join(directory, 'proxy-backup.json');
    this.certDir = path.join(directory, 'mitmproxy');
    this.process = null; this.running = false; this.starting = false; this.port = 0;
    this.networkTimer = null;
  }
  network(...args) { return this.run('/usr/sbin/networksetup', args, { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }); }
  services() {
    return this.network('-listallnetworkservices').split('\n').slice(1).map(s => s.trim()).filter(s => s && !s.startsWith('*'));
  }
  readSettings(name, kind) {
    const text = this.network('-get' + kind, name);
    const value = {
      enabled: /^Enabled: Yes$/m.test(text),
      server: text.match(/^Server: (.*)$/m)?.[1] || '',
      port: text.match(/^Port: (\d+)$/m)?.[1] || '0'
    };
    if (value.enabled && /^Authenticated Proxy Enabled: (1|Yes)$/m.test(text)) {
      throw new Error('The ' + name + ' service uses an authenticated proxy. GhostBar cannot safely replace it.');
    }
    return value;
  }
  saveSnapshot(state) {
    fs.writeFileSync(this.backup + '.tmp', JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(this.backup + '.tmp', this.backup);
  }
  snapshot() {
    if (fs.existsSync(this.backup)) throw new Error('Restore the previous network settings before starting again.');
    const state = {};
    for (const name of this.services()) {
      state[name] = {};
      for (const kind of ['webproxy', 'securewebproxy']) {
        state[name][kind] = this.readSettings(name, kind);
      }
    }
    if (!Object.keys(state).length) throw new Error('No enabled network service was found.');
    this.saveSnapshot(state);
    return state;
  }
  reconcileNetworks() {
    if (!this.running) return;
    const state = JSON.parse(fs.readFileSync(this.backup, 'utf8'));
    const pending = [];
    for (const name of this.services()) {
      const current = {};
      for (const kind of ['webproxy', 'securewebproxy']) current[kind] = this.readSettings(name, kind);
      // Save a newly connected adapter before changing any of its settings.
      if (!Object.hasOwn(state, name)) state[name] = current;
      for (const [kind, value] of Object.entries(current)) {
        if (!value.enabled || value.server !== '127.0.0.1' || value.port !== String(this.port)) pending.push([name, kind]);
      }
    }
    if (!pending.length) return;
    this.saveSnapshot(state);
    for (const [name, kind] of pending) {
      this.network('-set' + kind, name, '127.0.0.1', String(this.port));
      this.network('-set' + kind + 'state', name, 'on');
    }
  }
  watchNetworks() {
    clearInterval(this.networkTimer);
    this.networkTimer = setInterval(() => {
      try { this.reconcileNetworks(); this.lastError = ''; }
      catch (error) { this.lastError = 'Network update: ' + error.message; }
    }, 5000);
    this.networkTimer.unref();
  }
  restore() {
    if (!fs.existsSync(this.backup)) return;
    const state = JSON.parse(fs.readFileSync(this.backup, 'utf8'));
    const errors = [];
    for (const [name, settings] of Object.entries(state)) {
      for (const kind of ['webproxy', 'securewebproxy']) {
        try {
          const previous = settings[kind];
          if (previous.server && previous.port !== '0') this.network('-set' + kind, name, previous.server, previous.port);
          this.network('-set' + kind + 'state', name, previous.enabled ? 'on' : 'off');
        } catch { errors.push(name); }
      }
    }
    if (errors.length) throw new Error('macOS could not restore proxy settings for ' + [...new Set(errors)].join(', ') + '. Retry Stop GhostBar; the recovery backup has been kept.');
    fs.unlinkSync(this.backup);
  }
  binary() {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const candidates = [
      path.join(this.resources || this.root, 'mitmproxy', arch, 'mitmproxy.app/Contents/MacOS/mitmdump'),
      path.join(this.root, 'runtime/mitmproxy', arch, 'mitmproxy.app/Contents/MacOS/mitmdump'),
      '/opt/homebrew/bin/mitmdump', '/usr/local/bin/mitmdump'
    ];
    const found = candidates.find(p => fs.existsSync(p));
    if (!found) throw new Error('Proxy runtime missing. From the source folder run npm run setup:proxy, then restart GhostBar.');
    return found;
  }
  async launch() {
    if (this.process) throw new Error('The proxy is already starting.');
    const binary = this.binary();
    this.port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port; server.close(() => resolve(port));
      });
    });
    const packagedAddon = path.join(this.resources || '', 'addon.py');
    const addon = fs.existsSync(packagedAddon) ? packagedAddon : path.join(this.root, 'core/addon.py');
    const snippet = fs.existsSync(path.join(this.resources || '', 'snippet.html')) ?
      path.join(this.resources, 'snippet.html') : path.join(this.root, 'src/snippet.html');
    fs.mkdirSync(this.certDir, { recursive: true, mode: 0o700 });
    const child = spawn(binary, [
      '--listen-host', '127.0.0.1', '--listen-port', String(this.port),
      '-q', '-s', addon, '--set', 'confdir=' + this.certDir,
      '--set', 'connection_strategy=lazy',
      '--ignore-hosts', '^(.*\\.)?(openai\\.com|chatgpt\\.com|googleapis\\.com):443$'
    ], {
      env: { ...process.env, GHOSTBAR_BRIDGE_PORT: String(this.bridge.port), GHOSTBAR_BRIDGE_SECRET: this.bridge.secret, GHOSTBAR_SNIPPET: snippet },
      stdio: ['ignore', 'ignore', 'pipe']
    });
    this.process = child;
    let failure = '';
    child.stderr.on('data', chunk => { failure = (failure + chunk.toString()).slice(-2000); });
    child.on('error', () => { failure = 'Proxy executable could not start.'; });
    child.on('exit', () => {
      if (this.process === child) {
        this.process = null;
        if (this.running) {
          this.running = false;
          clearInterval(this.networkTimer);
          try { this.restore(); } catch (error) { this.lastError = error.message; }
          this.lastError ||= 'The proxy stopped. Network settings were restored.';
        }
      }
    });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null || this.process !== child) throw new Error(failure || 'The proxy stopped during startup.');
      const ready = await new Promise(resolve => {
        const socket = net.createConnection({ host: '127.0.0.1', port: this.port });
        socket.setTimeout(150);
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => resolve(false));
        socket.once('timeout', () => { socket.destroy(); resolve(false); });
      });
      if (ready) return;
      await new Promise(r => setTimeout(r, 100));
    }
    this.kill();
    throw new Error('The proxy did not become ready. ' + failure);
  }
  kill() { const child = this.process; this.process = null; if (child) child.kill('SIGTERM'); }
  certificate() { return path.join(this.certDir, 'mitmproxy-ca-cert.pem'); }
  async prepareCertificate() {
    if (!fs.existsSync(this.certificate())) {
      if (this.starting) throw new Error('Wait for the current proxy operation to finish.');
      this.starting = true;
      try { await this.launch(); } finally { this.kill(); this.starting = false; }
    }
    return this.certificate();
  }
  async start() {
    if (this.running) return this.status();
    if (this.starting) throw new Error('GhostBar is already starting.');
    this.starting = true; this.lastError = '';
    try {
      this.restore();
      await this.launch();
      try { this.run('/usr/bin/security', ['verify-cert', '-c', this.certificate()], { stdio: 'pipe', timeout: 10_000 }); }
      catch { throw new Error('Trust GhostBar’s certificate first using Certificate setup, then start again.'); }
      const state = this.snapshot();
      for (const name of Object.keys(state)) {
        for (const kind of ['webproxy', 'securewebproxy']) {
          this.network('-set' + kind, name, '127.0.0.1', String(this.port));
          this.network('-set' + kind + 'state', name, 'on');
        }
      }
      this.running = true;
      this.watchNetworks();
      return this.status();
    } catch (error) {
      this.kill();
      try { this.restore(); } catch (restoreError) { throw new Error(error.message + ' ' + restoreError.message); }
      throw error;
    } finally { this.starting = false; }
  }
  stop() {
    this.running = false;
    clearInterval(this.networkTimer);
    // Restore before killing the process so there is no dead-proxy interval.
    try { this.restore(); } finally { this.kill(); }
    return this.status();
  }
  status() { return { running: this.running, starting: this.starting, address: this.running ? '127.0.0.1:' + this.port : 'Off', error: this.lastError || '' }; }
}
module.exports = { ProxyController };
