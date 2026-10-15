// Opt-in live check of the real Pi reviewer session (calls the model: uses subscription quota). NOT part of `npm test`.
//   PI_DIAGRAM_LIVE=1 PI_DIAGRAM_PI_SDK=/path/to/@earendil-works/pi-coding-agent/dist/index.js PI_DIAGRAM_LIVE_SVG=/path/to/candidate.svg \
//   PI_DIAGRAM_PLAYWRIGHT_MODULE=... PI_DIAGRAM_CHROMIUM_EXECUTABLE=... node --test live/reviewer-live.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseMermaid} from '../src/parser.mjs';
import {renderAgentSvg} from '../src/agent-render.mjs';
import {buildReviewerFacts,buildReviewerPrompt,runReviewer,createPiReviewerFactory} from '../src/reviewer.mjs';

const live=process.env.PI_DIAGRAM_LIVE==='1';
test('live: real in-process reviewer returns schema-valid findings for a candidate SVG',{skip:!live},async()=>{
  const sdkPath=process.env.PI_DIAGRAM_PI_SDK,svgPath=process.env.PI_DIAGRAM_LIVE_SVG;
  assert.ok(sdkPath&&svgPath,'set PI_DIAGRAM_PI_SDK and PI_DIAGRAM_LIVE_SVG');
  const sdk=await import(pathToFileURL(sdkPath).href);
  const source=fs.readFileSync(new URL('../bench/fixtures/f2-decision.mmd',import.meta.url),'utf8');
  const model=parseMermaid(source);
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'pi-reviewer-live-'));
  try{
    const r=await renderAgentSvg(fs.readFileSync(svgPath),{outPrefix:path.join(out,'cand')});
    const img=f=>({type:'image',data:fs.readFileSync(f.path).toString('base64'),mimeType:'image/png'});
    const images=[r.full,r.full,...r.crops,r.fullscreen].map(img); // no original render needed for this smoke: the candidate stands in for image 1
    const prompt=buildReviewerPrompt({facts:buildReviewerFacts(model),audit:{checks:{}},imageCount:images.length});
    const result=await runReviewer({factory:createPiReviewerFactory(sdk,{provider:'openai-codex',modelId:process.env.PI_DIAGRAM_CODEX_MODEL||'gpt-5.6-sol',cwd:out}),prompt,images,model,natural:r.natural});
    assert.equal(result.ok,true,result.error);
    assert.ok(['accept','revise'].includes(result.verdict));
    assert.ok(result.usage.input>0);
  }finally{fs.rmSync(out,{recursive:true,force:true})}
});
