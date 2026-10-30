const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const {socketPath,requestService}=require('/private/tmp/ghostbar-2.0.3/source/core/service-channel');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const executable='/Applications/GhostBar.app/Contents/MacOS/GhostBar';
function pids(){return execFileSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n').map(line=>line.trim().match(/^(\d+) (.*)$/)).filter(m=>m&&(m[2]===executable||m[2]===executable+' --ghostbar-service')).map(m=>Number(m[1]));}
(async()=>{
 const sock=socketPath('/Users/n_akhundov02/Library/Application Support/GhostBar');
 console.log('Stop:',await requestService(sock,'stop'));
 for(const pid of pids())process.kill(pid,'SIGTERM');
 for(let i=0;i<100&&pids().length;i++)await sleep(100);
 if(pids().length)throw Error('Old GhostBar is still running; install stopped.');
 if(!fs.existsSync('/private/tmp/ghostbar-2.0.3/previous-installed.app'))execFileSync('/bin/cp',['-cR','/Applications/GhostBar.app','/private/tmp/ghostbar-2.0.3/previous-installed.app']);
 execFileSync('/usr/bin/ditto',['/private/tmp/ghostbar-2.0.3/bundles/arm64/GhostBar.app','/Applications/GhostBar.app']);
 execFileSync('/usr/bin/codesign',['--verify','--deep','--strict','/Applications/GhostBar.app']);
 console.log('Installed:',execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString','/Applications/GhostBar.app/Contents/Info.plist'],{encoding:'utf8'}).trim());
 execFileSync('/usr/bin/open',['-a','/Applications/GhostBar.app']);
 let status;
 for(let i=0;i<100;i++){
   try{status=await requestService(sock,'status',[],2000);break;}catch(e){await sleep(200);}
 }
 if(!status)throw Error('Installed, but the app did not become ready.');
 console.log('Proxy:',await requestService(sock,'start'));
 console.log('Ready for testing.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
