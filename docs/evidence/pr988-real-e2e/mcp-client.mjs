import fs from 'node:fs';
const root='/private/tmp/pr988-real-e2e',base='https://conf-stg-lite.zenuml.com';
const [arm,tool,args='{}',label=tool]=process.argv.slice(2);
const token=JSON.parse(fs.readFileSync(`${root}/secrets/${arm}-first-token.json`));
let r,body;
if(tool==='refresh'){
 r=await fetch(`${base}/agent-link/oauth/token`,{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',refresh_token:token.refresh_token,client_id:JSON.parse(fs.readFileSync(`${root}/secrets/${arm}-first.json`)).client.client_id,resource:`${base}/agent-link/mcp`})});
 body=await r.json();if(body.access_token)fs.writeFileSync(`${root}/secrets/${arm}-first-token.json`,JSON.stringify(body),{mode:0o600});
 console.log(JSON.stringify({status:r.status,accessTokenPresent:!!body.access_token,rotated:body.refresh_token!==token.refresh_token}));
}else{
 r=await fetch(`${base}/agent-link/mcp`,{method:'POST',headers:{authorization:`Bearer ${token.access_token}`,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:Date.now(),method:tool==='initialize'?'initialize':'tools/call',params:tool==='initialize'?{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'PR988 real acceptance',version:'1'}}:{name:tool,arguments:args.startsWith('@')?JSON.parse(fs.readFileSync(args.slice(1))):JSON.parse(args)}})});
 body=await r.json();console.log(JSON.stringify({status:r.status,body}));
}
fs.writeFileSync(`${root}/secrets/${arm}-${label}-response.json`,JSON.stringify(body,null,2),{mode:0o600});
fs.appendFileSync(`${root}/events.jsonl`,JSON.stringify({time:new Date().toISOString(),arm,step:tool,status:r.status,isError:body.result?.isError??!!body.error})+'\n');
