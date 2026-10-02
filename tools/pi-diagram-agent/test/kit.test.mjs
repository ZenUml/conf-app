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
