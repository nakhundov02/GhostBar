'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { X509Certificate } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 };

function readCertificate(file) {
  try {
    const pem = fs.readFileSync(file, 'utf8');
    // Only the public CA belongs in Keychain, never mitmproxy-ca.pem (its key).
    if (!/^\s*-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----\s*$/.test(pem)) throw new Error();
    const cert = new X509Certificate(pem);
    if (!cert.ca || Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) <= Date.now()) throw new Error();
    return cert;
  } catch {
    throw new Error('GhostBar’s public CA certificate is missing, invalid, or expired. Check the Mac’s date and time and retry Certificate setup. Existing certificates have been kept.');
  }
}

function importCertificate(file, { run = execFileSync, home = os.homedir() } = {}) {
  const cert = readCertificate(file);
  let configured = '';
  try { configured = run('/usr/bin/security', ['login-keychain', '-d', 'user'], options).trim().replace(/^"(.*)"$/, '$1'); } catch {}
  // Some macOS versions return no configured login keychain despite its file
  // existing. Never fall back to the default, which may be Local Items/iCloud.
  const keychain = [configured, path.join(home, 'Library/Keychains/login.keychain-db'), path.join(home, 'Library/Keychains/login.keychain')]
    .find(candidate => path.isAbsolute(candidate) && fs.existsSync(candidate));
  if (!keychain) throw new Error('The login keychain could not be found. Open Keychain Access and check that a login keychain is available, then retry Certificate setup.');
  try {
    // Import only. The owner still confirms SSL trust in Keychain Access.
    run('/usr/bin/security', ['add-certificates', '-k', keychain, file], options);
  } catch (error) {
    let present = false;
    try {
      const pem = run('/usr/bin/security', ['find-certificate', '-a', '-p', keychain], options);
      present = (pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [])
        .some(item => new X509Certificate(item).raw.equals(cert.raw));
    } catch {}
    if (!present) {
      const detail = String(error.stderr || error.message || '').trim().slice(0, 800);
      throw new Error('macOS could not import GhostBar’s certificate into the login keychain. Open Keychain Access, select login, unlock it if needed, and retry. ' + detail);
    }
  }
  return { keychain, fingerprint: cert.fingerprint256 };
}

module.exports = { readCertificate, importCertificate };
