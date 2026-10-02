// Run manifest: the orchestrator's hash-bound record of a v2 run, and the human-only acceptance that turns REVIEWED into VALIDATED.
// The AUTHORITATIVE copy lives outside every run directory (~/.pi-diagram-agent/manifests/<runId>.json, 0600, written before the
// first model turn); run.json in the run directory is a mirror for tools such as the benchmark and is never trusted on its own.
// Residual risk, stated plainly: the author has a shell as the same OS user, so it can reach ~/.pi-diagram-agent as well. What makes
// acceptance safe is that it is human (a slash command, never a tool), names one exact SVG hash, re-hashes the candidate bytes, and,
// for a run orchestrated by the live process, compares against the in-memory manifest the author cannot touch.
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

export const manifestDirFromEnv=(env=process.env)=>env.PI_DIAGRAM_MANIFEST_DIR||path.join(os.homedir(),'.pi-diagram-agent','manifests');

function ensurePrivateDir(dir){
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const st=fs.lstatSync(dir);
  if(!st.isDirectory()||st.isSymbolicLink())throw Error('UNSAFE_MANIFEST_DIRECTORY');
  if((st.mode&0o077)!==0)fs.chmodSync(dir,0o700);
  return dir;
}
export const authoritativeManifestPath=(runDir,{manifestDir=manifestDirFromEnv()}={})=>path.join(manifestDir,`${path.basename(runDir)}.json`);

/** Writes the authoritative manifest first, then mirrors the same sealed bytes to run.json in the run directory. */
export function writeManifests(runDir,obj,{manifestDir=manifestDirFromEnv()}={}){
  const sealed=sealManifest(obj),dir=ensurePrivateDir(manifestDir),file=authoritativeManifestPath(runDir,{manifestDir}),temp=path.join(dir,`.${path.basename(file)}.${randomUUID()}.tmp`);
  try{fs.writeFileSync(temp,JSON.stringify(sealed,null,2),{flag:'wx',mode:0o600});fs.renameSync(temp,file)}finally{fs.rmSync(temp,{force:true})}
  writeRunManifest(runDir,sealed);
  return sealed;
}

export function readAuthoritativeManifest(runDir,{manifestDir=manifestDirFromEnv()}={}){
  const file=authoritativeManifestPath(runDir,{manifestDir});
  const st=fs.lstatSync(file,{throwIfNoEntry:false});
  if(!st)throw Error(`AUTHORITATIVE_MANIFEST_MISSING: ${file}`);
  if(!st.isFile()||st.isSymbolicLink())throw Error('AUTHORITATIVE_MANIFEST_UNSAFE');
  let parsed;try{parsed=JSON.parse(fs.readFileSync(file,'utf8'))}catch{throw Error('AUTHORITATIVE_MANIFEST_UNREADABLE')}
  if(!verifyManifest(parsed))throw Error('MANIFEST_TAMPERED: authoritative manifest seal');
  return parsed;
}

/** Same location rule as --resume: a private run directory directly under the OS temp directory. */
export function safeRunDir(dir,{cwd=process.cwd()}={}){
  let real;try{real=fs.realpathSync(path.resolve(cwd,dir))}catch{throw Error('UNSAFE_RUN_DIRECTORY')}
  if(path.dirname(real)!==fs.realpathSync(os.tmpdir())||!/^pi-diagram-agent-[A-Za-z0-9]+$/.test(path.basename(real)))throw Error('UNSAFE_RUN_DIRECTORY');
  return real;
}

/** Human-only (a slash command, never a tool): VALIDATED only for a REVIEWED run whose final bytes still hash to the accepted value.
 *  Checks, in order: the authoritative manifest (outside the run directory) exists and is sealed; it equals the live process's in-memory
 *  manifest when one is supplied (`expected` object or `expectedSelfHash`); the run-directory mirror agrees with it; status REVIEWED;
 *  the hash argument; and the candidate bytes on disk. VALIDATED is written to the authoritative manifest and mirrored. */
export function acceptRun(runDirArg,svgSha256,{user=os.userInfo().username,now=()=>new Date(),expected=null,expectedSelfHash=null,manifestDir=manifestDirFromEnv(),cwd=process.cwd()}={}){
  const runDir=safeRunDir(runDirArg,{cwd});
  const m=readAuthoritativeManifest(runDir,{manifestDir});
  const want=expected?.selfHash??expectedSelfHash;
  if(want&&(m.selfHash!==want||(expected&&digest(expected)!==m.selfHash)))throw Error('MANIFEST_TAMPERED: the authoritative manifest differs from the orchestrator\'s in-memory record');
  let mirror;try{mirror=readRunManifest(runDir)}catch(error){throw Error(`MANIFEST_DISAGREES: run.json ${String(error.message)}`)}
  if(mirror.selfHash!==m.selfHash)throw Error('MANIFEST_DISAGREES: run.json in the run directory differs from the authoritative manifest');
  if(m.status!=='REVIEWED')throw Error(`RUN_NOT_REVIEWED: status is ${m.status}; only a REVIEWED run can be accepted`);
  if(!/^[0-9a-f]{64}$/.test(String(svgSha256)))throw Error('INVALID_HASH: expected 64 lowercase hex characters');
  if(svgSha256!==m.finalSvgSha256)throw Error(`HASH_MISMATCH: the reviewed final SVG is ${m.finalSvgSha256}`);
  let onDisk;try{onDisk=sha(fs.readFileSync(path.join(runDir,'candidate.svg')))}catch{throw Error('CANDIDATE_CHANGED_SINCE_REVIEW: candidate.svg unreadable')}
  if(onDisk!==m.finalSvgSha256)throw Error('CANDIDATE_CHANGED_SINCE_REVIEW: candidate.svg no longer matches the reviewed hash');
  const acceptance={authorisedBy:String(user),timestamp:now().toISOString(),sourceHash:m.sourceHash,svgSha256,acceptedFrom:'REVIEWED'};
  const sealed=writeManifests(runDir,{...body(m),status:'VALIDATED',acceptance},{manifestDir});
  return {status:'VALIDATED',runDir,svgSha256,selfHash:sealed.selfHash,acceptance,manifest:sealed,manifestPath:authoritativeManifestPath(runDir,{manifestDir})};
}
