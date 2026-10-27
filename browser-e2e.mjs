import {createServer as viteServer} from 'vite';
import {chromium} from '@playwright/test';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const home='/private/tmp/pr988-cookie-e2e';
const results=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async (url,init)=>{
 const u=String(url);
 if(u==='https://auth.atlassian.com/oauth/token') return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,scope:'read:me offline_access'});
 if(u==='https://api.atlassian.com/me')return Response.json({account_id:'synthetic-e2e-user'});
 if(u==='https://api.atlassian.com/oauth/token/accessible-resources')return Response.json([{id:'synthetic-site',url:'https://example.invalid',name:'Synthetic test site',scopes:[]}]);
 throw new Error('Unexpected external fetch: '+u);
};
const browser=await chromium.launch({headless:true});
try {
for(const label of ['before','after']) {
 const root=home+'/'+label;
 const vite=await viteServer({root,configFile:false,optimizeDeps:{noDiscovery:true,include:[],entries:[]},server:{middlewareMode:true},appType:'custom'});
 const routes={};for(const name of ['authorize','callback','consent','register'])routes[name]=await vite.ssrLoadModule(root+'/functions/agent-link/oauth/'+name+'.ts');
 for(const protocol of ['http','https']) {
  const port=protocol==='http'?19488:19489;
  const origin=protocol+'://localhost:'+port;
  const upstream=protocol+'://127.0.0.1:'+port;
  const kv=new Map();const logs=[];
  const env={ATLASSIAN_OAUTH_CLIENT_ID:'synthetic-client',ATLASSIAN_OAUTH_CLIENT_SECRET:'synthetic-secret',ATLASSIAN_OAUTH_REDIRECT_URI:origin+'/agent-link/oauth/callback',OAUTH_GRANT_SECRET:'synthetic-test-key',OAUTH_GRANT_KV:{get:async k=>kv.get(k)??null,put:async(k,v)=>{kv.set(k,v)},delete:async k=>{kv.delete(k)}}};
  const handler=async(req,res)=>{try{
   const url=new URL(req.url,protocol+'://'+req.headers.host);
   if(url.hostname==='127.0.0.1') {
    const cb=new URL(env.ATLASSIAN_OAUTH_REDIRECT_URI);cb.searchParams.set('state',url.searchParams.get('state')||'');cb.searchParams.set('code','synthetic-code');
    const deny=new URL(cb);deny.searchParams.set('error','access_denied');
    res.setHeader('Content-Type','text/html');res.end(`<h1>Synthetic Atlassian authorization</h1><a href="${cb}">Continue</a><a href="${deny}">Deny upstream</a>`);return;
   }
   if(url.pathname==='/client/callback'){res.setHeader('Content-Type','text/html');res.end('<h1>Test client callback</h1>');return;}
   const route=routes[url.pathname.split('/').pop()];
   if(!route){res.statusCode=404;res.end('Not found');return;}
   const chunks=[];for await(const c of req)chunks.push(c);
   const body=Buffer.concat(chunks);
   const request=new Request(url,{method:req.method,headers:req.headers,...(body.length?{body}: {})});
   const fn=req.method==='POST'?route.onRequestPost:route.onRequestGet;
   const response=await fn({request,env});
   logs.push({path:url.pathname,status:response.status,receivedCookies:(req.headers.cookie||'').split(';').map(x=>x.trim().split('=')[0]).filter(Boolean),setCookies:response.headers.getSetCookie().map(c=>c.replace(/^([^=]+)=[^;]*/, '$1=<redacted>'))});
   res.statusCode=response.status;
   for(const [k,v] of response.headers){if(k==='set-cookie')continue;if(k==='location'&&v.startsWith('https://auth.atlassian.com/authorize')){const u=new URL(v);res.setHeader(k,upstream+u.pathname+u.search);}else res.setHeader(k,v);}
   if(response.headers.getSetCookie().length)res.setHeader('Set-Cookie',response.headers.getSetCookie());
   res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){res.statusCode=500;res.end(String(e));console.error(e);}};
  const srv=protocol==='https'?https.createServer({key:fs.readFileSync(home+'/key.pem'),cert:fs.readFileSync(home+'/cert.pem')},handler):http.createServer(handler);
  await new Promise(r=>srv.listen(port,r));
  const context=await browser.newContext({ignoreHTTPSErrors:true});
  const page=await context.newPage();
  const cookies=()=>context.cookies();
  const cookie=async name=>(await cookies()).find(c=>c.name===name);
  const checkCookie=async(name,path)=>{const c=await cookie(name);assert(c, name+' present');assert.equal(c.httpOnly,true);assert.equal(c.sameSite,'Lax');assert.equal(c.secure,protocol==='https');assert.equal(c.path,path);};
  const client=async()=>{const r=await context.request.post(origin+'/agent-link/oauth/register',{data:{client_name:'PR 988 E2E synthetic client',redirect_uris:[origin+'/client/callback']}});assert.equal(r.status(),201);return(await r.json()).client_id;};
  const authorize=id=>origin+'/agent-link/oauth/authorize?'+new URLSearchParams({client_id:id,redirect_uri:origin+'/client/callback',response_type:'code',code_challenge_method:'S256',code_challenge:'A'.repeat(43),state:'test-client-state'});
  const run=async(name,fn)=>{const start=Date.now();try{await fn();results.push({label,protocol,name,status:'PASS',durationMs:Date.now()-start});console.log(`${label} ${protocol} PASS ${name}`);}catch(e){results.push({label,protocol,name,status:'FAIL',error:String(e)});console.log(`${label} ${protocol} FAIL ${name}: ${e}`);await page.screenshot({path:home+`/evidence/${label}-${protocol}-failure-${results.length}.png`}).catch(()=>{});}};
  let id;
  await run('First sign-in: state cookie survives cross-site return; consent and user cookies set',async()=>{
   id=await client();await page.goto(authorize(id));assert.equal(new URL(page.url()).hostname,'127.0.0.1');
   await checkCookie('agent_link_oauth_state','/agent-link/oauth');
   await page.getByRole('link',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Allow',exact:true}).waitFor();
   await checkCookie('agent_link_consent','/agent-link/oauth/consent');await checkCookie('agent_link_user','/agent-link/oauth');assert.equal(await cookie('agent_link_oauth_state'),undefined);
   assert(logs.some(x=>x.path.endsWith('/callback')&&x.receivedCookies.includes('agent_link_oauth_state')));
   await page.screenshot({path:home+`/evidence/${label}-${protocol}-consent.png`,fullPage:true});
  });
  await run('Allow consent: client receives code; consent cookie cleared; replay refused',async()=>{
   const consent=page.url();await page.getByRole('button',{name:'Allow',exact:true}).click();await page.waitForURL('**/client/callback?**');assert(new URL(page.url()).searchParams.get('code'));assert.equal(new URL(page.url()).searchParams.get('state'),'test-client-state');assert.equal(await cookie('agent_link_consent'),undefined);
   const r=await page.goto(consent);assert.equal(r.status(),400);await page.getByRole('heading',{name:'This request has expired'}).waitFor();
  });
  await run('Returning approved client: cross-site navigation skips upstream and consent',async()=>{
   await page.goto(upstream+'/start');await page.evaluate(url=>{const a=document.createElement('a');a.href=url;a.textContent='Start approved client';document.body.append(a)},authorize(id));await page.getByRole('link',{name:'Start approved client'}).click();await page.waitForURL('**/client/callback?**');assert(new URL(page.url()).searchParams.get('code'));await checkCookie('agent_link_user','/agent-link/oauth');
  });
  await run('Returning user with new client: consent required; cancel returns access_denied',async()=>{
   const fresh=await client();await page.goto(authorize(fresh));await page.getByRole('button',{name:'Allow',exact:true}).waitFor();await checkCookie('agent_link_consent','/agent-link/oauth/consent');await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.waitForURL('**/client/callback?**');assert.equal(new URL(page.url()).searchParams.get('error'),'access_denied');assert.equal(await cookie('agent_link_consent'),undefined);
  });
  await run('Tampered returning-user cookie: cleared; sign-in falls back to upstream',async()=>{
   const c=await cookie('agent_link_user');await context.addCookies([{...c,value:'tampered.signature'}]);await page.goto(authorize(await client()));assert.equal(new URL(page.url()).hostname,'127.0.0.1');assert.equal(await cookie('agent_link_user'),undefined);
  });
  await run('Upstream denial: error page displayed and state cookie cleared',async()=>{
   await page.getByRole('link',{name:'Deny upstream'}).click();await page.getByRole('heading',{name:'Authorization was not completed'}).waitFor();assert.equal(await cookie('agent_link_oauth_state'),undefined);
  });
  await run('Callback with mismatched state: rejected and state cookie cleared',async()=>{
   await page.goto(authorize(await client()));const r=await page.goto(origin+'/agent-link/oauth/callback?state=wrong&code=synthetic-code');assert.equal(r.status(),400);await page.getByRole('heading',{name:'This link cannot be used'}).waitFor();assert.equal(await cookie('agent_link_oauth_state'),undefined);
  });
  fs.writeFileSync(home+`/evidence/${label}-${protocol}-http-evidence.json`,JSON.stringify(logs,null,2));
  await context.close();await new Promise(r=>srv.close(r));
 }
 await vite.close();
}
}finally{await browser.close();globalThis.fetch=originalFetch;fs.writeFileSync(home+'/evidence/results.json',JSON.stringify(results,null,2));}
console.log(JSON.stringify({passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length}));
process.exitCode=results.some(r=>r.status==='FAIL')?1:0;
