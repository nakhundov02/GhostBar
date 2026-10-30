'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT, normalize, matches, label } = require('../src/shortcut');
const { Preferences } = require('../core/preferences');
test('shortcut requires an exact modified key and ignores repeats/composition', () => {
  const event = {code:'Backquote',ctrlKey:true,altKey:false,shiftKey:false,metaKey:false,repeat:false,isComposing:false};
  assert.equal(matches(event, DEFAULT), true);
  for (const changed of [{ctrlKey:false},{altKey:true},{shiftKey:true},{metaKey:true},{repeat:true},{isComposing:true},{code:'KeyK'}]) assert.equal(matches({...event,...changed},DEFAULT),false);
  assert.equal(label(DEFAULT), 'Control + `');
  for(const invalid of [{...DEFAULT,ctrl:false},{...DEFAULT,code:'</script>'},{...DEFAULT,code:'Escape'},{...DEFAULT,code:['KeyK']},{...DEFAULT,ctrl:'true'}]) assert.throws(()=>normalize(invalid));
});
test('a chosen shortcut persists across service restart without touching accounts', () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ghostbar-preferences-'));
  try {
    const preferences=new Preferences(directory);
    assert.deepEqual(preferences.shortcut,DEFAULT);
    const custom={...DEFAULT,code:'KeyK',alt:true};
    preferences.setShortcut(custom);
    assert.deepEqual(new Preferences(directory).shortcut,custom);
    assert.equal(fs.statSync(preferences.file).mode & 0o777,0o600);
    assert.throws(()=>preferences.setShortcut({...custom,code:'<script>'}));
    assert.deepEqual(new Preferences(directory).shortcut,custom);
    assert.deepEqual(fs.readdirSync(directory),['preferences.json']);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
