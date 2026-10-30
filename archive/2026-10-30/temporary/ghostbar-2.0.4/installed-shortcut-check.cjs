const {chromium}=require('/private/tmp/ghostbar-2.0.2-tools/node_modules/playwright');
const {socketPath,requestService}=require('/private/tmp/ghostbar-2.0.4/source/core/service-channel');
const assert=require('node:assert/strict');
(async()=>{
 const s=await requestService(socketPath('/Users/n_akhundov02/Library/Application Support/GhostBar'),'status');
 console.log({proxy:s.proxy,shortcut:s.shortcut});
 assert.equal(s.proxy.running,true);
 const v=s.shortcut;
 const combo=[v.ctrl&&'Control',v.alt&&'Alt',v.shift&&'Shift',v.meta&&'Meta',v.code].filter(Boolean).join('+');
 const browser=await chromium.launch({channel:'chrome',headless:true,proxy:{server:'http://'+s.proxy.address}});
 try{
  const page=await browser.newPage({ignoreHTTPSErrors:true});
  await page.addInitScript(()=>{const original=Element.prototype.attachShadow;Element.prototype.attachShadow=function(o){const r=original.call(this,o);if(this.id==='ghostbar-mount')window.testShadow=r;return r;};});
  await page.goto('https://example.com/');
  await page.keyboard.press(combo);
  await page.waitForFunction(()=>window.testShadow.querySelector('iframe').classList.contains('open'));
  await page.waitForFunction(()=>window.testShadow.querySelector('iframe').src==='https://ghostbar.test/');
  let frame;
  for(let i=0;i<100;i++){frame=page.frames().find(f=>f.url()==='https://ghostbar.test/');if(frame)break;await new Promise(r=>setTimeout(r,100));}
  await frame.locator('#prompt').fill('Shortcut test draft');
  await page.keyboard.press(combo);
  await page.waitForFunction(()=>!window.testShadow.querySelector('iframe').classList.contains('open'));
  await page.keyboard.press(combo);
  await page.waitForFunction(()=>window.testShadow.querySelector('iframe').classList.contains('open'));
  assert.equal(await frame.locator('#prompt').inputValue(),'Shortcut test draft');
  console.log('PASS installed app: shortcut opens, closes from chat input, reopens with draft preserved; no AI message sent.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
