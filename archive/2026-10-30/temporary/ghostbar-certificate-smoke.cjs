'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = '/private/tmp/ghostbar-publish-2.0.4/GhostBar';
const { ProxyController } = require(root + '/core/ghostbar');
const { importCertificate, readCertificate } = require(root + '/core/certificate');

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostbar-fresh-cert-'));
  const keychain = path.join(directory, 'certificate-test.keychain-db');
  const proxy = new ProxyController({ directory, root,
    resources: '/private/tmp/ghostbar-2.0.4/bundles/arm64/GhostBar.app/Contents/Resources',
    bridge: { port: 9, secret: 'isolated-certificate-check' } });
  let created = false;
  try {
    const file = await proxy.prepareCertificate();
    const expected = readCertificate(file);
    assert.equal(proxy.running, false);
    assert.equal(fs.existsSync(proxy.backup), false);
    execFileSync('/usr/bin/security', ['create-keychain', '-p', crypto.randomBytes(24).toString('hex'), keychain], { stdio: 'pipe' });
    created = true;
    const run = (command, args, options) => args[0] === 'login-keychain' ? `"${keychain}"` : execFileSync(command, args, options);
    const first = importCertificate(file, { run });
    const second = importCertificate(file, { run });
    assert.equal(first.fingerprint, expected.fingerprint256);
    assert.deepEqual(second, first);
    const imported = execFileSync('/usr/bin/security', ['find-certificate', '-a', '-p', keychain], { encoding: 'utf8' });
    assert.equal(new crypto.X509Certificate(imported).fingerprint256, expected.fingerprint256);
    console.log('PASS: fresh bundled runtime generated its CA; public certificate imported into an explicit disposable keychain; repeated import succeeded. No trust or system proxy settings changed.');
  } finally {
    proxy.kill();
    if (created) execFileSync('/usr/bin/security', ['delete-keychain', keychain], { stdio: 'pipe' });
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
