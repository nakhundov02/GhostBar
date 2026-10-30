'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readCertificate, importCertificate } = require('../core/certificate');
const { ProxyController } = require('../core/ghostbar');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostbar-certificate-test-'));
after(() => fs.rmSync(temp, { recursive: true, force: true }));
const certFile = path.join(temp, 'public.pem');
const keyFile = path.join(temp, 'private.pem');
const config = path.join(temp, 'openssl.cnf');
fs.writeFileSync(config, '[req]\ndistinguished_name=dn\nx509_extensions=ca\n[dn]\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n');
execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '1', '-subj', '/CN=mitmproxy', '-config', config], { stdio: 'ignore' });
const pem = fs.readFileSync(certFile, 'utf8');
const keychain = path.join(temp, 'Library/Keychains/login.keychain-db');
fs.mkdirSync(path.dirname(keychain), { recursive: true });
fs.writeFileSync(keychain, 'mock');

test('certificate setup imports only the public CA into an explicit login keychain', () => {
  const calls = [];
  const result = importCertificate(certFile, { home: temp, run: (command, args) => {
    assert.equal(command, '/usr/bin/security'); calls.push(args);
    if (args[0] === 'login-keychain') return `    "${keychain}"\n`;
    return '';
  } });
  assert.equal(result.keychain, keychain);
  assert.equal(result.fingerprint, readCertificate(certFile).fingerprint256);
  assert.deepEqual(calls[1], ['add-certificates', '-k', keychain, certFile]);
  assert.equal(calls.some(args => args[0].includes('trust')), false);
});

test('missing login preference uses the login file, never the default keychain', () => {
  const result = importCertificate(certFile, { home: temp, run: (_command, args) => {
    if (args[0] === 'login-keychain') throw new Error('no preference');
    assert.equal(args[2], keychain); return '';
  } });
  assert.equal(result.keychain, keychain);
});

test('repeated import succeeds only when the exact certificate is already present', () => {
  assert.doesNotThrow(() => importCertificate(certFile, { home: temp, run: (_command, args) => {
    if (args[0] === 'login-keychain') return '';
    if (args[0] === 'add-certificates') throw new Error('duplicate -25299');
    if (args[0] === 'find-certificate') return pem;
    throw new Error('unexpected command');
  } }));
  assert.throws(() => importCertificate(certFile, { home: temp, run: (_command, args) => {
    if (args[0] === 'login-keychain' || args[0] === 'find-certificate') return '';
    throw new Error('keychain locked');
  } }), /select login, unlock it/);
});

test('missing keychain reports recovery instructions without creating or resetting one', () => {
  const calls = [];
  assert.throws(() => importCertificate(certFile, { home: path.join(temp, 'missing-home'), run: (_command, args) => { calls.push(args); return ''; } }), /login keychain could not be found/);
  assert.equal(calls.length, 1);
});

test('invalid files and certificate/private-key bundles are rejected before import', () => {
  const bad = path.join(temp, 'bad.pem');
  for (const content of ['', 'invalid', pem + fs.readFileSync(keyFile, 'utf8')]) {
    fs.writeFileSync(bad, content);
    assert.throws(() => importCertificate(bad, { run: () => assert.fail('No import allowed') }), /public CA certificate/);
  }
});

test('certificate preparation validates generated output and reuses the existing CA', async () => {
  const directory = path.join(temp, 'proxy');
  const p = new ProxyController({ directory, root: temp, bridge: {} });
  let launches = 0, kills = 0;
  p.launch = async () => { launches++; fs.mkdirSync(p.certDir, { recursive: true }); fs.writeFileSync(p.certificate(), pem); };
  p.kill = () => { kills++; };
  assert.equal(await p.prepareCertificate(), p.certificate());
  assert.equal(await p.prepareCertificate(), p.certificate());
  assert.equal(launches, 1); assert.equal(kills, 1); assert.equal(p.starting, false);
  fs.writeFileSync(p.certificate(), 'invalid');
  await assert.rejects(p.prepareCertificate(), /public CA certificate/);
  assert.equal(launches, 1);
});

test('missing certificate never stops an already running proxy during setup', async () => {
  const p = new ProxyController({ directory: path.join(temp, 'running'), root: temp, bridge: {} });
  p.running = true;
  p.launch = p.kill = () => assert.fail('The running proxy must be preserved');
  await assert.rejects(p.prepareCertificate(), /Stop the proxy/);
  assert.equal(p.running, true);
});

test('Certificate setup opens the keychain instead of reopening the certificate import dialog', async () => {
  const { createBackground } = require('../core/background');
  const { socketPath, requestService } = require('../core/service-channel');
  const directory = path.join(temp, 'background');
  fs.mkdirSync(path.join(directory, 'mitmproxy'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'mitmproxy/mitmproxy-ca-cert.pem'), pem);
  const opened = [];
  let openError = '';
  const service = await createBackground({ directory, root: path.join(__dirname, '..'),
    safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() },
    shell: { openPath: async file => { opened.push(file); return openError; } }, quit() {},
    proxyRun: (command, args) => {
      assert.equal(command, '/usr/bin/security');
      if (args[0] === 'login-keychain') return `"${keychain}"`;
      assert.equal(args[0], 'add-certificates'); return '';
    }
  });
  try {
    const message = await requestService(socketPath(directory), 'certificate');
    assert.deepEqual(opened, [keychain]);
    assert.match(message, /Certificate imported into the login keychain/);
    assert.ok(message.includes(readCertificate(certFile).fingerprint256));
    openError = 'Could not open';
    assert.match(await requestService(socketPath(directory), 'certificate'), /Open Keychain Access manually/);
  } finally { service.close(); }
});
