import assert from 'node:assert/strict';
import * as before from './before.mjs';
import * as after from './after.mjs';
for (const [name,module] of Object.entries({before,after})) {
 const rows=[];
 for(const scenario of ['gemma-chat-shape','non-string-output','primary-error']) {
  const models=[];
  const ai={run:async(model,input)=>{models.push(model);if(scenario==='gemma-chat-shape')return {choices:[{message:{content:'"""Order Processing"""'}}]};if(models.length===1){if(scenario==='primary-error')throw Error('Model unavailable');return {response:{title:'Wrong Title'}};}return {response:'Fallback Title'};}};
  const res=await module.onRequest({request:new Request('https://example.invalid/ai-generate-title',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dsl:'Customer->Shop: order',type:'sequence'})}),env:{AI:ai}});
  rows.push({scenario,status:res.status,title:await res.text(),models});
 }
 console.log(JSON.stringify({version:name,results:rows},null,2));
 if(name==='before'){assert.equal(rows[0].status,500);assert.equal(rows[1].title,'[object Object]');}
 else {assert.equal(rows[0].status,200);assert.equal(rows[0].title,'Order Processing');assert.equal(rows[0].models.length,1);assert.equal(rows[1].title,'Fallback Title');assert.equal(rows[2].title,'Fallback Title');assert.equal(rows[2].models[1],'@cf/meta/llama-3.3-70b-instruct-fp8-fast');}
}
