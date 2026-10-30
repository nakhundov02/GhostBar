const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium, firefox, webkit } = require('/private/tmp/ghostbar-2.0.2-tools/node_modules/playwright');
const root = '/private/tmp/ghostbar-2.0.2-source';
const { createBridge } = require(path.join(root, 'core/bridge'));
const { ProxyController } = require(path.join(root, 'core/ghostbar'));
(async () => {
  const ai = {
    data: { provider: 'gemini', geminiKey: 'fake-test-key' },
    status: () => ({ provider: 'gemini', hasGeminiKey: true, geminiModel: 'test-model' }),
    chat: async () => 'Test reply'
  };
  const bridge = await createBridge({ root, ai });
  const directory = fs.mkdtempSync('/private/tmp/ghostbar-routing-check-');
  const proxy = new ProxyController({ root, directory, bridge, resources: '/private/tmp/ghostbar-2.0.2-bundles/arm64/GhostBar.app/Contents/Resources' });
  const snippet = fs.readFileSync(path.join(root, 'src/snippet.html'), 'utf8').replaceAll('__GHOSTBAR_NONCE__', 'fixture');
  const fixture = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html><body><h1>Outside page</h1><button id="outside">Outside action</button>' + snippet + '</body></html>');
  });
  let browser;
  try {
    await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
    await proxy.launch(); // No macOS settings are changed by launch().
    const engine = process.argv[2] || 'chromium';
    const browserType = { chromium, firefox, webkit }[engine];
    browser = await browserType.launch({ ...(engine === 'chromium' ? { channel: 'chrome' } : {}), headless: true, proxy: { server: 'http://127.0.0.1:' + proxy.port, bypass: '127.0.0.1,localhost,*.local' } });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 800 } });
    const page = await context.newPage();
    page.on('console', message => { if (message.type() === 'error') console.log('Console:', message.text()); });
    page.on('pageerror', error => console.log('Browser error:', error.message));
    page.on('response', response => { if (response.url().includes('ghostbar.test')) console.log(response.status(), response.url()); });
    await page.addInitScript(() => {
      const original = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (options) {
        const shadow = original.call(this, options);
        if (this.id === 'ghostbar-mount') window.testShadow = shadow;
        return shadow;
      };
    });
    await page.goto('http://127.0.0.1:' + fixture.address().port);
    const opacity = () => page.evaluate(() => getComputedStyle(window.testShadow.querySelector('button')).opacity);
    assert.equal(await opacity(), '0.1');
    await page.mouse.move(1080, 20);
    assert.equal(await opacity(), '0.1', 'Hover does not make the button bright');
    await page.mouse.click(1080, 20);
    const frameVisible = () => page.evaluate(() => getComputedStyle(window.testShadow.querySelector('iframe')).display !== 'none');
    assert.equal(await frameVisible(), true);
    await page.waitForFunction(() => window.testShadow.querySelector('iframe').src === 'https://ghostbar.test/');
    let chat;
    for (let i = 0; i < 100; i++) {
      chat = page.frames().find(frame => frame.url() === 'https://ghostbar.test/');
      if (chat) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(chat, 'Panel loads with the macOS *.local bypass rule');
    assert.equal(await chat.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)', 'Chat background is white');
    await chat.getByRole('textbox', { name: 'Message', exact: true }).fill('Hello');
    assert.equal(await frameVisible(), true, 'Clicks inside the chat do not close it');
    await chat.getByRole('button', { name: 'Send' }).click();
    console.log('Panel after submit:', await chat.locator('body').innerText());
    await chat.getByText('Test reply', { exact: true }).waitFor();
    await page.screenshot({ path: path.resolve('work/ghostbar-white-panel-' + engine + '.png') });
    await page.locator('#outside').click();
    assert.equal(await frameVisible(), false, 'Outside click dismisses chat');
    await page.mouse.click(1080, 20);
    assert.equal(await frameVisible(), true);
    await chat.getByText('Test reply', { exact: true }).waitFor();
    await chat.getByRole('button', { name: 'Close chat', exact: true }).click();
    await page.waitForFunction(() => !window.testShadow.querySelector('iframe').classList.contains('open'));
    await page.screenshot({ path: path.resolve('work/ghostbar-white-button-' + engine + '.png') });
    console.log(engine, 'PASS: white background, *.local bypass compatibility, 10% opacity including hover, real proxy panel and mocked reply, inside clicks, outside dismissal, reopen and close button.');
  } finally {
    await browser?.close(); proxy.kill(); bridge.close(); fixture.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
