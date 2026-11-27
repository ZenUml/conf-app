import test from 'node:test';import assert from 'node:assert/strict';
import {classifyQuality} from '../src/quality.mjs';
const hash='a'.repeat(64);
const run=()=>({doneReason:'AGENT_SETTLED',audit:{status:'NOT-CHECKABLE',fail:[],notCheckable:[]},finalSvgInspected:true,finalSvgSha256:hash,v2:{gateStatus:'REVIEWED',finalSvgSha256:hash}});
test('reviewed exact SVG with structural non-checkable rules is a candidate only',()=>{const q=classifyQuality(run());assert.equal(q.status,'REVIEWED_CANDIDATE');assert.equal(q.certified,false);assert.equal(q.accepted,false);assert.ok(q.notCheckable.includes('visualQuality'))});
test('missing evidence, model failures and hash mismatch remain incomplete',()=>{for(const patch of [{audit:null},{audit:{status:'FAIL',fail:['semantic']}},{finalSvgInspected:false},{finalSvgSha256:'b'.repeat(64)},{agentError:'failure'},{rateLimited:true},{doneReason:'TIME_LIMIT'},{v2:{gateStatus:'CANDIDATE',finalSvgSha256:hash}},{v2:{gateStatus:'REVIEWED_WITH_EXCEPTIONS',finalSvgSha256:hash}}])assert.equal(classifyQuality({...run(),...patch}).status,'INCOMPLETE',JSON.stringify(patch))});
