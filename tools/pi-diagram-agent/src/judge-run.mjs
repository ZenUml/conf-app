// Judge IO wrapper: load a run, render the two drawings, call the judge, write a sealed judgement.json bound to the candidate hash,
// and gate /magic-accept on it. The model sees only four images per pass; nothing else leaves this machine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {randomUUID} from 'node:crypto';
import {renderAgentSvg} from './agent-render.mjs';
import {readAuthoritativeManifest,readRunManifest,verifyManifest,sealManifest,assertFinalLayoutIntent,acceptRun,safeRunDir,manifestDirFromEnv} from './manifest.mjs';
import {scoreJudgement,buildJudgement,judgeThresholdsFromEnv,judgeTimeoutFromEnv,runCoach,weakestDimensions} from './judge.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const MAX_SVG=2_000_000;

export const hasGroupsFromOriginalSvg=bytes=>/class="[^"]*\bcluster\b[^"]*"/.test(Buffer.from(bytes).toString('utf8'));

/** The original Mermaid render in a run directory, found by its manifest hash (the run directory is author-writable: a file that does not hash to the recorded value is ignored). */
export function findOriginalSvg(runDir,originalSvgHash){
  if(!/^[0-9a-f]{64}$/.test(String(originalSvgHash??'')))return null;
  for(const name of fs.readdirSync(runDir)){
    if(!name.endsWith('.svg')||name==='candidate.svg')continue;
    const file=path.join(runDir,name),st=fs.lstatSync(file);
    if(!st.isFile()||st.isSymbolicLink()||st.size===0||st.size>MAX_SVG)continue;
    const bytes=fs.readFileSync(file);
    if(sha(bytes)===originalSvgHash)return {file,bytes};
  }
  return null;
}

const imageBlock=file=>({type:'image',data:fs.readFileSync(file.path).toString('base64'),mimeType:'image/png'});

/** Render both drawings (full and 1200x710 page-width fit) into a private temp dir and build the two image orders. The temp dir is removed afterwards. */
async function renderPair({candidate,baseline,render=renderAgentSvg}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-judge-render-'));
  try{
    const [c,b]=[await render(candidate,{outPrefix:path.join(dir,'cand')}),await render(baseline,{outPrefix:path.join(dir,'base')})];
    const C=[imageBlock(c.full),imageBlock(c.fullscreen)],B=[imageBlock(b.full),imageBlock(b.fullscreen)];
    return {originalFirst:[...B,...C],candidateFirst:[...C,...B]};
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
}

/** Judge two SVG byte strings. Pure of run state: no judgement.json is written. `baseline` is the original render, or an older version's final SVG for mode vs-old.
 *  Returns the judgement record plus `wallMs` and the rendered `imageSets`, which are not part of the record (callers strip them before sealing or writing). */
export async function judgeSvgs({candidate,baseline,hasGroups,factory,render,model,mode='original',thresholds=judgeThresholdsFromEnv(),timeoutMs=judgeTimeoutFromEnv(),now=()=>new Date(),inLoop=false}){
  for(const b of [candidate,baseline])if(!Buffer.isBuffer(b)||!b.length||b.length>MAX_SVG)throw Error('INVALID_SVG_BYTES');
  const imageSets=await renderPair({candidate,baseline,render});
  const started=Date.now();
  const r=await scoreJudgement({factory,imageSets,hasGroups,thresholds,timeoutMs,now});
  const extra=inLoop?{inLoop:true,passMeans:r.passMeans??null}:{};
  const j=buildJudgement({candidateSha256:sha(candidate),originalSha256:sha(baseline),mode,model,passes:r.passes,merged:r.merged,thresholds:r.thresholds,verdict:r.verdict,verdictReason:r.verdictReason,extra,now});
  return {...j,wallMs:Date.now()-started,imageSets};
}

export const COACHING_SCHEMA='pi-diagram-coach/1';
/** Coach a NOT_IMPROVED judgement: one short call that is told which drawing is the candidate (the scoring passes stay blind). Reuses the images the Judge rendered.
 *  Returns a sealed record bound to the judgement it explains; it never changes that judgement. A failed call is recorded with ok:false and no improvements. */
export async function coachSvgs({judgement,imageSets,hasGroups,factory,model,timeoutMs=judgeTimeoutFromEnv(),now=()=>new Date()}){
  if(judgement?.verdict!=='NOT_IMPROVED')throw Error(`COACH_NEEDS_NOT_IMPROVED: got ${judgement?.verdict}`);
  const coach=await runCoach({factory,images:imageSets.originalFirst,hasGroups,weak:weakestDimensions(judgement.merged),timeoutMs});
  return sealManifest({schema:COACHING_SCHEMA,judgementSelfHash:judgement.selfHash,candidateSha256:judgement.candidateSha256,model,
    ok:coach.ok,attempts:coach.attempts,ms:coach.ms,usage:coach.usage,improvements:coach.improvements,...(coach.ok?{}:{error:String(coach.error).slice(0,200)}),createdAt:now().toISOString()});
}

function loadFinal(runDir,{manifestDir}){
  let m;
  try{m=readAuthoritativeManifest(runDir,{manifestDir})}catch(e){try{m=readRunManifest(runDir)}catch{throw e}}
  assertFinalLayoutIntent(m);
  const file=path.join(runDir,'candidate.svg'),st=fs.lstatSync(file,{throwIfNoEntry:false});
  if(!st?.isFile()||st.isSymbolicLink()||!st.size||st.size>MAX_SVG)throw Error('CANDIDATE_UNAVAILABLE: candidate.svg is missing or unsafe');
  const bytes=fs.readFileSync(file);
  if(!m.finalSvgSha256)throw Error('RUN_HAS_NO_FINAL_SVG');
  if(sha(bytes)!==m.finalSvgSha256)throw Error('CANDIDATE_CHANGED_SINCE_REVIEW: candidate.svg no longer matches the run manifest');
  return {manifest:m,bytes};
}

function writeSealed(runDir,name,record){
  const file=path.join(runDir,`${name}.json`),temp=path.join(runDir,`.${name}.${randomUUID()}.tmp`);
  try{fs.writeFileSync(temp,JSON.stringify(record,null,2),{flag:'wx',mode:0o600});fs.renameSync(temp,file)}finally{fs.rmSync(temp,{force:true})}
  return file;
}
export const writeJudgement=(runDir,judgement)=>writeSealed(runDir,'judgement',judgement);
export const writeCoaching=(runDir,coaching)=>writeSealed(runDir,'coach',coaching);
export const removeCoaching=runDir=>fs.rmSync(path.join(runDir,'coach.json'),{force:true});

/** /magic-judge: judge a finished run's final SVG against its original Mermaid render (or, with vsOld, against another run's final SVG) and write judgement.json. A JUDGE_ERROR is recorded, not thrown. */
export async function judgeRunDir(runDirArg,{vsOld=null,factory,render,model,thresholds,timeoutMs,now,manifestDir=manifestDirFromEnv(),cwd=process.cwd(),sourceText=null}={}){
  const runDir=safeRunDir(runDirArg,{cwd});
  const {manifest,bytes:candidate}=loadFinal(runDir,{manifestDir});
  const original=findOriginalSvg(runDir,manifest.originalSvgHash);
  if(!original)throw Error('ORIGINAL_RENDER_UNAVAILABLE: no SVG in the run directory hashes to the manifest originalSvgHash');
  let baseline=original.bytes,mode='original';
  if(vsOld){
    const oldDir=safeRunDir(vsOld,{cwd});
    baseline=loadFinal(oldDir,{manifestDir}).bytes;mode='vs-old';
  }
  const hasGroups=hasGroupsFromOriginalSvg(original.bytes);
  const j=await judgeSvgs({candidate,baseline,hasGroups,factory,render,model,mode,thresholds,timeoutMs,now});
  const {wallMs,imageSets:_images,...rawRecord}=j;
  const record=manifest.layoutIntentRequired?sealManifest({...rawRecord,layoutIntentHash:assertFinalLayoutIntent(manifest)}):rawRecord;
  writeJudgement(runDir,record);
  return {...record,wallMs};
}

/** Throws unless the run's judgement.json is present, untampered, bound to `svgSha256` and says IMPROVED. Returns the judgement. */
export function verifyJudgement(runDir,svgSha256,{layoutIntentHash=null}={}){
  const file=path.join(runDir,'judgement.json'),st=fs.lstatSync(file,{throwIfNoEntry:false});
  if(!st)throw Error('JUDGEMENT_MISSING: run /magic-judge on this run first (or accept with --override-judge "<reason>")');
  let j;try{if(!st.isFile()||st.isSymbolicLink())throw 0;j=JSON.parse(fs.readFileSync(file,'utf8'))}catch{throw Error('JUDGEMENT_TAMPERED: judgement.json is unreadable')}
  if(!verifyManifest(j)||j.schema!=='pi-diagram-judgement/1')throw Error('JUDGEMENT_TAMPERED: judgement.json fails its seal');
  if(j.candidateSha256!==svgSha256)throw Error(`JUDGEMENT_STALE: the judgement is for ${String(j.candidateSha256).slice(0,12)}, not ${String(svgSha256).slice(0,12)}; re-run /magic-judge`);
  if(layoutIntentHash&&j.layoutIntentHash!==layoutIntentHash)throw Error('JUDGEMENT_LAYOUT_INTENT_STALE: re-run review and Judge for the current intent');
  if(j.verdict==='JUDGE_ERROR')throw Error(`JUDGEMENT_JUDGE_ERROR: the judge failed (${j.verdictReason}); re-run /magic-judge`);
  if(j.verdict!=='IMPROVED')throw Error(`JUDGEMENT_NOT_IMPROVED: ${j.verdictReason}`);
  return j;
}

/** /magic-accept with the judge gate. A failing judgement refuses unless overrideJudge names a reason; the reason is recorded in the acceptance. */
export function acceptWithJudge(runDirArg,svgSha256,{overrideJudge=null,...opts}={}){
  if(overrideJudge!==null&&!String(overrideJudge).trim())throw Error('OVERRIDE_REASON_REQUIRED: --override-judge needs a non-empty reason');
  const reason=overrideJudge===null?null:String(overrideJudge).trim();
  return acceptRun(runDirArg,svgSha256,{...opts,beforeCommit:({runDir,manifest})=>{
    try{
      const j=verifyJudgement(runDir,svgSha256,{layoutIntentHash:assertFinalLayoutIntent(manifest)});
      return {judgement:{verdict:j.verdict,mean:j.mean,selfHash:j.selfHash,candidateSha256:j.candidateSha256,mode:j.mode}};
    }catch(error){
      if(reason===null||String(error.message).startsWith('JUDGEMENT_LAYOUT_INTENT_STALE'))throw error;
      const state=String(error.message).split(':')[0];
      return {judgeOverride:{reason,judgementState:state,detail:String(error.message).slice(0,300)}};
    }
  }});
}
