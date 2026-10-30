const { _electron: electron, chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const cwd = path.resolve(__dirname, '../..');
const root = path.join(cwd, 'outputs/GhostBar');
const { createBridge } = require(path.join(root, 'core/bridge'));
const { ProxyController } = require(path.join(root, 'core/ghostbar'));
(async () => {
  const env = { ...process.env, GHOSTBAR_DATA_DIR: fs.mkdtempSync(path.join(cwd, 'work/smoke-profile-')) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    args: [root], cwd: root, env
  });
  try {
    const window = await app.firstWindow();
    await window.waitForSelector('#signIn');
    await window.waitForTimeout(1000);
    assert.equal(await window.locator('#signIn').isEnabled(), true);
    assert.equal(await window.locator('#accounts').isVisible(), true);
    assert.equal(await window.locator('#geminiKey').isVisible(), false);
    await window.locator('#provider').selectOption('gemini');
    await window.waitForTimeout(400);
    assert.equal(await window.locator('#geminiKey').isVisible(), true);
    await window.locator('#provider').selectOption('chatgpt');
    await window.waitForTimeout(400);
    await window.screenshot({ path: path.join(cwd, 'work/ghostbar-window.png') });
    console.log('Native app opens without activation; ChatGPT button and provider selection pass.');
  } finally { await app.close(); }

  const ai = {
    data: { provider: 'chatgpt', activeId: 'test-profile' },
    status: () => ({ provider: 'chatgpt', connected: true, model: 'test-model' }),
    models: async () => [{ id: 'test-model', name: 'Test model' }],
    chat: async input => { assert.equal(input.at(-1).content, 'Hello GhostBar'); return 'GhostBar integration works.'; }
  };
  const bridge = await createBridge({ ai, root });
  const proxy = new ProxyController({ directory: path.join(cwd, 'work/proxy-profile'), root, bridge });
  fs.mkdirSync(proxy.directory, { recursive: true });
  let browser;
  try {
    await proxy.launch(); // No networksetup calls: system proxy remains untouched.
    browser = await chromium.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true, proxy: { server: 'http://127.0.0.1:' + proxy.port }
    });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto('https://ghostbar.local/');
    await page.waitForFunction(() => document.querySelector('#connection').textContent.includes('Using ChatGPT'));
    await page.locator('#prompt').fill('Hello GhostBar');
    await page.locator('#send').click();
    await page.getByText('GhostBar integration works.').waitFor();
    assert.equal(await page.locator('.user').count(), 1);
    await page.screenshot({ path: path.join(cwd, 'work/ghostbar-panel.png') });
    const response = await context.request.post('https://ghostbar.local/api/chat', {
      headers: { Origin: 'https://evil.example', 'X-GhostBar-Request': '1' }, data: {}
    });
    assert.equal(response.status(), 403);
    console.log('Real proxy + isolated chat panel + mocked AI reply pass; cross-origin request blocked.');
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture.json')));
    await context.route('https://fixture.test/', route => route.fulfill({ status: 200, ...fixture }));
    await page.goto('https://fixture.test/');
    await page.mouse.click(1265, 20);
    await page.waitForTimeout(1200);
    const panel = page.frames().find(f => f.url() === 'https://ghostbar.local/');
    assert.ok(panel, 'Hidden launcher opens its isolated frame');
    await panel.locator('#capture').click();
    await panel.locator('#attachment').waitFor({ state: 'visible' });
    assert.match(await panel.locator('#attachmentText').textContent(), /Page text attached/);
    assert.equal(await page.evaluate(() => window.__GHOSTBAR_KEY__), undefined);
    await page.screenshot({ path: path.join(cwd, 'work/ghostbar-injected.png') });
    console.log('Hidden launcher and explicit page capture pass under a strict page CSP.');

  } finally { if (browser) await browser.close(); proxy.kill(); bridge.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
