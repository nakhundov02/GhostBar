'use strict';
const fs = require('node:fs');
const path = require('node:path');

class Vault {
  constructor(directory, encryption) {
    this.directory = directory;
    this.file = path.join(directory, 'account-vault.json');
    this.encryption = encryption;
    this.value = {};
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.file)) {
      const envelope = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.value = JSON.parse(encryption.decryptString(Buffer.from(envelope.encrypted, 'base64')));
    }
  }
  save() {
    if (!this.encryption.isEncryptionAvailable()) {
      throw new Error('macOS secure storage is unavailable. Unlock your login keychain and try again.');
    }
    const encrypted = this.encryption.encryptString(JSON.stringify(this.value)).toString('base64');
    const temp = this.file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify({ version: 1, encrypted }), { mode: 0o600 });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, this.file);
  }
}
module.exports = { Vault };
