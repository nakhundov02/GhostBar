(() => {
  'use strict';
  if (window.top !== window || document.getElementById('ghostbar-root')) return;
  const config = __GHOSTBAR_CONFIG__;
  const host = document.createElement('div');
  host.id = 'ghostbar-root';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.nonce = config.nonce;
  style.textContent = `
    :host { all: initial; position:fixed; inset:0 0 auto auto; z-index:2147483647; font-family:system-ui,sans-serif; color:#ececf4; }
    * { box-sizing:border-box; }
    button,textarea { font:inherit; }
    button { cursor:pointer; color:inherit; }
    .trigger { position:fixed; top:0; right:0; width:48px; height:48px; border:0; background:transparent; }
    .trigger span { display:grid; place-items:center; width:27px; height:27px; margin:auto; border-radius:50%; color:#a99aea; background:#71609b18; border:1px solid #aa98ef35; opacity:0; transition:opacity .18s; }
    .trigger:hover span,.trigger:focus-visible span { opacity:.55; }
    .panel { position:fixed; inset:0 0 0 auto; width:var(--gb-width,20vw); display:flex; flex-direction:column; background:#13131af5; border-left:1px solid #ffffff18; box-shadow:-10px 0 36px #0002; }
    [hidden] { display:none!important; }
    header { display:flex; align-items:center; gap:9px; padding:18px 16px; border-bottom:1px solid #ffffff10; }
    .mark { color:#ad9fe8; font-size:19px; } strong { flex:1; font-size:12px; letter-spacing:1.4px; }
    .plain { border:0; background:transparent; opacity:.7; padding:5px; }
    .log { flex:1; overflow:auto; padding:16px; display:flex; flex-direction:column; gap:14px; }
    .message { padding:11px 12px; font-size:13px; line-height:1.6; white-space:pre-wrap; overflow-wrap:anywhere; border-radius:12px; background:#ffffff06; }
    .user { margin-left:18px; background:#9180d51c; } .assistant { margin-right:8px; }
    .empty,.notice { color:#b5b2c6; font-size:12px; line-height:1.6; }
    footer { padding:14px; border-top:1px solid #ffffff10; }
    form { display:flex; align-items:flex-end; padding:10px; border:1px solid #ffffff20; border-radius:12px; background:#ffffff05; }
    textarea { min-width:0; width:100%; resize:vertical; max-height:180px; color:#eee; border:0; outline:0; background:transparent; padding:3px; font-size:13px; }
    .send { background:#a898e6; color:#181221; border:0; border-radius:8px; width:30px; height:30px; }
    button:disabled { opacity:.35; cursor:default; }
    .resize { position:absolute; inset:0 auto 0 -4px; width:8px; cursor:ew-resize; }
    .notice { margin:8px 1px 0; font-size:10px; }
    .status { color:#d5b4b4; min-height:18px; font-size:11px; }
    @media(prefers-reduced-motion:reduce) { * { transition:none!important; } }
  `;
  const view = document.createElement('div');
  view.innerHTML = `
    <button class="trigger" aria-label="Open GhostBar" aria-expanded="false"><span>✦</span></button>
    <section class="panel" aria-label="GhostBar AI" hidden>
      <div class="resize" role="separator" aria-label="Resize GhostBar" aria-orientation="vertical" tabindex="0"></div>
      <header><span class="mark">✦</span><strong>GHOSTBAR</strong><button class="plain clear" aria-label="New conversation">↺</button><button class="plain close" aria-label="Close GhostBar">×</button></header>
      <div class="log" role="log" aria-live="polite"><p class="empty">A little room to think.<br>Ask Gemini anything.</p></div>
      <footer><div class="status" role="status"></div><form><textarea aria-label="Message" placeholder="Ask anything…" rows="2" maxlength="16000"></textarea><button class="send" aria-label="Send message">↑</button></form><p class="notice">Messages are sent to Gemini. This page is not sent automatically.</p></footer>
    </section>`;
  root.append(style, view);
  document.documentElement.append(host);
  const $ = s => root.querySelector(s);
  const panel = $('.panel'), trigger = $('.trigger'), log = $('.log'), input = $('textarea');
  let history = [], busy = false, width = .2, restore = null, aborter = null;
  function fit() {
    const px = Math.min(innerWidth * .65, Math.max(Math.min(280, innerWidth * .5), innerWidth * width));
    host.style.setProperty('--gb-width', px + 'px');
    if (!panel.hidden && document.body) {
      document.body.style.setProperty('width', `calc(100% - ${px}px)`, 'important');
      document.body.style.setProperty('box-sizing', 'border-box', 'important');
    }
  }
  function open() {
    if (!panel.hidden) return;
    restore = ['width','box-sizing'].map(k => [k,document.body.style.getPropertyValue(k),document.body.style.getPropertyPriority(k)]);
    panel.hidden=false; trigger.hidden=true; trigger.setAttribute('aria-expanded','true'); fit(); input.focus();
  }
  function close() {
    if (panel.hidden) return;
    panel.hidden=true; trigger.hidden=false; trigger.setAttribute('aria-expanded','false');
    for (const [k,v,p] of restore || []) v ? document.body.style.setProperty(k,v,p) : document.body.style.removeProperty(k);
    restore=null; trigger.focus();
  }
  function message(role,text) {
    $('.empty')?.remove();
    const element=document.createElement('div'); element.className='message '+role; element.textContent=text;
    log.append(element); log.scrollTop=log.scrollHeight;
  }
  trigger.addEventListener('click',open); $('.close').addEventListener('click',close);
  $('.clear').addEventListener('click',()=> { if(busy) return; history=[]; log.replaceChildren(); $('.status').textContent=''; });
  root.addEventListener('keydown',e=> { if(e.key==='Escape') { e.stopPropagation(); close(); } });
  input.addEventListener('keydown',e=> { if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing) { e.preventDefault(); $('form').requestSubmit(); } });
  $('form').addEventListener('submit',async e=> {
    e.preventDefault(); const text=input.value.trim(); if(!text||busy) return;
    busy=true; $('.send').disabled=true; $('.clear').disabled=true; $('.status').textContent='Thinking…';
    input.value=''; message('user',text); aborter=new AbortController();
    const timer=setTimeout(()=>aborter.abort(),90000);
    try {
      const response=await fetch(config.endpoint,{method:'POST',credentials:'omit',cache:'no-store',signal:aborter.signal,headers:{'Content-Type':'application/json','X-GhostBar-Session':config.session},body:JSON.stringify({messages:[...history,{role:'user',text}]})});
      const data=await response.json(); if(!response.ok) throw new Error(data.error||'Could not send the message.');
      if(typeof data.text!=='string') throw new Error('The response was incomplete.');
      history.push({role:'user',text},{role:'assistant',text:data.text}); history=history.slice(-20);
      message('assistant',data.text); $('.status').textContent='';
    } catch(error) { $('.status').textContent=error.name==='AbortError'?'The request timed out. Try again.':error.message; input.value=text; }
    finally { clearTimeout(timer); busy=false; $('.send').disabled=false; $('.clear').disabled=false; aborter=null; }
  });
  const resize=$('.resize');
  resize.addEventListener('pointerdown',e=> { resize.setPointerCapture(e.pointerId); });
  resize.addEventListener('pointermove',e=> { if(resize.hasPointerCapture(e.pointerId)) { width=Math.max(.2,Math.min(.65,(innerWidth-e.clientX)/innerWidth)); fit(); } });
  resize.addEventListener('keydown',e=> { if(e.key==='ArrowLeft'||e.key==='ArrowRight') { e.preventDefault(); width=Math.max(.2,Math.min(.65,width+(e.key==='ArrowLeft'?.025:-.025))); fit(); } });
  addEventListener('resize',fit);
  addEventListener('pagehide',()=>aborter?.abort(),{once:true});
})();
