import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
const root='/private/tmp/pr988-real-e2e', base='https://conf-stg-lite.zenuml.com', redirect='http://127.0.0.1:18988/callback';
const save=(name,data)=>fs.writeFileSync(`${root}/secrets/${name}.json`,JSON.stringify(data,null,2),{mode:0o600});
const read=name=>JSON.parse(fs.readFileSync(`${root}/secrets/${name}.json`));
function record(data){fs.appendFileSync(`${root}/events.jsonl`,JSON.stringify({time:new Date().toISOString(),...data})+'\n');}
http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,redirect);
 if(u.pathname==='/start'){
  const arm=u.searchParams.get('arm'), which=u.searchParams.get('case');
  if(!['before','after'].includes(arm)||!['first','returning','deny','new'].includes(which))throw Error('invalid case');
  let client;
  if(which==='returning')client=read(`${arm}-first`).client;
  else{
   const r=await fetch(`${base}/agent-link/oauth/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({redirect_uris:[redirect],client_name:`PR988 real E2E ${arm} ${which}`})});
   client=await r.json();record({arm,which,step:'DCR',status:r.status});if(r.status!==201)throw Error(`DCR ${r.status}`);
  }
  const state=crypto.randomBytes(24).toString('base64url'), verifier=crypto.randomBytes(48).toString('base64url');
  const run={arm,which,state,verifier,client,redirect};save(state,run);save(`${arm}-${which}`,run);
  const auth=new URL(`${base}/agent-link/oauth/authorize`);for(const[k,v]of Object.entries({response_type:'code',client_id:client.client_id,redirect_uri:redirect,scope:'diagram.read diagram.write',resource:`${base}/agent-link/mcp`,state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',...(which==='first'?{prompt:'login'}:{})}))auth.searchParams.set(k,v);
  res.writeHead(302,{location:auth.href});return res.end();
 }
 if(u.pathname==='/callback'){
  const run=read(u.searchParams.get('state'));if(u.searchParams.get('iss')!==base)throw Error('issuer mismatch');
  if(u.searchParams.has('error')){record({arm:run.arm,which:run.which,step:'callback',error:u.searchParams.get('error')});res.end('Authorization denied. No token requested.');return;}
  const r=await fetch(`${base}/agent-link/oauth/token`,{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',code:u.searchParams.get('code'),client_id:run.client.client_id,redirect_uri:redirect,code_verifier:run.verifier,resource:`${base}/agent-link/mcp`})});
  const token=await r.json();save(`${run.arm}-${run.which}-token`,token);record({arm:run.arm,which:run.which,step:'PKCE token exchange',status:r.status,accessTokenPresent:!!token.access_token,refreshTokenPresent:!!token.refresh_token});
  res.setHeader('content-type','text/html');res.end(`<h1>PR988 ${run.arm}: ${run.which}</h1><p>Real OAuth token exchange HTTP ${r.status}. Credentials saved privately in the client.</p>`);return;
 }
 res.end('Real PR988 OAuth public client');
}catch(e){record({step:'client-error',message:e.message});res.writeHead(500);res.end('OAuth client failed; see private log.');}}).listen(18988,'127.0.0.1',()=>console.log('Real OAuth client listening on loopback port 18988'));
