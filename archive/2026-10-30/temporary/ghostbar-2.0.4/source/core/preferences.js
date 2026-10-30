'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT, normalize } = require('../src/shortcut');
class Preferences {
  constructor(directory) {
    this.file = path.join(directory, 'preferences.json');
    this.shortcut = { ...DEFAULT };
    try { this.shortcut = normalize(JSON.parse(fs.readFileSync(this.file, 'utf8')).shortcut); }
    catch (error) { if (error.code && error.code !== 'ENOENT') throw error; }
  }
  setShortcut(value) {
    const shortcut = normalize(value);
    const temporary = this.file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify({ shortcut }), { mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, this.file);
    this.shortcut = shortcut;
  }
}
module.exports = { Preferences };
