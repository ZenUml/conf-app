import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {collectArrowEndStartFacts,checkArrowEndStartClearance} from '../src/arrow-end-start.mjs';
import {auditFailBlocks,relaxFindings} from '../src/relaxed.mjs';
const enabled=!!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE;
const marker=(extra='',shape='M0 0 L10 5 L0 10 Z')=>`<marker id="a" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" refX="10" refY="5" orient="auto" ${extra}><path d="${shape}" fill="black" stroke="none"/></marker>`;
const edge=(id,d,extra='',tag='path')=>`<${tag} data-edge="${id}" data-source="${id}S" data-target="T" ${tag==='path'?`d="${d}"`:tag==='polyline'?`points="${d}"`:d} stroke="black" stroke-width="1" fill="none" marker-end="url(#a)" ${extra}/>`;
const svg=(edges,m=marker())=>`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><defs>${m}</defs>${edges}</svg>`;
async function measure(input){const require=createRequire(import.meta.url),{chromium}=require(process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE),browser=await chromium.launch({headless:true,...(process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE?{executablePath:process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE}:{})});try{const page=await browser.newPage();return checkArrowEndStartClearance(await page.evaluate(collectArrowEndStartFacts,input))}finally{await browser.close()}}
test('exact overlap blocks relaxed and cannot become advice',()=>{const check=checkArrowEndStartClearance({edges:[{edge:'in',index:0,arrow:true,end:[20,20],start:[0,20]},{edge:'out',index:1,arrow:false,start:[20,20]}]});assert.equal(check.status,'FAIL');assert.equal(auditFailBlocks('arrowEndStartClearance',check),true);assert.equal(relaxFindings([{source:'audit',severity:'blocking',rule:'arrowEndStartClearance'}])[0].severity,'blocking')});
test('browser exact coincidence, separated ports and positive head overlap',{skip:!enabled},async()=>{
 assert.equal((await measure(svg(edge('in','M0 50 L50 50')+edge('out','M50 50 L90 50')))).status,'FAIL');
 assert.equal((await measure(svg(edge('in','M0 50 L50 50')+edge('out','M50 66 L90 66')))).status,'PASS');
 const near=await measure(svg(edge('in','M0 50 L50 50')+edge('out','M44 52 L44 90')));assert.equal(near.status,'FAIL');assert.match(near.evidence.violations[0].reason,/painted arrowhead/);
});
test('declared incoming trunk end/end allowed, declaration never exempts end/start',{skip:!enabled},async()=>{
 const incoming=edge('in','M0 50 L50 50','data-shared-trunk="family"')+edge('parallel','M0 50 L50 50','data-shared-trunk="family"');assert.equal((await measure(svg(incoming))).status,'PASS');
 const conflict=await measure(svg(incoming+edge('out','M50 50 L100 50','data-shared-trunk="family"')));assert.equal(conflict.status,'FAIL');assert.equal(conflict.evidence.violations.length,2);
});
test('actual polyline and line endpoints transform to root; strokeWidth marker scales',{skip:!enabled},async()=>{
 assert.equal((await measure(svg(`<g transform="translate(10 20) scale(2)">${edge('in','0,25 25,25','','polyline')}</g>`+edge('out','x1="60" y1="70" x2="100" y2="70"','','line')))).status,'FAIL');
 const m=marker().replace('userSpaceOnUse','strokeWidth');assert.equal((await measure(svg(edge('in','M0 50 L50 50','style="stroke-width:2"')+edge('out','M34 55 L34 90'),m))).status,'FAIL');
});
test('unsupported viewBox, orientation, child transform and curve stay unresolved',{skip:!enabled},async()=>{
 const edges=edge('in','M0 50 L50 50')+edge('out','M50 100 L90 100');
 for(const m of [marker('viewBox="0 0 12 12"'),marker().replace('orient="auto"','orient="1rad"'),marker().replace('<path','<path transform="scale(2)"'),marker('','M0 0 Q5 5 10 5 L0 10 Z')])assert.equal((await measure(svg(edges,m))).status,'NOT-CHECKABLE');
 assert.equal((await measure(svg(edge('in','M0 50 Q25 40 50 50')+edge('out','M50 100 L90 100')))).status,'NOT-CHECKABLE');
});

test('garbage path is unresolved and repeated closed marker vertex retains overlap',{skip:!enabled},async()=>{
 assert.equal((await measure(svg(edge('in','M0 50 @ L50 50')+edge('out','M50 100 L90 100')))).status,'NOT-CHECKABLE');
 const closed=marker('', 'M0 0 L0 0 L10 5 L0 10 L0 0 Z');
 assert.equal((await measure(svg(edge('in','M0 50 L50 50')+edge('out','M44 52 L44 90'),closed))).status,'FAIL');
 const css=marker().replace('<path','<path style="transform:scale(2)"');assert.equal((await measure(svg(edge('in','M0 50 L50 50'),css))).status,'NOT-CHECKABLE');
});

test('browser float32 decimal coordinates retain checkability and shared terminal cannot hide a start inside head',{skip:!enabled},async()=>{
 assert.equal((await measure(svg(edge('in','M0.123456789 50.123456789 L50.234567891 50.123456789')+edge('out','M50.234567891 100.123456789 L90.234567891 100.123456789')))).status,'PASS');
 const collision=await measure(svg(edge('in','M0 50 L50 50','data-shared-trunk="family"')+edge('short','M44 50 L50 50','data-shared-trunk="family"')));
 assert.equal(collision.status,'FAIL');assert.ok(collision.evidence.violations.some(v=>v.reason==='connector start lies inside painted arrowhead'));
});
