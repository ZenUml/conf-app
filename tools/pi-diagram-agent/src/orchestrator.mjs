// v2 orchestrator: deterministic run state around one persistent author session. It never chooses layout or judges aesthetics.
// diagram_submit -> read final bytes -> render them itself -> audit + early checks -> (audit clean) independent reviewer -> deterministic gate.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {parseMermaid} from './parser.mjs';
import {renderAgentSvg} from './agent-render.mjs';
import {auditAgentSvg} from './agent-audit.mjs';
import {ensureOriginal} from './agent-led.mjs';
import {makeFinding,createLedger,selectForAuthor,formatForAuthor,auditToFindings} from './findings.mjs';
import {scanForbidden,earlyFindings,regionSignature,applyCoverage,applyStability,EARLY_AUDIT_RULES,EARLY_MEASURED_RULES} from './early-checks.mjs';
import {collectGeometry,geometryFindings,geometryForReviewer,geometryNotCheckable} from './geometry.mjs';
import {buildReviewerFacts,buildReviewerPrompt,runReviewer,selectReviewImages,reviewerConfigFromEnv} from './reviewer.mjs';
import {auditGateReasons,evaluateGate} from './gate.mjs';
import {writeManifests,authoritativeManifestPath,manifestDirFromEnv} from './manifest.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const HARD_FORBIDDEN=['script','foreignObject','iframe','image','href','event-handler']; // these make the renderer/auditor refuse the SVG, so it is never rendered

export const DEFAULT_BUDGETS=Object.freeze({maxRounds:4,maxWallMs:25*60_000,maxInspectionsPerRound:3,maxBlockingPerRound:5,stagnationRounds:2});

export function budgetsFromEnv(env=process.env){
  const b={...DEFAULT_BUDGETS};
  const n=(k,min=1)=>{const v=Number(env[k]);return Number.isFinite(v)&&v>=min?v:null};
  const wall=Number(env.PI_DIAGRAM_MAX_WALL_MIN);
  if(n('PI_DIAGRAM_MAX_ROUNDS'))b.maxRounds=n('PI_DIAGRAM_MAX_ROUNDS');
  if(Number.isFinite(wall)&&wall>0)b.maxWallMs=wall*60_000;
  return b;
}

const exactUtf8=bytes=>{
  let value;try{value=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}catch{return null}
  return Buffer.from(value,'utf8').equals(bytes)?value:null;
};

function defaultDeps(job){
  return {
    render:bytes=>renderAgentSvg(bytes,{outPrefix:path.join(job.runDir,'orch'),displayWidth:1200,displayHeight:710}),
    audit:(bytes,{originalSvg})=>auditAgentSvg(job.sourceBytes,bytes,{originalSvg,adjudications:job.manifest?job.manifest.adjudication?.records??[]:job.adjudications??[]}),
    original:()=>ensureOriginal(job),
    geometry:bytes=>collectGeometry(bytes),
    image:rec=>{
      const file=rec.path??path.join(job.runDir,rec.file),bytes=fs.readFileSync(file);
      if(sha(bytes)!==rec.sha256)throw Error('IMAGE_HASH_CHANGED');
      if(bytes.length>8_000_000)throw Error('IMAGE_TOO_LARGE');
      return {type:'image',data:bytes.toString('base64'),mimeType:'image/png'};
    },
  };
}

const addUsage=(a,b)=>{const out={...a};for(const [k,v] of Object.entries(b??{}))if(typeof v==='number')out[k]=(out[k]??0)+v;return out};
const pair=s=>[s.auditBlocking,s.reviewBlocking];
const cmpPair=(a,b)=>{const x=pair(a),y=pair(b);return x[0]-y[0]||x[1]-y[1]};
const cmpTriple=(a,b)=>cmpPair(a,b)||a.minor-b.minor;

/** @param job result of prepareAgentTask  @param opts {deps, reviewerFactory, budgets, now, onRoundEnd} */
export function createV2Run(job,{deps=null,reviewerFactory,budgets=null,reviewer=null,now=Date.now,onRoundEnd=null,manifestDir=manifestDirFromEnv()}={}){
  const reviewerCfg=reviewer??reviewerConfigFromEnv();
  const d={...defaultDeps(job),...(deps??{})};
  const B={...DEFAULT_BUDGETS,...(budgets??{})};
  let model=null;try{model=parseMermaid(Buffer.from(job.sourceBytes).toString('utf8'))}catch{}
  const ledger=createLedger();
  const startedAt=now();
  const timings={authorMs:0,reviewerMs:0,orchestratorMs:0};
  const tokens={author:{},reviewer:{}};
  const rounds=[];
  let lastReview=null,round=0,authorMark=startedAt,base=null,best=null,stagnant=0,finalResult=null,status='RUNNING',statusReason=null,finalDetail=null,oscillationsInReverted=0,lastManifest=null,extraResidual=[],reverts=0;

  const timed=async(fn)=>{const s=now();try{return await fn()}finally{timings.orchestratorMs+=now()-s}};

  function readCandidate(){
    const item=fs.lstatSync(job.outputPath,{throwIfNoEntry:false});
    if(!item?.isFile()||item.isSymbolicLink()||item.size===0||item.size>2_000_000)return {ok:false,error:'candidate.svg is missing, empty, over 2 MB, or not a regular file'};
    const bytes=fs.readFileSync(job.outputPath),text=exactUtf8(bytes);
    if(text===null)return {ok:false,error:'candidate.svg is not exact UTF-8'};
    return {ok:true,bytes,text,hash:sha(bytes)};
  }
  function restore(bytes){
    const temp=path.join(job.runDir,`.restore.${randomUUID()}.tmp`);
    try{fs.writeFileSync(temp,bytes,{flag:'wx',mode:0o600});fs.renameSync(temp,job.outputPath)}finally{fs.rmSync(temp,{force:true})}
  }
  const gateFinding=r=>makeFinding({source:'early',severity:'blocking',rule:`gate-${r.code}`,elements:['gate'],evidence:{measured:r.detail,threshold:'deterministic gate condition'},
    suggestion:r.code==='SEMANTICS_NOT_ESTABLISHED'?'Make the original visible group membership and node/relation bindings checkable (data-node, data-source/data-target, group ids), or ask the user to adjudicate a membership conflict.':
      r.code==='HASH_MISMATCH'?'The candidate changed while it was being reviewed; do not edit candidate.svg while diagram_submit is running. Submit again.':'Resolve the named gate condition and submit again.'});

  // A candidate the reviewer did not (successfully) review inherits the open reviewer blocking findings: absence of a review is not absence of defects.
  function carryReview(c){
    if(c.sources.includes('review')||!c.bytes)return;
    c.carried=ledger.openBlocking().filter(e=>e.finding.source==='review').map(e=>({...e.finding,carried:true}));
  }
  function summarise(c){
    const blocking=c.findings.filter(f=>f.severity==='blocking');
    return {auditBlocking:blocking.filter(f=>f.source!=='review').length,reviewBlocking:blocking.filter(f=>f.source==='review').length+(c.carried?.length??0),minor:c.findings.length-blocking.length};
  }

  async function evaluate(cand,{allowReview=true}={}){
    const c={round,hash:cand.ok?cand.hash:null,bytes:cand.ok?cand.bytes:null,text:cand.ok?cand.text:null,findings:[],audit:null,render:null,review:null,gate:null,stage:'missing',forbidden:[],sources:['early','audit'],notes:[]};
    if(!cand.ok){c.findings=[makeFinding({source:'early',severity:'blocking',rule:'candidate-missing',elements:['candidate.svg'],evidence:{measured:cand.error,threshold:'a readable regular candidate.svg (<= 2 MB, exact UTF-8)'},suggestion:`Write the SVG to ${job.outputPath} and submit again.`})];return c}
    c.forbidden=scanForbidden(cand.text);
    if(c.forbidden.some(h=>HARD_FORBIDDEN.includes(h.construct))){c.stage='early';c.findings=earlyFindings({svgText:cand.text,audit:null});return c}
    try{
      const original=await d.original();
      c.render=await timed(()=>d.render(cand.bytes));
      c.audit=await timed(()=>d.audit(cand.bytes,{originalSvg:original.svgBytes}));
    }catch(error){
      c.stage='early';c.findings=[makeFinding({source:'early',severity:'blocking',rule:'render-or-audit-failed',elements:['candidate.svg'],evidence:{measured:String(error?.message??error).slice(0,300),threshold:'candidate renders and audits without error'},suggestion:'Fix the SVG so it renders in Chromium (valid XML, viewBox or width/height, no unsupported constructs) and submit again.'})];
      return c;
    }
    c.stage='audit';
    c.findings=[...earlyFindings({svgText:cand.text,audit:c.audit}),...auditToFindings(c.audit).filter(f=>!EARLY_AUDIT_RULES.includes(f.rule)&&!EARLY_MEASURED_RULES.includes(f.rule))];
    if(model&&!c.findings.some(f=>f.severity==='blocking')){
      // Measured geometry: deterministic label-detachment and route-clearance checks, and the coordinates the reviewer is given.
      try{
        const geo=await timed(()=>d.geometry(cand.bytes));
        if(geo){c.geometry=geo;c.findings.push(...geometryFindings(geo,model))}else c.notes.push('GEOMETRY_UNAVAILABLE');
      }catch(error){c.notes.push(`GEOMETRY_UNAVAILABLE: ${String(error?.message??error).slice(0,120)}`)}
    }
    if(c.findings.some(f=>f.severity==='blocking'))return c;
    if(!model){c.notes.push('SOURCE_NOT_PARSEABLE');return c}
    const reasons=auditGateReasons({audit:c.audit,forbidden:c.forbidden});
    if(reasons.length){c.findings.push(...reasons.map(gateFinding));return c}
    if(!allowReview)return c;
    // Independent review: images + audit summary + parser facts only.
    const original=await d.original();
    const selected=selectReviewImages({originalFull:original.rendered.media.full,render:c.render,regions:ledger.open().map(e=>e.finding.region).filter(Boolean),mode:reviewerCfg.images});
    const images=selected.map(x=>d.image(x.record));
    const prompt=buildReviewerPrompt({facts:buildReviewerFacts(model),audit:c.audit,geometry:c.geometry?geometryForReviewer(c.geometry,model):{unavailable:true},imageLabels:selected.map(x=>x.label)});
    const review=await runReviewer({factory:reviewerFactory,prompt,images,model,natural:c.render.natural,now});
    timings.reviewerMs+=review.ms;tokens.reviewer=addUsage(tokens.reviewer,review.usage);
    c.review={...review,imageCount:images.length};
    if(!review.ok){c.stage='reviewer-error';extraResidual.push({rule:'REVIEWER_ERROR',severity:'blocking',source:'review',detail:review.error});return c}
    c.stage='review';c.sources.push('review'); // only a review that actually ran may mark earlier review findings fixed
    const covered=applyCoverage(review.findings,{audit:c.audit,svgText:cand.text,model});
    c.findings.push(...applyStability(covered,{previous:lastReview,svgText:cand.text}));
    c.reviewSnapshot={keys:new Set(review.findings.map(f=>f.key)),svgText:cand.text}; // becomes the stability baseline only if this round is kept
    return c;
  }

  // Audit NOT-CHECKABLE checks plus the measured-geometry checks (25-unit label gap, 12-unit clearance) that could not run for this candidate.
  const notCheckable=c=>{
    const audit=c?.audit,out=audit?.checks?Object.entries(audit.checks).filter(([,v])=>v?.status==='NOT-CHECKABLE').map(([k])=>k):[];
    return c&&model?[...out,...geometryNotCheckable(c.geometry??null,model)]:out;
  };
  const brief=f=>({key:f.key,id:f.id,rule:f.rule,source:f.source,severity:f.severity,elements:f.elements,region:f.region,evidence:f.evidence,suggestion:f.suggestion,...(f.downgraded?{downgraded:f.downgraded}:{}),...(f.unstable?{unstable:true,unstableReason:f.unstable.reason}:{})});

  function roundRecord(c,score,extra={}){
    return {round:c.round,svgHash:c.hash,renderedHash:c.render?.svgHash??null,stage:c.stage,reverted:false,
      audit:c.audit?{status:c.audit.status,failedChecks:Object.entries(c.audit.checks??{}).filter(([,v])=>v?.status==='FAIL').map(([k])=>k)}:null,
      review:c.review?{ok:c.review.ok,verdict:c.review.verdict??null,imageCount:c.review.imageCount??null,attempts:c.review.attempts,ms:c.review.ms,usage:c.review.usage,error:c.review.error??null,modelId:c.review.modelId??null,findings:(c.review.findings??[]).map(brief)}:null,
      findings:c.findings.map(brief),gate:c.gate,counts:score,...extra};
  }

  function buildManifest(){
    const bestC=best;
    const finalMedia=bestC?.render?{full:bestC.render.full?.sha256??null,fit:bestC.render.fullscreen?.sha256??null}:null;
    const ledgerSnap=ledger.snapshot();
    const residual=[...(bestC?.findings??[]).map(brief),...(bestC?.carried??[]).map(f=>({...brief(f),carried:true})),...extraResidual];
    return {schema:'pi-diagram-run/2',v2:true,status,statusReason,
      startedAt:new Date(startedAt).toISOString(),finishedAt:new Date(now()).toISOString(),
      sourceHash:job.sourceHash,rulesHash:job.rulesHash,rulesHistory:job.manifest?.rulesHistory??[],
      adjudication:job.manifest?.adjudication?{sha256:job.manifest.adjudication.sha256,records:job.manifest.adjudication.records?.length??0}:null,
      finalSvgSha256:bestC?.hash??null,finalMedia,originalSvgHash:bestC?.audit?.originalSvgHash??null,
      rounds,ledger:ledgerSnap,residual,notCheckable:notCheckable(bestC),
      timings:{...timings,totalMs:now()-startedAt},tokens,budgets:{...B},reviewer:{...reviewerCfg},
      metrics:{rounds:rounds.length,gateStatus:status,authorSeconds:timings.authorMs/1000,reviewerSeconds:timings.reviewerMs/1000,
        authorTokens:{input:tokens.author.input??0,output:tokens.author.output??0},reviewerTokens:{input:tokens.reviewer.input??0,output:tokens.reviewer.output??0},
        falseBlockCandidates:ledgerSnap.filter(e=>e.falseBlockCandidate).length,unstableFindings:ledgerSnap.filter(e=>e.unstable).length,oscillations:ledgerSnap.reduce((n,e)=>n+e.oscillations,0)+oscillationsInReverted,reverts},
      acceptance:null};
  }
  // Authoritative copy outside the run directory first, then the run.json mirror; lastManifest is the in-memory record /magic-accept compares against.
  function persist(){lastManifest=writeManifests(job.runDir,buildManifest(),{manifestDir});return lastManifest}
  const manifestPath=authoritativeManifestPath(job.runDir,{manifestDir});

  function finalize(newStatus,reason,{restoreBest=true}={}){
    status=newStatus;statusReason=reason;
    if(newStatus==='CANDIDATE'&&best?.bytes&&restoreBest){
      const cur=readCandidate();
      if(!cur.ok||cur.hash!==best.hash)restore(best.bytes);
    }
    persist();
    const m=lastManifest;
    const residual=m.residual.slice(0,10);
    const text=newStatus==='REVIEWED'
      ?`REVIEWED: passed the deterministic gate (reviewed, rendered and final SVG hashes are identical). This is not validation: rules ${m.notCheckable.join(', ')||'(none)'} are NOT-CHECKABLE and only a human can accept the result (/magic-accept ${job.runDir} ${m.finalSvgSha256}). Stop and report: candidate path, hash ${m.finalSvgSha256}, status REVIEWED, the NOT-CHECKABLE rules, and any minor residual findings. Do not edit candidate.svg again.`
      :`CANDIDATE: did not pass the gate (${reason}). The best candidate (fewest blocking, then fewest minor findings) is restored at ${job.outputPath}, hash ${m.finalSvgSha256}. Stop and report: candidate path, hash, status CANDIDATE, and the residual findings below. Do not claim it is reviewed or validated.`;
    finalDetail={status:newStatus,statusReason:reason,round,svgHash:m.finalSvgSha256,candidatePath:job.outputPath,residual,notCheckable:m.notCheckable,runManifest:manifestPath,message:text,
      findings:newStatus==='CANDIDATE'?formatForAuthor(selectForAuthor(ledger,{max:B.maxBlockingPerRound})).findings:[]};
    finalResult={content:[{type:'text',text:JSON.stringify(finalDetail)}],details:finalDetail};
    return finalResult;
  }

  const reply=(body)=>({content:[{type:'text',text:JSON.stringify(body)}],details:body});

  // One operation at a time: a finalisation requested while a submit is running (agent_end, wall-clock watchdog) waits for it.
  let queue=Promise.resolve();
  const serial=fn=>{const p=queue.then(fn,fn);queue=p.then(()=>{},()=>{});return p};
  const submit=()=>serial(submitNow);

  async function submitNow(){
    if(finalResult)return finalResult;
    const begin=now();timings.authorMs+=begin-authorMark;
    round++;
    const wallExceeded=begin-startedAt>B.maxWallMs;
    const cand=readCandidate();
    const c=await evaluate(cand,{allowReview:!wallExceeded});
    let reasonOverride=null;
    if(c.stage==='review'&&!c.findings.some(f=>f.severity==='blocking')){
      const finalRead=readCandidate();
      c.gate=evaluateGate({reviewedHash:c.render.svgHash,finalHash:finalRead.ok?finalRead.hash:null,renderedHash:c.hash,audit:c.audit,forbidden:c.forbidden,review:c.review,openBlocking:0});
      if(!c.gate.pass)c.findings.push(...c.gate.reasons.map(gateFinding));
    }
    carryReview(c);
    const score=summarise(c);
    let reverted=false;
    if(base&&(!c.bytes||cmpPair(score,base.score)>0)){
      reverted=true;reverts++;
      for(const f of c.findings)if(ledger.get(f.key)?.state==='fixed')oscillationsInReverted++;
      restore(base.bytes);
      rounds.push(roundRecord(c,score,{reverted:true,revertedTo:base.hash}));
      stagnant++;
    }else{
      const svgText=c.text;
      ledger.update(round,c.findings,{sources:c.sources,sigOf:svgText?f=>regionSignature(svgText,f):null});
      c.score=score;base=c;
      if(c.reviewSnapshot)lastReview=c.reviewSnapshot;
      const improved=!best||cmpPair(score,best.score)<0;
      if(c.bytes&&(!best||cmpTriple(score,best.score)<=0))best={...c,score};
      stagnant=improved?0:stagnant+1;
      rounds.push(roundRecord(c,score));
    }
    // Late defensive check: a pass must also leave no open blocking finding in the ledger.
    if(!reverted&&c.gate?.pass&&ledger.openBlocking().length>0)c.gate={pass:false,reasons:[{code:'OPEN_BLOCKING',detail:`${ledger.openBlocking().length} open blocking finding(s) in the ledger`}]};
    let result;
    if(!reverted&&c.gate?.pass)result=finalize('REVIEWED',null);
    else if(c.stage==='reviewer-error')result=finalize('CANDIDATE','REVIEWER_ERROR: '+c.review.error);
    else if(c.notes.includes('SOURCE_NOT_PARSEABLE'))result=finalize('CANDIDATE','SOURCE_NOT_PARSEABLE: semantics cannot be established by the auditor');
    else if(wallExceeded||now()-startedAt>B.maxWallMs)result=finalize('CANDIDATE',`WALL_CLOCK: exceeded ${Math.round(B.maxWallMs/1000)} s`);
    else if(round>=B.maxRounds)result=finalize('CANDIDATE',`ROUNDS_EXHAUSTED: ${B.maxRounds} submit rounds used`);
    else if(stagnant>=B.stagnationRounds)result=finalize('CANDIDATE',`NO_PROGRESS: blocking findings did not decrease for ${B.stagnationRounds} rounds`);
    else{
      persist();
      const sel=formatForAuthor(selectForAuthor(ledger,{max:B.maxBlockingPerRound}));
      const body={status:'REVISE',round,maxRounds:B.maxRounds,svgHash:reverted?base.hash:c.hash,...(reverted?{reverted:true,revertedTo:base.hash,discarded:{auditBlocking:score.auditBlocking,reviewBlocking:score.reviewBlocking,note:'your last edit increased blocking findings; candidate.svg was restored to the previous best bytes. Fix the findings below on top of that version.'}}:{}),
        findings:sel.findings,omittedBlocking:sel.omittedBlocking,minorCount:sel.minorCount,
        next:`Fix these findings (at most ${B.maxInspectionsPerRound} self-inspections with diagram_inspect this round), then call diagram_submit again. You have ${B.maxRounds-round} submit round(s) left.`};
      result=reply(body);
    }
    authorMark=now();
    onRoundEnd?.(round);
    return result;
  }

  async function finalizeNow(kind){
    if(finalResult)return finalResult;
    timings.authorMs+=now()-authorMark;authorMark=now();
    const wall=kind==='wall'?`WALL_CLOCK: exceeded ${Math.round(B.maxWallMs/1000)} s while the author was still working; `:'';
    if(!best){
      round++;
      const c=await evaluate(readCandidate(),{allowReview:false});
      carryReview(c);c.score=summarise(c);
      ledger.update(round,c.findings,{sources:c.sources});
      if(c.bytes)best={...c};
      rounds.push(roundRecord(c,c.score));
      return finalize('CANDIDATE',wall?`${wall}the final bytes were audited but not reviewed`:'AUTHOR_DID_NOT_SUBMIT: the author ended without calling diagram_submit; the final bytes were audited but not reviewed');
    }
    return finalize('CANDIDATE',wall?`${wall}the best submitted candidate is returned`:'AUTHOR_STOPPED_AFTER_FEEDBACK: the author ended without a further diagram_submit; the best submitted candidate is returned');
  }
  const finalizeWithoutSubmit=()=>serial(()=>finalizeNow('ended'));
  /** Watchdog: the author's turn ran past the wall-clock budget without a final status (a hung or endless author). */
  const expireWallClock=()=>serial(()=>finalizeNow('wall'));
  const wallExceeded=()=>now()-startedAt>B.maxWallMs;

  persist(); // status RUNNING, before the first author turn

  return {
    submit,finalizeWithoutSubmit,expireWallClock,wallExceeded,manifest:()=>lastManifest,manifestPath,
    addAuthorUsage:u=>{tokens.author=addUsage(tokens.author,u)},
    state:()=>({status,statusReason,round,rounds,ledger:ledger.snapshot(),oscillationsInReverted,best:best?{hash:best.hash,score:best.score}:null,manifest:lastManifest}),
    manifestSelfHash:()=>lastManifest?.selfHash??null,
    isFinal:()=>finalResult!==null,
    budgets:B,
  };
}
