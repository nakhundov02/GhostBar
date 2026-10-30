const { _electron }=require('/private/tmp/ghostbar-2.0.2-tools/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const directory=fs.mkdtempSync('/private/tmp/ghostbar-shortcut-ui-');
const executablePath='/private/tmp/ghostbar-2.0.4/bundles/arm64/GhostBar.app/Contents/MacOS/GhostBar';
(async()=>{
 let app;
 try {
  const launch=()=>_electron.launch({executablePath,env:{...process.env,GHOSTBAR_DATA_DIR:directory},timeout:30000});
  app=await launch();let page=await app.firstWindow();
  page.on('pageerror',e=>console.log('Renderer error:',e.message));
  await page.waitForTimeout(5000);
  console.log('Initial UI:',await page.locator('body').innerText());
  await page.locator('#heroBanner').filter({hasText:'Ready when you are'}).waitFor();
  assert.equal(await page.locator('#shortcutValue').innerText(),'Control + `');
  await page.locator('#changeShortcut').click();
  await page.keyboard.press('KeyA');
  assert.match(await page.locator('#shortcutHint').innerText(),/Choose Control/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#shortcutValue').innerText(),'Control + `');
  await page.locator('#changeShortcut').click();
  await page.keyboard.press('Control+Alt+KeyK');
  await page.waitForFunction(()=>document.getElementById('shortcutValue').textContent==='Control + Option + K');
  assert.equal(JSON.parse(fs.readFileSync(directory+'/preferences.json')).shortcut.code,'KeyK');
  await app.close();app=undefined;
  await new Promise(r=>setTimeout(r,500));
  app=await launch();page=await app.firstWindow();
  await page.waitForFunction(()=>document.getElementById('shortcutValue').textContent==='Control + Option + K');
  await page.locator('#resetShortcut').click();
  await page.waitForFunction(()=>document.getElementById('shortcutValue').textContent==='Control + `');
  const panel=page.locator('.panel').filter({has:page.locator('#shortcutValue')});
  await panel.screenshot({path:'/private/tmp/ghostbar-2.0.4/shortcut-settings.png'});
  console.log('PASS native shortcut setting: invalid plain key, cancel, custom recording, save, app restart, reset default');
 }finally {await app?.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
