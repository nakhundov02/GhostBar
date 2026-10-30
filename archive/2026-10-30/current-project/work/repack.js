const fs = require('node:fs');
const path = require('node:path');
const asar = require(path.resolve('node_modules/@electron/asar'));
const root = process.cwd();
const work = path.resolve('../../work');
(async () => {
  const payload = path.join(work, 'final-app-payload');
  asar.extractAll('/private/tmp/ghostbar-final-bundles/arm64/GhostBar.app/Contents/Resources/app.asar', payload);
  fs.cpSync(path.join(root, 'src'), path.join(payload, 'src'), { recursive: true });
  for (const name of fs.readdirSync(path.join(root, 'core'))) {
    if (name.endsWith('.js')) fs.copyFileSync(path.join(root, 'core', name), path.join(payload, 'core', name));
  }
  fs.copyFileSync(path.join(root, 'package.json'), path.join(payload, 'package.json'));
  await asar.createPackage(payload, path.join(work, 'final-app.asar'));
  console.log('Repacked final source with the official Electron ASAR tool.');
})().catch(error => { console.error(error); process.exitCode = 1; });
