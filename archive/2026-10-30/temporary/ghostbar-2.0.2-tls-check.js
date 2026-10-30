const fs=require('node:fs');
const http=require('node:http');
const tls=require('node:tls');
const assert=require('node:assert/strict');
const {ProxyController}=require('/private/tmp/ghostbar-2.0.2-source/core/ghostbar');
function verify(port,host){
 return new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port,method:'CONNECT',path:host+':443'});
  req.setTimeout(15000,()=>req.destroy(new Error('Proxy CONNECT timed out')));
  req.once('error',reject);
  req.once('connect',(res,socket,head)=>{
   if(res.statusCode!==200){socket.destroy();return reject(new Error('CONNECT '+res.statusCode));}
   if(head.length)socket.unshift(head);
   const secure=tls.connect({socket,servername:host,ca:tls.rootCertificates,rejectUnauthorized:true},()=>{
    const cert=secure.getPeerCertificate();
    try {assert.equal(secure.authorized,true);assert.ok(!JSON.stringify(cert.issuer).toLowerCase().includes('mitmproxy'));resolve({host,issuer:cert.issuer.O,subject:cert.subject.CN});}
    catch(e){reject(e);} finally{secure.end();}
   });
   secure.setTimeout(15000,()=>secure.destroy(new Error('TLS handshake timed out')));
   secure.once('error',reject);
  });
  req.end();
 });
}
(async()=>{
 const directory=fs.mkdtempSync('/private/tmp/ghostbar-monitor-check-');
 const proxy=new ProxyController({directory,root:'/private/tmp/ghostbar-2.0.2-source',resources:'/private/tmp/ghostbar-2.0.2-bundles/arm64/GhostBar.app/Contents/Resources',bridge:{port:9,secret:'unused'}});
 try{
  await proxy.launch();
  for(const host of ['smc-service-cloud.respondus2.com','static-public-downloads-cloud.respondus.com'])console.log(JSON.stringify(await verify(proxy.port,host)));
  console.log('PASS: Respondus keeps publicly trusted server certificates through the updated proxy, without trusting GhostBar’s CA.');
 }finally{proxy.kill();}
})().catch(error=>{console.error(error.message);process.exitCode=1});
