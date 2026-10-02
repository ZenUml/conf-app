// run.json: the orchestrator's hash-bound record of a v2 run, and the human-only acceptance that turns REVIEWED into VALIDATED.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const sha=b=>createHash('sha256').update(b).digest('hex');
const body=({selfHash,...rest})=>rest;
const digest=obj=>sha(JSON.stringify(body(obj)));

export const sealManifest=obj=>({...body(obj),selfHash:digest(obj)});
export const verifyManifest=obj=>!!obj&&typeof obj==='object'&&typeof obj.selfHash==='string'&&obj.selfHash===digest(obj);

export function writeRunManifest(runDir,obj){
  const sealed=sealManifest(obj),file=path.join(runDir,'run.json'),temp=path.join(runDir,`.run.${randomUUID()}.tmp`);
  try{fs.writeFileSync(temp,JSON.stringify(sealed,null,2),{flag:'wx',mode:0o600});fs.renameSync(temp,file)}finally{fs.rmSync(temp,{force:true})}
  return sealed;
}

export function readRunManifest(runDir){
  let parsed;
  try{parsed=JSON.parse(fs.readFileSync(path.join(runDir,'run.json'),'utf8'))}catch{throw Error('RUN_MANIFEST_UNREADABLE')}
  if(!verifyManifest(parsed))throw Error('MANIFEST_TAMPERED');
  return parsed;
}

/** Same location rule as --resume: a private run directory directly under the OS temp directory. */
export function safeRunDir(dir,{cwd=process.cwd()}={}){
  let real;try{real=fs.realpathSync(path.resolve(cwd,dir))}catch{throw Error('UNSAFE_RUN_DIRECTORY')}
  if(path.dirname(real)!==fs.realpathSync(os.tmpdir())||!/^pi-diagram-agent-[A-Za-z0-9]+$/.test(path.basename(real)))throw Error('UNSAFE_RUN_DIRECTORY');
  return real;
}

/** Human-only (a slash command, never a tool): VALIDATED only for a REVIEWED run whose final bytes still hash to the accepted value.
 *  expectedSelfHash is the live process's own record of the manifest it wrote; without it only the seal can be checked, and an author with
 *  shell access could re-seal a forged run.json until the author is sandboxed. */
export function acceptRun(runDirArg,svgSha256,{user=os.userInfo().username,now=()=>new Date(),expectedSelfHash=null,cwd=process.cwd()}={}){
  const runDir=safeRunDir(runDirArg,{cwd});
  const m=readRunManifest(runDir);
  if(expectedSelfHash&&m.selfHash!==expectedSelfHash)throw Error('MANIFEST_TAMPERED');
  if(m.status!=='REVIEWED')throw Error(`RUN_NOT_REVIEWED: status is ${m.status}; only a REVIEWED run can be accepted`);
  if(!/^[0-9a-f]{64}$/.test(String(svgSha256)))throw Error('INVALID_HASH: expected 64 lowercase hex characters');
  if(svgSha256!==m.finalSvgSha256)throw Error(`HASH_MISMATCH: the reviewed final SVG is ${m.finalSvgSha256}`);
  let onDisk;try{onDisk=sha(fs.readFileSync(path.join(runDir,'candidate.svg')))}catch{throw Error('CANDIDATE_CHANGED_SINCE_REVIEW: candidate.svg unreadable')}
  if(onDisk!==m.finalSvgSha256)throw Error('CANDIDATE_CHANGED_SINCE_REVIEW: candidate.svg no longer matches the reviewed hash');
  const acceptance={authorisedBy:String(user),timestamp:now().toISOString(),sourceHash:m.sourceHash,svgSha256,acceptedFrom:'REVIEWED'};
  const sealed=writeRunManifest(runDir,{...body(m),status:'VALIDATED',acceptance});
  return {status:'VALIDATED',runDir,svgSha256,selfHash:sealed.selfHash,acceptance};
}
