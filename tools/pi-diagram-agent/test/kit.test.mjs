import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {auditAgentSvg} from '../src/agent-audit.mjs';

const kit=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','kit');
const source='flowchart LR\n  A[Start] --> B{Ready}\n  B -- "Yes" --> C[(Store)]\n  B -.-> D(Skip)\n';

test('a kit-built synthetic SVG passes textFit, labelClearance and relations in the independent audit (not NOT-CHECKABLE)',
  {skip:!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE},async()=>{
    const svg=execFileSync('python3',[path.join(kit,'example.py')],{encoding:'utf8'});
    const result=await auditAgentSvg(source,Buffer.from(svg));
    for(const id of ['nodeIdentity','nodeText','relations','relationStyle','textFit','labelClearance','markerDrawing','arrowShaft','routeNodeIntrusion'])
      assert.equal(result.checks[id].status,'PASS',`${id}: ${JSON.stringify(result.checks[id].evidence)}`);
  });

test('kit measure_text is an upper bound of live browser glyph widths for the kit font stack',
  {skip:!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE},async()=>{
    const {createRequire}=await import('node:module');
    const playwright=createRequire(import.meta.url)(process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE);
    const samples=['Customer Deposit IDR via Nobu VA','WOQ@%&-#','Order 0123456789','Mmmm Wwww','Settlement (T+1) ~ 99%'];
    for(let c=32;c<127;c++)samples.push(String.fromCharCode(c).repeat(6));
    const sizes=[12,15,16,18,24];
    const estimate=JSON.parse(execFileSync('python3',['-c',`import sys,json;sys.path.insert(0,${JSON.stringify(kit)});import svgkit as k;print(json.dumps([[k.measure_text(s,z) for z in ${JSON.stringify(sizes)}] for s in json.loads(sys.argv[1])]))`,JSON.stringify(samples)],{encoding:'utf8'}));
    const font=execFileSync('python3',['-c',`import sys;sys.path.insert(0,${JSON.stringify(kit)});import svgkit as k;print(k.DEFAULT_FONT)`],{encoding:'utf8'}).trim();
    const browser=await playwright.chromium.launch({headless:true,...(process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE?{executablePath:process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE}:{})});
    try{
      const page=await browser.newPage();
      const widths=await page.evaluate(({samples,font,sizes})=>{const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');document.body.appendChild(svg);
        return samples.map(s=>sizes.map(z=>{const t=document.createElementNS(ns,'text');t.setAttribute('font-size',String(z));t.setAttribute('font-family',font);t.setAttribute('xml:space','preserve');t.textContent=s;svg.appendChild(t);const w=t.getBBox().width;t.remove();return w}))},{samples,font,sizes});
      const under=samples.flatMap((s,i)=>sizes.map((z,j)=>({s,size:z,real:widths[i][j],kit:estimate[i][j]}))).filter(r=>r.real>r.kit+1e-6);
      assert.deepEqual(under,[]);
    }finally{await browser.close()}
  });
