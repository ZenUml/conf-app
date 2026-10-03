#!/usr/bin/env node
// Offline Judge batch. CALLS THE REAL MODEL (subscription quota, native openai-codex only). See README.md.
// Offline results are measurements: nothing is written into a run directory and nothing here can gate /magic-accept.
//   node bench/judge.mjs --runs <dir...> --out <results.jsonl> [--fixtures <dir>] [--vs-old <dir of older run dirs>] [--concurrency 2] [--model <id>] [--sdk <path>]
// A run dir is either a live /magic run (candidate.svg + sealed run.json whose originalSvgHash names an SVG in the dir) or a benchmark output dir
// (one <stem>.candidate.svg; the Mermaid source is <fixtures>/<stem minus -rN>.mmd and is re-rendered).
// --vs-old <dir>: each run X is compared with the final SVG of <dir>/<basename X> instead of with the original render.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {judgeSvgs,findOriginalSvg,hasGroupsFromOriginalSvg} from '../src/judge-run.mjs';
import {createPiJudgeFactory,judgeThinkingFromEnv} from '../src/judge.mjs';
import {readRunManifest} from '../src/manifest.mjs';
import {parseMermaid} from '../src/parser.mjs';
import {renderOriginalMermaid} from '../src/original-render.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SDK=path.join(os.homedir(),'.volta/tools/image/packages/@earendil-works/pi-coding-agent/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js');
const ENV_DEFAULTS={
  PI_DIAGRAM_PLAYWRIGHT_MODULE:'/Users/pengxiao/.npm/_npx/9833c18b2d85bc59/node_modules/playwright',
  PI_DIAGRAM_CHROMIUM_EXECUTABLE:'/Users/pengxiao/Library/Caches/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-mac-arm64/chrome-headless-shell',
  PI_DIAGRAM_MERMAID_BUNDLE:'/Users/pengxiao/.codex/worktrees/magic-prepared-diagram/conf-app/node_modules/mermaid/dist/mermaid.min.js',
};

export function parseJudgeArgs(argv){
  const o={runs:[],concurrency:2,fixtures:path.join(here,'fixtures')};
  const usage='usage: judge.mjs --runs <dir...> --out <results.jsonl> [--fixtures <dir>] [--vs-old <dir>] [--concurrency N] [--model <id>] [--sdk <path>]';
  for(let i=0;i<argv.length;i++){
    const a=argv[i],next=()=>{if(i+1>=argv.length||argv[i+1].startsWith('--'))throw Error(`missing value for ${a}; ${usage}`);return argv[++i]};
    if(a==='--runs'){while(i+1<argv.length&&!argv[i+1].startsWith('--'))o.runs.push(argv[++i])}
    else if(a==='--out')o.out=next();
    else if(a==='--fixtures')o.fixtures=next();
    else if(a==='--vs-old')o.vsOld=next();
    else if(a==='--concurrency')o.concurrency=Number(next());
    else if(a==='--model')o.model=next();
    else if(a==='--sdk')o.sdk=next();
    else throw Error(`unknown argument ${a}; ${usage}`);
  }
  if(!o.runs.length||!o.out)throw Error(usage);
  if(!(Number.isInteger(o.concurrency)&&o.concurrency>=1))throw Error('--concurrency must be an integer >= 1');
  return o;
}

/** The final SVG of a run dir (live or benchmark layout) plus its stem. */
function readFinal(dir){
  const live=path.join(dir,'candidate.svg');
  if(fs.existsSync(live)){
    let manifest=null;try{manifest=readRunManifest(dir)}catch{}
    return {candidatePath:live,stem:path.basename(dir),manifest};
  }
  const found=fs.readdirSync(dir).filter(n=>n.endsWith('.candidate.svg'));
  if(found.length!==1)throw Error(`CANDIDATE_NOT_FOUND: ${dir} needs candidate.svg or exactly one *.candidate.svg (found ${found.length})`);
  return {candidatePath:path.join(dir,found[0]),stem:found[0].replace(/\.candidate\.svg$/,'').replace(/-r\d+$/,''),manifest:null};
}

async function originalFor(fin,dir,{fixtures,renderOriginal}){
  if(fin.manifest?.originalSvgHash){const o=findOriginalSvg(dir,fin.manifest.originalSvgHash);if(o)return {bytes:o.bytes,hasGroups:hasGroupsFromOriginalSvg(o.bytes)}}
  const src=path.join(fixtures,`${fin.stem}.mmd`);
  if(!fs.existsSync(src))throw Error(`SOURCE_NOT_FOUND: ${src} (pass --fixtures <dir with ${fin.stem}.mmd>)`);
  const text=fs.readFileSync(src,'utf8');
  let hasGroups;try{hasGroups=parseMermaid(text).groups.length>0}catch{hasGroups=/^\s*subgraph\b/m.test(text)}
  return {bytes:await renderOriginal(Buffer.from(text)),hasGroups};
}

export async function resolveRunInput(dir,{fixtures,vsOld=null,renderOriginal}){
  const fin=readFinal(dir);
  const candidate=fs.readFileSync(fin.candidatePath);
  const orig=await originalFor(fin,dir,{fixtures,renderOriginal});
  if(!vsOld)return {run:dir,candidatePath:fin.candidatePath,candidate,baseline:orig.bytes,hasGroups:orig.hasGroups,mode:'original'};
  const oldDir=path.join(vsOld,path.basename(dir));
  if(!fs.existsSync(oldDir))throw Error(`VS_OLD_NOT_FOUND: ${oldDir}`);
  const old=readFinal(oldDir);
  return {run:dir,candidatePath:fin.candidatePath,candidate,baseline:fs.readFileSync(old.candidatePath),hasGroups:orig.hasGroups,mode:'vs-old'};
}

const sumUsage=passes=>{const t={};for(const p of passes)for(const [k,v] of Object.entries(p.usage??{}))if(typeof v==='number')t[k]=(t[k]??0)+v;return t};

export async function runJudgeBatch({runs,fixtures,vsOld=null,concurrency=2,out,factory,render,renderOriginal,model,thresholds,timeoutMs,log=()=>{}}){
  fs.mkdirSync(path.dirname(out),{recursive:true,mode:0o700});fs.chmodSync(path.dirname(out),0o700);
  fs.writeFileSync(out,'',{mode:0o600});
  const results=new Array(runs.length);let next=0;
  const one=async dir=>{
    const t0=Date.now();
    try{
      const r=await resolveRunInput(dir,{fixtures,vsOld,renderOriginal});
      const j=await judgeSvgs({candidate:r.candidate,baseline:r.baseline,hasGroups:r.hasGroups,factory,render,model,mode:r.mode,thresholds,timeoutMs});
      const dims=Object.fromEntries(Object.entries(j.merged.dims??{}).map(([d,v])=>[d,v?{score:v.score,uncertain:v.uncertain}:null]));
      const passes=j.passes.map(p=>({order:p.order,ok:p.ok,scores:p.scores??null,error:p.error??null,ms:p.ms}));
      return {run:dir,mode:r.mode,candidateSha256:j.candidateSha256,baselineSha256:j.originalSha256,verdict:j.verdict,verdictReason:j.verdictReason,mean:j.mean,dims,passes,ms:Date.now()-t0,tokens:sumUsage(j.passes)};
    }catch(error){return {run:dir,verdict:'ERROR',error:String(error?.message??error),ms:Date.now()-t0}}
  };
  const worker=async()=>{while(next<runs.length){const i=next++;const line=await one(runs[i]);results[i]=line;fs.appendFileSync(out,JSON.stringify(line)+'\n');log(line)}};
  await Promise.all(Array.from({length:Math.min(concurrency,runs.length)},worker));
  return results;
}

async function main(){
  for(const [k,v] of Object.entries(ENV_DEFAULTS))process.env[k]??=v;
  const o=parseJudgeArgs(process.argv.slice(2));
  const sdk=await import(pathToFileURL(o.sdk||process.env.PI_DIAGRAM_PI_SDK||DEFAULT_SDK).href);
  const modelId=o.model||process.env.PI_DIAGRAM_JUDGE_MODEL||process.env.PI_DIAGRAM_REVIEWER_MODEL||'gpt-6.1-sol';
  const thinking=judgeThinkingFromEnv();
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'pi-judge-orig-'));fs.chmodSync(work,0o700);
  const cache=new Map();
  const renderOriginal=async bytes=>{
    const key=bytes.toString('base64');if(cache.has(key))return cache.get(key);
    const prefix=path.join(work,`o${cache.size}`);
    const r=await renderOriginalMermaid(bytes,{outPrefix:prefix,mermaidBundlePath:process.env.PI_DIAGRAM_MERMAID_BUNDLE});
    const svg=fs.readFileSync(path.join(work,r.media.svg.file));cache.set(key,svg);return svg;
  };
  try{
    await runJudgeBatch({...o,factory:createPiJudgeFactory(sdk,{provider:'openai-codex',modelId,thinkingLevel:thinking}),renderOriginal,
      model:{provider:'openai-codex',id:modelId,thinking},
      log:l=>console.error(`${l.verdict.padEnd(12)} mean ${l.mean===undefined?'-':l.mean.toFixed(2)}  ${Math.round(l.ms/1000)}s  ${l.run}${l.error?`  ${l.error}`:''}`)});
  }finally{fs.rmSync(work,{recursive:true,force:true})}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(String(e?.message??e));process.exit(1)});
