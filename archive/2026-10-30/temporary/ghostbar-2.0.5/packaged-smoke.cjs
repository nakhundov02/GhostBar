const { _electron } = require('/private/tmp/ghostbar-2.0.2-tools/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const directory = fs.mkdtempSync('/private/tmp/ghostbar-2.0.5-ui-');
(async () => {
  let app;
  try {
    app = await _electron.launch({
      executablePath: '/private/tmp/ghostbar-2.0.5/bundles/arm64/GhostBar.app/Contents/MacOS/GhostBar',
      env: { ...process.env, GHOSTBAR_DATA_DIR: directory }, timeout: 30000
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => document.querySelector('#shortcutValue')?.textContent === 'Control + `');
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), '2.0.5');
    assert.equal(await page.locator('#certificate').isEnabled(), true);
    assert.equal(await page.locator('#proxyAddress').innerText(), 'Proxy is off.');
    assert.deepEqual(errors, []);
    console.log('PASS: packaged GhostBar 2.0.5 opens with its background service and Certificate setup enabled in a fresh profile.');
  } finally {
    await app?.close();
    await new Promise(resolve => setTimeout(resolve, 1500));
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
