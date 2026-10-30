'use strict';
// Optional live integration suite: GHOSTBAR_PLAYWRIGHT may point to an installed
// Playwright package. Uses a fresh browser profile; never reads saved sessions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.GHOSTBAR_PLAYWRIGHT || 'playwright');
const root = process.env.GHOSTBAR_TEST_ROOT || path.resolve(__dirname, '..');
const { createBridge } = require(path.join(root, 'core/bridge'));
const { TLS_PASSTHROUGH } = require(path.join(root, 'core/ghostbar'));
const crypto = require('node:crypto');
const inline = 'window.inlineWorks = true;';
const hash = crypto.createHash('sha256').update(inline).digest('base64');
const cases = [
  ['unrestricted', null],
  ['unrelated-only', "object-src 'none'; base-uri 'self'"],
  ['unsafe-inline', "default-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'"],
  ['default-fallback', "default-src 'self' 'unsafe-inline'"],
  ['nonce', "script-src 'self' 'nonce-original'; style-src 'self' 'unsafe-inline'", 'original'],
  ['multiple-headers', ["script-src 'self' 'nonce-original' 'strict-dynamic' 'unsafe-eval'; style-src 'self' 'unsafe-inline'", "require-trusted-types-for 'script'"], 'original'],
  ['combined-policies', "script-src 'self' 'nonce-original' 'strict-dynamic', object-src 'none'", 'original'],
  ['hash', `script-src 'self' 'sha256-${hash}'; style-src 'self' 'unsafe-inline'`, null, true],
  ['meta', null, null, false, "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; object-src 'none'"],
  ['element-directives', "script-src 'none'; script-src-elem 'self' 'unsafe-inline'; style-src 'none'; style-src-elem 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'"],
  ['duplicate-first-wins', "script-src 'self' 'unsafe-inline'; script-src 'none'; style-src 'self' 'unsafe-inline'"],
  ['denied-page-code', "default-src 'none'; script-src 'none'; style-src 'none'", null, false, null, true],
];
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async () => {
  let browser, child;
  const directory = fs.mkdtempSync('/private/tmp/ghostbar-compat-');
  const bridge = await createBridge({ root, ai: {
    data:{ provider:'gemini',geminiKey:'fixture-only' },
    status:()=>({provider:'gemini',hasGeminiKey:true,geminiModel:'test'}), chat:async()=> 'Test reply'
  }});
  const fixture = http.createServer((req,res)=>{
    if(req.url === '/asset.js'){res.setHeader('Content-Type','application/javascript');return res.end('window.externalWorks = true;');}
    if(req.url === '/asset.css'){res.setHeader('Content-Type','text/css');return res.end('#external-style{color:rgb(4,5,6)}');}
    if(req.url === '/data.json'){res.setHeader('Content-Type','application/json');return res.end('{"ok":true}');}
    const test = cases.find(x=>'/'+x[0]===req.url);
    if(!test){res.writeHead(404);return res.end();}
    const [name,csp,nonce,hashOnly,meta] = test;
    if(csp)res.setHeader('Content-Security-Policy',csp);
    res.setHeader('Content-Type','text/html');
    const n = nonce ? ` nonce="${nonce}"` : '';
    res.end(`<!doctype html><html><head>${meta ? `<meta http-equiv="Content-Security-Policy" content="${meta.replaceAll("'",'&#39;')}">` : ''}<style>#inline-style{color:rgb(1,2,3)}</style><link rel="stylesheet" href="/asset.css"></head><body><h1>${name}</h1><p id="inline-style">Inline CSS</p><p id="external-style">External CSS</p><p id="attribute-style" style="color:rgb(7,8,9)">Attribute CSS</p><button id="outside" onclick="window.clicked=true">Outside action</button><script${n}>${inline}</script><script${n} src="/asset.js"></script>${hashOnly ? '' : `<script${n}>window.literalMarkup = '<meta http-equiv="content-security-policy" content="script-src none">';</script>`}</body></html>`);
  });
  try {
    await new Promise(r=>fixture.listen(0,'0.0.0.0',r));
    const port = await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
    child=spawn(process.env.GHOSTBAR_MITMDUMP || '/Applications/GhostBar.app/Contents/Resources/mitmproxy/arm64/mitmproxy.app/Contents/MacOS/mitmdump', ['--listen-host','127.0.0.1','--listen-port',String(port),'-q','-s',path.join(__dirname,'fixture-addon.py'),'-s',path.join(root,'core/addon.py'),'--set','confdir='+directory,'--set','connection_strategy=lazy','--ignore-hosts',TLS_PASSTHROUGH],{env:{...process.env,GHOSTBAR_FIXTURE_PORT:String(fixture.address().port),GHOSTBAR_BRIDGE_PORT:String(bridge.port),GHOSTBAR_BRIDGE_SECRET:bridge.secret,GHOSTBAR_SNIPPET:path.join(root,'src/snippet.html')},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',b=>console.error('Proxy:',b.toString()));
    child.stderr.on('data',b=>console.error('Proxy:',b.toString()));
    for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Proxy startup failed');const ready=await new Promise(r=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();r(true)});s.once('error',()=>r(false));});if(ready)break;await sleep(100);}
    browser=await chromium.launch({channel:'chrome',headless:true});
    const direct=await browser.newContext({viewport:{width:1100,height:800}});
    const proxied=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1100,height:800},proxy:{server:'http://127.0.0.1:'+port,bypass:'<-loopback>'}});
    await proxied.addInitScript(()=>{const original=Element.prototype.attachShadow;Element.prototype.attachShadow=function(opts){const shadow=original.call(this,opts);if(this.id==='ghostbar-mount')window.testShadow=shadow;return shadow;};});
    let passed=0;
    for(const test of cases){
      console.log('CHECK',test[0]);
      const pages=await Promise.all([direct.newPage(),proxied.newPage()]);
      const states=[];
      for(const page of pages){
        await page.goto((page===pages[0] ? 'http://127.0.0.1:'+fixture.address().port : 'http://fixture.ghostbar.test')+'/'+test[0],{waitUntil:'load'});
        await page.locator('#outside').click();
        states.push(await page.evaluate(()=>({inline:!!window.inlineWorks,external:!!window.externalWorks,clicked:!!window.clicked,styles:['inline-style','external-style','attribute-style'].map(id=>getComputedStyle(document.getElementById(id)).color),literal:window.literalMarkup||null})));
      }
      try{
        assert.deepEqual(states[1],states[0],test[0]+' preserves existing page behavior');
        assert.ok(await pages[1].evaluate(()=>!!window.testShadow),test[0]+' launcher loads');
        const page=pages[1];
        assert.equal(await page.evaluate(()=>getComputedStyle(window.testShadow.querySelector('button')).opacity),'0.1');
        await page.mouse.click(1080,20);
        await page.waitForFunction(()=>!!window.testShadow.querySelector('iframe').src);
        let chat;
        for(let i=0;i<100;i++){chat=page.frames().find(f=>f.url()==='https://ghostbar.test/');if(chat)break;await sleep(50);}
        assert.ok(chat,test[0]+' panel loads');
        await chat.locator('textarea').waitFor();
        assert.equal(await chat.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
        if(test[0]==='unrestricted'){
          await chat.getByRole('textbox',{name:'Message',exact:true}).fill('Hello');
          await chat.locator('#send').click();
          await chat.getByText('Test reply',{exact:true}).waitFor();
        }
        await page.locator('#outside').click();
        assert.equal(await page.evaluate(()=>window.testShadow.querySelector('iframe').classList.contains('open')),false);
        console.log('PASS',test[0]);passed++;
      }catch(e){console.log('FAIL',test[0],e.message);if(!process.env.GHOSTBAR_EXPECT_FAILURE)throw e;}
      await Promise.all(pages.map(p=>p.close()));
    }
    console.log('Fixture cases passed:',passed+'/'+cases.length);
    if(process.env.GHOSTBAR_LIVE){
      for(const url of ['https://www.youtube.com/watch?v=XKHEtdqhLK8','https://canvas.hw.ac.uk/','https://www.wikipedia.org/','https://example.com/']){
        const page=await proxied.newPage();let blocked=0,failed=0;const errs=[];
        page.on('console',m=>{if(m.type()==='error'&& /Content Security Policy|violates.*directive/i.test(m.text())){blocked++;if(errs.length<3)errs.push(m.text().slice(0,280));}});
        page.on('requestfailed',()=>failed++);
        try{
          const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});await page.waitForTimeout(6000);
          const state=await page.evaluate(()=>({title:document.title,textLength:document.body.innerText.length,launcher:!!document.getElementById('ghostbar-mount'),youtubeReady:!!document.querySelector('ytd-app')?.data,playerReady:typeof document.querySelector('#movie_player')?.getPlayerState==='function',video:!!document.querySelector('video')}));
          console.log('LIVE',JSON.stringify({url,status:response.status(),...state,blocked,failed,errs}));
          await page.screenshot({path:directory+'/'+new URL(url).hostname+'.png'});
          if(url.includes('youtube'))assert.equal(state.playerReady,true,'YouTube JavaScript player initializes');
          assert.ok(state.textLength>20,'Public webpage has rendered content');
        }finally{await page.close();}
      }
      console.log('Screenshots:',directory);
    }
  }finally{await browser?.close();child?.kill('SIGTERM');bridge.close();fixture.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
