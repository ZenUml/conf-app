import test from 'node:test';
import assert from 'node:assert/strict';
import {github,readSentryIssue,readProject,fieldUpdates,setProjectSelects,preparePublicIssue} from './adapters.mjs';
const opts={token:'test-only-token',organization:'zenuml',issueId:'123',allowedProjectIds:['456']};
const response=(extra={})=>new Response(JSON.stringify({id:'123',project:{id:'456'},count:'7',status:'unresolved',lastSeen:'2026-11-08T00:00:00Z',title:'private customer',...extra}));
test('Sentry projects raw data to bounded metadata, not a monitoring verdict',async()=>{
 const result=await readSentryIssue(opts,async(url,options)=>{assert.equal(url,'https://sentry.io/api/0/organizations/zenuml/issues/123/');assert.equal(options.redirect,'error');return response();});
 assert.equal(result.count,7);assert.equal(result.releaseAttribution,false);assert.equal(JSON.stringify(result).includes('customer'),false);
});
test('Sentry foreign projects, denied reads, malformed IDs fail closed',async()=>{
 await assert.rejects(readSentryIssue(opts,async()=>response({project:{id:'9'}})),/Unexpected/);
 await assert.rejects(readSentryIssue(opts,async()=>new Response('',{status:403})),/403/);
 await assert.rejects(readSentryIssue({...opts,issueId:'../evil'},async()=>response()),/incomplete/);
 await assert.rejects(readSentryIssue(opts,async()=>response({count:'NaN'})),/count/);
});
test('Sentry response size is bounded',async()=>assert.rejects(readSentryIssue(opts,async()=>new Response('x'.repeat(1048577))),/Oversize/));
test('GitHub uses no shell and suppresses tool errors',async()=>{
 const result=await github('query{viewer{login}}',{},async(cmd,args,options)=>{assert.equal(cmd,'gh');assert.deepEqual(args.slice(0,4),['api','graphql','--hostname','github.com']);assert.equal(options.shell,undefined);return {stdout:'{"data":{"viewer":{"login":"test"}}}'};});assert.equal(result.viewer.login,'test');
 await assert.rejects(github('query{}',{},async()=>{throw Error('secret-value');}),error=>!error.message.includes('secret-value'));
 await assert.rejects(github('query{}',{},async()=>({stdout:'{"errors":[{"message":"private"}]}'})),/returned errors/);
});
const project={id:'P',fields:[{id:'F',name:'Agent',__typename:'ProjectV2SingleSelectField',options:[{id:'O',name:'未接通'}]}]};
test('Validate all field updates before any mutation',async()=>{
 assert.deepEqual(fieldUpdates(project,{Agent:'未接通'}),[{fieldId:'F',optionId:'O'}]);let calls=0;
 await assert.rejects(setProjectSelects(project,'I',{Agent:'未接通',missing:'x'},async()=>{calls++}),/Missing/);assert.equal(calls,0);
});
test('Project writes check item ownership',async()=>{
 await assert.rejects(setProjectSelects(project,'I',{Agent:'未接通'},async()=>({node:{project:{id:'wrong'}}})),/does not belong/);
 const calls=[];assert.equal(await setProjectSelects(project,'I',{Agent:'未接通'},async(q,v)=>{calls.push(v);return {node:{project:{id:'P',public:false}}}}),1);assert.equal(calls.length,2);
});
test('Project reads reject public projects',async()=>assert.rejects(readProject('P',async()=>({node:{public:true}})),/Private/));
test('Public issue projection excludes untrusted evidence',()=>{
 const issue=preparePublicIssue({organization:'zenuml',project:'conf-lite',issueId:'123',environment:'production',title:'tenant.example secret'});
 assert.ok(!JSON.stringify(issue).includes('tenant.example'));
});

test('Sentry parse and stream errors never expose raw content or causes',async()=>{
 const secret='private-customer-secret';
 const safeError=error=>{assert.equal(error.message,'Sentry response unreadable; observation is inconclusive');assert.equal(error.cause,undefined);assert.ok(!error.stack.includes(secret));return true;};
 await assert.rejects(readSentryIssue(opts,async()=>new Response(secret)),safeError);
 await assert.rejects(readSentryIssue(opts,async()=>new Response(new ReadableStream({start(controller){controller.error(new Error(secret));}}))),safeError);
 await assert.rejects(readSentryIssue(opts,async()=>({ok:true,body:{getReader(){return {read:async()=>({done:true}),cancel:async()=>{throw new Error(secret);}};}}})),safeError);
 await assert.rejects(readSentryIssue(opts,async()=>new Response(null)),safeError);
});
test('Project writes reject live public or unknown visibility before mutation',async()=>{
 for(const visibility of [true,undefined,null]){
  let writes=0;
  await assert.rejects(setProjectSelects({...project,public:false},'I',{Agent:'未接通'},async(q)=>{
   if(q.startsWith('mutation'))writes++;
   assert.match(q,/project\{id public\}/);
   return {node:{project:{id:'P',public:visibility}}};
  }),/Private project required/);
  assert.equal(writes,0);
 }
});
test('Project visibility is refreshed before every field mutation',async()=>{
 const twoFields={...project,fields:[...project.fields,{...project.fields[0],id:'F2',name:'Risk'}]};
 let reads=0,writes=0;
 await assert.rejects(setProjectSelects(twoFields,'I',{Agent:'未接通',Risk:'未接通'},async(q)=>{
  if(q.startsWith('mutation')){writes++;return {updateProjectV2ItemFieldValue:{projectV2Item:{id:'I'}}};}
  reads++;return {node:{project:{id:'P',public:reads>1}}};
 }),/Private project required/);
 assert.equal(reads,2);assert.equal(writes,1);
});
