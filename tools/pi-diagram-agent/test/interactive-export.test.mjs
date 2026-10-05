import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {exportInteractiveSvg} from '../src/interactive-export.mjs';
import {renderAgentSvg} from '../src/agent-render.mjs';

const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250">
<rect width="400" height="250" fill="white"/>
<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#245"/></marker></defs>
<g transform="translate(5 5)">
<path data-edge="e1" data-source="A" data-target="C" data-shared-trunk="in" d="M100 40 L200 40 L200 180 L300 180" fill="none" stroke="#245" stroke-width="2" marker-end="url(#arrow)"/>
<path data-edge="e2" data-source="B" data-target="C" data-shared-trunk="in" d="M100 120 L200 120 L200 180 L300 180" fill="none" stroke="#245" stroke-width="2" marker-end="url(#arrow)"/>
<g data-group="G"><rect x="5" y="5" width="120" height="140" fill="none" stroke="#999"/>
<g data-node="A"><rect x="20" y="20" width="80" height="40" fill="#def"/><text x="30" y="45">Alpha</text></g>
<g data-node="B"><rect x="20" y="100" width="80" height="40" fill="#def"/><text x="30" y="125">Beta</text></g></g>
<g data-node="C"><rect x="300" y="160" width="80" height="40" fill="#def"/><text x="310" y="185">Gamma</text></g>
</g></svg>`);
const sha = value => createHash('sha256').update(value).digest('hex');
const browserOptions = {headless:true,...(process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE} : {})};

test('export checks output location and refuses unsafe input before writing', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-interactive-refusal-')), outPath=path.join(dir,'preview.html');
  try {
    await assert.rejects(exportInteractiveSvg(svg,{outPath:'relative.html'}), /ABSOLUTE/);
    fs.writeFileSync(outPath,'keep');
    await assert.rejects(exportInteractiveSvg(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),{outPath}));
    assert.equal(fs.readFileSync(outPath,'utf8'),'keep');
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('CLI refuses to overwrite its input through a directory symlink',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-interactive-alias-'));
  try{
    const real=path.join(dir,'real'),alias=path.join(dir,'alias');fs.mkdirSync(real);fs.symlinkSync(real,alias,'dir');
    const input=path.join(real,'source.svg');fs.writeFileSync(input,svg);
    const cli=fileURLToPath(new URL('../kit/export-interactive.mjs',import.meta.url));
    const result=spawnSync(process.execPath,[cli,input,path.join(alias,'source.svg')],{encoding:'utf8'});
    assert.equal(result.status,1);assert.match(result.stderr,/OUTPUT_MUST_DIFFER_FROM_INPUT/);
    assert.deepEqual(fs.readFileSync(input),svg);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('old kit connector bindings gain collision-free IDs and retain parallel relations', {skip:!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE}, async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-interactive-legacy-'));let browser;
  try{
    const first=svg.toString().match(/<path data-edge="e1"[^>]*\/>/)[0];
    const legacy=Buffer.from(svg.toString().replace('data-edge="e1"','data-edge="__interaction-edge-1"').replace(' data-edge="e2"','').replace('</svg>',first.replace(' data-edge="e1"','')+'</svg>'));
    const artifact=await exportInteractiveSvg(legacy,{outPath:path.join(dir,'legacy.html')});
    assert.equal(artifact.sourceSvgSha256,sha(legacy));assert.ok(artifact.sharedSectionCount>=2);
    const pw=createRequire(import.meta.url)(process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE);browser=await pw.chromium.launch(browserOptions);
    const page=await browser.newPage();await page.goto(`file://${artifact.path}`);
    const ids=await page.locator('path[data-source][data-target]').evaluateAll(paths=>paths.map(p=>p.dataset.edge));
    assert.deepEqual(ids,['__interaction-edge-1','__interaction-edge-1_','__interaction-edge-2']);
    await page.locator('g[data-node="A"]').focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('path[data-edge].is-active').count(),2);
  }finally{await browser?.close();fs.rmSync(dir,{recursive:true,force:true})}
});

test('renderer automatically exports a hash-bound interactive companion; browser selection works', {skip:!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE}, async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-interactive-render-'));
  let browser;
  try {
    const result=await renderAgentSvg(svg,{outPrefix:path.join(dir,'candidate')});
    assert.equal(result.svgHash,sha(svg));
    assert.equal(result.interactive.sourceSvgSha256,sha(svg));
    assert.equal(result.interactive.sharedSectionCount,2);
    assert.equal(result.interactive.sha256,sha(fs.readFileSync(result.interactive.path)));
    assert.equal(fs.statSync(result.interactive.path).mode & 0o777,0o600);
    const pw=createRequire(import.meta.url)(process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE);
    browser=await pw.chromium.launch(browserOptions);
    const page=await browser.newPage({viewport:{width:900,height:600}}), errors=[], requests=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>requests.push(r.url()));
    await page.goto(`file://${result.interactive.path}`);
    const state=()=>page.evaluate(()=>({
      nodes:[...document.querySelectorAll('g[data-node].is-active')].map(g=>g.dataset.node).sort(),
      edges:[...document.querySelectorAll('path[data-edge].is-active')].map(g=>g.dataset.edge).sort(),
      selected:document.querySelector('svg').dataset.selectionKind,
      opacity:getComputedStyle(document.querySelector('g[data-group]')).opacity,
    }));
    await page.locator('.node-hit[data-hit-node="A"]').click();
    assert.deepEqual((await state()).edges,['e1']);
    assert.deepEqual((await state()).nodes,['A','C']);
    assert.equal((await state()).selected,'node');
    assert.equal((await state()).opacity,'1');
    await page.mouse.move(850,550);
    assert.deepEqual((await state()).edges,['e1']);
    await page.keyboard.press('Escape');
    assert.deepEqual((await state()).edges,[]);
    await page.locator('.trunk-hit').first().focus();
    await page.keyboard.press('Enter');
    assert.deepEqual((await state()).edges,['e1','e2']);
    assert.deepEqual((await state()).nodes,['A','B','C']);
    assert.equal((await state()).selected,'trunk');
    assert.deepEqual(errors,[]);
    assert.equal(requests.filter(url=>!url.startsWith('file:')).length,0);
  } finally { await browser?.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});

test('standalone export produces deterministic bytes after independent browser measurement', {skip:!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE}, async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-interactive-export-'));
  try {
    const a=await exportInteractiveSvg(svg,{outPath:path.join(dir,'a.html')});
    const b=await exportInteractiveSvg(svg,{outPath:path.join(dir,'b.html')});
    assert.equal(a.sha256,b.sha256);
    assert.equal(a.sharedSectionCount,2);
    assert.equal(a.sourceSvgSha256,sha(svg));
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
