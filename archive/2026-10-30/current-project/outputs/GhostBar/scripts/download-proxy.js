'use strict';
// Complete official app bundles, including Python and native libraries.
// SHA-256 values published by Homebrew's mitmproxy cask, version 12.3.1.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const bundles = {
  arm64: { platform: 'arm64', sha256: '9b7f7a8e3fd1b1544089c937c579ef1f0f503f0ea598c25bda9eab077c735b93' },
  x64: { platform: 'x86_64', sha256: 'f4cf5e563e7068af297a27be97686f58917760d3c0dcc6a997ca83f6f5ffb3db' }
};
(async () => {
  const requested = process.argv.slice(2);
  const arches = requested.length ? requested : [process.arch];
  for (const arch of arches) {
    const bundle = bundles[arch];
    if (!bundle) throw new Error('Supported architectures: arm64 and x64');
    const destination = path.join(__dirname, '../runtime/mitmproxy', arch);
    fs.mkdirSync(destination, { recursive: true });
    const archive = path.join(destination, 'download.tar.gz');
    const url = 'https://downloads.mitmproxy.org/12.3.1/mitmproxy-12.3.1-macos-' + bundle.platform + '.tar.gz';
    console.log('Downloading the complete mitmproxy runtime for ' + arch + '…');
    execFileSync('/usr/bin/curl', ['--fail', '--location', '--retry', '2', '--silent', '--show-error', url, '-o', archive], { stdio: 'inherit' });
    const hash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    if (hash !== bundle.sha256) { fs.unlinkSync(archive); throw new Error('Proxy download checksum mismatch.'); }
    execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', destination], { stdio: 'inherit' });
    fs.unlinkSync(archive);
    const executable = path.join(destination, 'mitmproxy.app/Contents/MacOS/mitmdump');
    if (!fs.existsSync(executable)) throw new Error('The complete proxy app was not found after extraction.');
    console.log('Verified proxy runtime ready for ' + arch);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
