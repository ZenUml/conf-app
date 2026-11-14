#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {runtimePaths,configureRuntime} from './src/runtime.mjs';
import {classifyQuality} from './src/quality.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const usage=`Pi diagram refinement (openai-codex subscription OAuth)
  node cli.mjs doctor
  node cli.mjs refine --source <diagram.mmd> --out <directory outside repo> --model <id> [--timeout-min 20] [--pi-bin <executable>]
Install: pnpm install --ignore-workspace --frozen-lockfile; pnpm run setup:browser
Authenticate separately with the installed Pi CLI /login and choose OpenAI Codex.
Refinement and independent review consume subscription quota. No paid API fallback.
Outputs: summary.md, summary.json, candidate SVG and audit evidence, quality.json.
A candidate is not human-accepted or certified. An incomplete quality gate exits 2.`;
async function doctor(){
  const paths=runtimePaths();
  const [{chromium},ai,sdk]=await Promise.all([import('playwright'),import('typebox'),import('@earendil-works/pi-coding-agent')]);
  if(!ai.Type||!sdk.defineTool||!sdk.createAgentSession)throw Error('Installed Pi SDK lacks required exports; reinstall pinned dependencies');
  for(const [name,p] of Object.entries(paths))if(!fs.existsSync(p))throw Error(`${name} missing: run pnpm install --ignore-workspace --frozen-lockfile`);
  const py=spawnSync('python3',['--version'],{encoding:'utf8'});
  if(py.status!==0)throw Error('python3 is required for generated diagram scripts');
  let browser;try{browser=await chromium.launch({headless:true,executablePath:process.env.PI_DIAGRAM_CHROMIUM_EXECUTABLE});await browser.newPage()}catch(e){throw Error(`Chromium unavailable: run pnpm run setup:browser. ${e.message}`)}finally{await browser?.close()}
  console.log('PASS: local Pi SDK, Mermaid, Python and Chromium. OAuth/model access is unverified; doctor makes no model calls.');
}
async function main(){
 const [command,...args]=process.argv.slice(2);
 if(!command||args.includes('--help')||command==='--help'||command==='-h'){console.log(usage);return}
 if(command==='doctor'){await doctor();return}
 if(command!=='refine')throw Error(usage);
 const opts={};for(let i=0;i<args.length;i++){if(!['--source','--out','--model','--timeout-min','--pi-bin'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--'))throw Error(`Invalid argument ${args[i]}\n${usage}`);if(opts[args[i]])throw Error(`Duplicate ${args[i]}`);opts[args[i]]=args[++i]}
 for(const k of ['--source','--out','--model'])if(!opts[k])throw Error(`${k} is required\n${usage}`);
 const timeout=Number(opts['--timeout-min']??20);if(!Number.isFinite(timeout)||timeout<=0)throw Error('--timeout-min must be a positive number');
 const source=path.resolve(opts['--source']);if(!fs.statSync(source).isFile())throw Error('--source must be a file');
 await doctor();configureRuntime();
 const out=path.resolve(opts['--out']);
 const result=spawnSync(process.execPath,[path.join(root,'bench/run-bench.mjs'),'--package',root,'--fixtures',source,'--out',out,'--model',opts['--model'],'--timeout-min',String(timeout),...(opts['--pi-bin']?['--pi-bin',path.resolve(opts['--pi-bin'])]:[])],{stdio:'inherit',env:{...process.env,PI_DIAGRAM_REVIEWER_MODEL:opts['--model'],PI_DIAGRAM_JUDGE_MODEL:opts['--model']}});
 if(result.error)throw result.error;if(result.status!==0){process.exitCode=result.status??1;return}
 const summary=JSON.parse(fs.readFileSync(path.join(out,'summary.json'),'utf8'));const run=summary.runs?.[0];
 const quality={...classifyQuality(run),model:opts['--model'],provider:'openai-codex',summary:path.join(out,'summary.md')};
 fs.writeFileSync(path.join(out,'quality.json'),JSON.stringify(quality,null,2)+'\n');console.log(JSON.stringify(quality,null,2));if(quality.status!=='REVIEWED_CANDIDATE')process.exitCode=2;
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
