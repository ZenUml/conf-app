import {validateLayoutIntent,hashLayoutIntent} from './layout-intent.mjs';
// v2 orchestrator: deterministic run state around one persistent author session. It never chooses layout or judges aesthetics.
// diagram_submit -> read final bytes -> render them itself -> audit + early checks -> (audit clean) independent reviewer -> deterministic gate.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {parseMermaid} from './parser.mjs';
import {renderAgentSvg} from './agent-render.mjs';
import {auditAgentSvg} from './agent-audit.mjs';
import {ensureOriginal,jobPresentation,assertJobManifest} from './agent-led.mjs';
import {makeFinding,createLedger,selectForAuthor,formatForAuthor,auditToFindings,selectAdvice,toAdviceItem} from './findings.mjs';
import {gateModeFromEnv,relaxFindings} from './relaxed.mjs';
import {judgeSvgs,writeJudgement,hasGroupsFromOriginalSvg} from './judge-run.mjs';
import {buildJudgement,acceptThresholdsFromEnv} from './judge.mjs';
import {scanForbidden,earlyFindings,regionSignature,applyCoverage,applyStability,isLowerBendMinor,EARLY_AUDIT_RULES,EARLY_MEASURED_RULES} from './early-checks.mjs';
import {collectGeometry,geometryFindings,geometryForReviewer,geometryNotCheckable} from './geometry.mjs';
import {buildReviewerFacts,buildReviewerPrompt,runReviewer,selectReviewImages,reviewerConfigFromEnv} from './reviewer.mjs';
import {auditGateReasons,evaluateGate} from './gate.mjs';
import {isHardRule,WAIVABLE_RULES,validateWaivers,waivableByCode} from './escalation.mjs';
import {sealManifest,writeManifests,authoritativeManifestPath,manifestDirFromEnv} from './manifest.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const HARD_FORBIDDEN=['script','foreignObject','iframe','image','href','event-handler']; // these make the renderer/auditor refuse the SVG, so it is never rendered

// Two-phase gate: diagram_build_check (text only, binding) <= 6 calls per round (both gates; see defaultBudgetsFor) and <= 16 per run; diagram_inspect (images) stays <= 3 per round and is not a gate.
export const DEFAULT_BUDGETS=Object.freeze({maxRounds:4,maxWallMs:15*60_000,maxInspectionsPerRound:3,maxBlockingPerRound:5,stagnationRounds:2,twoPhase:true,maxChecksPerRound:6,maxChecksPerRun:16,maxGeneratorErrorsPerRound:6,maxFindingsPerCheck:8});

/** Relaxed gate: 6 checks per round (same as strict), then the next submit goes to review and the Judge (advisory findings never block). Cap 3 was tried and reverted: 14-run A/B, median 905 s vs 829 s, 14 rounds vs 11, median Judge 0.55 vs 0.60. */
export const RELAXED_MAX_CHECKS_PER_ROUND=6;
export const defaultBudgetsFor=(gate)=>gate==='strict'?{...DEFAULT_BUDGETS}:{...DEFAULT_BUDGETS,maxChecksPerRound:RELAXED_MAX_CHECKS_PER_ROUND};

export function budgetsFromEnv(env=process.env){
  const b=defaultBudgetsFor(gateModeFromEnv(env));
  const n=(k,min=1)=>{const v=Number(env[k]);return Number.isFinite(v)&&v>=min?v:null};
  const wall=Number(env.PI_DIAGRAM_MAX_WALL_MIN);
  if(n('PI_DIAGRAM_MAX_ROUNDS'))b.maxRounds=n('PI_DIAGRAM_MAX_ROUNDS');
  if(Number.isFinite(wall)&&wall>0)b.maxWallMs=wall*60_000;
  if(n('PI_DIAGRAM_MAX_CHECKS_PER_ROUND'))b.maxChecksPerRound=n('PI_DIAGRAM_MAX_CHECKS_PER_ROUND');
  if(n('PI_DIAGRAM_MAX_CHECKS_PER_RUN'))b.maxChecksPerRun=n('PI_DIAGRAM_MAX_CHECKS_PER_RUN');
  if(n('PI_DIAGRAM_MAX_GENERATOR_ERRORS_PER_ROUND'))b.maxGeneratorErrorsPerRound=n('PI_DIAGRAM_MAX_GENERATOR_ERRORS_PER_ROUND');
  if(env.PI_DIAGRAM_TWO_PHASE==='0')b.twoPhase=false; // restores the one-phase submit (audit + review inside diagram_submit) for benchmark comparability
  return b;
}

const exactUtf8=bytes=>{
  let value;try{value=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}catch{return null}
  return Buffer.from(value,'utf8').equals(bytes)?value:null;
};

function defaultDeps(job){
  return {
    render:(bytes,options)=>renderAgentSvg(bytes,{outPrefix:path.join(job.runDir,'orch'),displayWidth:1200,displayHeight:710,...options}),
    audit:(bytes,{originalSvg,presentation})=>auditAgentSvg(job.sourceBytes,bytes,{originalSvg,presentation,adjudications:job.manifest?job.manifest.adjudication?.records??[]:job.adjudications??[]}),
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
// Best candidate: fewest blocking findings, then (relaxed gate) the highest Judge mean (a judged candidate beats an unjudged one), then the fewest minor findings; ties go to the newer candidate.
const judgeMeanOf=c=>c.judgement&&c.judgement.verdict!=='JUDGE_ERROR'&&Number.isFinite(c.judgement.mean)?c.judgement.mean:-Infinity;
const betterOrEqual=(c,b)=>cmpPair(c.score,b.score)?cmpPair(c.score,b.score)<0:judgeMeanOf(c)!==judgeMeanOf(b)?judgeMeanOf(c)>judgeMeanOf(b):c.score.minor<=b.score.minor;

/** @param job result of prepareAgentTask  @param opts {deps, reviewerFactory, budgets, now, onRoundEnd} */
export function createV2Run(job,{deps=null,reviewerFactory,budgets=null,reviewer=null,now=Date.now,onRoundEnd=null,manifestDir=manifestDirFromEnv(),gate=gateModeFromEnv(),judgeFactory=null,judgeModel=null,acceptThresholds=acceptThresholdsFromEnv(),contractRequired=false}={}){
  const presentation=jobPresentation(job);
  const reviewerCfg=reviewer??reviewerConfigFromEnv();
  // Gate mode. relaxed (default): only wrong-or-unreadable defects block, everything else is advice, and the Judge decides acceptance inside the loop. strict: the previous behaviour, no Judge.
  const relaxed=gate!=='strict';
  if(relaxed&&!judgeFactory&&!deps?.judge)throw Error('JUDGE_FACTORY_REQUIRED: the relaxed gate accepts a candidate only through the Judge; pass judgeFactory, or set PI_DIAGRAM_GATE=strict');
  const d={...defaultDeps(job),...(deps??{})};
  d.judge??=({candidate,baseline,hasGroups})=>judgeSvgs({candidate,baseline,hasGroups,factory:judgeFactory,render:d.judgeRender,model:judgeModel,mode:'original',thresholds:acceptThresholds,inLoop:true});
  const B={...defaultBudgetsFor(relaxed?'relaxed':'strict'),...(budgets??{})};
  let model=null;try{model=parseMermaid(Buffer.from(job.sourceBytes).toString('utf8'))}catch{}
  let ledger=createLedger();
  const startedAt=now();
  const timings={authorMs:0,reviewerMs:0,orchestratorMs:0,checkMs:0,judgeMs:0};
  const tokens={author:{},reviewer:{},judge:{}};
  const judgeRounds=[];let judgeCalls=0;
  const rounds=[];
  let lastReview=null,round=0,authorMark=startedAt,base=null,best=null,stagnant=0,finalResult=null,status='RUNNING',statusReason=null,finalDetail=null,oscillationsInReverted=0,lastManifest=null,extraResidual=[],reverts=0;
  // Two-phase gate state. Phase 1 = diagram_build_check (binding script check, text only); phase 2 = the reviewer inside diagram_submit.
  const twoPhase=B.twoPhase!==false;
  let layoutIntent=null; const layoutIntentHistory=[],layoutIntentEvents=[];
  const requireLayoutIntent=()=>{if(contractRequired&&!layoutIntent)throw Error('LAYOUT_INTENT_REQUIRED: submit semantic plan through diagram_layout_intent before authoring')};
  const cache=new Map(); // svg sha256 -> phase-1 result (findings, audit, geometry, forbidden); identical bytes are never audited twice
  const checkLog=[],refusals=[],escalations=[],doneRounds=[];
  // Relaxed gate feedback state: blocking-finding history across the checks of the run (regression flags) and the latest check (repeat-check refusal).
  const blockingHistory=new Map(); // finding key -> {rule,present,fixedInCheck}
  let lastCheck=null; // {hash,pass}
  let lastPass=null; // relaxed: the most recent CHECK_PASS this round, {hash,seq}; diagram_inspect points the author back to it
  const modelCallTimeouts=[];
  let callsRound=0,callsTotal=0,checkSinceMark=0,exceptions=[],authorCalls=0,reviewerCalls=0,generatorErrors=0,cacheHits=0;
  const freshStats=()=>({buildCheckCalls:0,freshChecks:0,cacheHits:0,refusals:0,generatorErrors:0,limitHits:0});
  let cur=freshStats();
  const generatorCapHit=()=>cur.generatorErrors>=B.maxGeneratorErrorsPerRound;
  // Out of build_checks for this round or run, or out of generator-error allowance: submit falls back to the orchestrator's own check of the bytes.
  const exhausted=()=>callsRound>=B.maxChecksPerRound||callsTotal>=B.maxChecksPerRun||generatorCapHit();

  const timed=async(fn)=>{const s=now();try{return await fn()}finally{timings.orchestratorMs+=now()-s}};

  function readCandidate(){
    assertJobManifest(job);
    const item=fs.lstatSync(job.outputPath,{throwIfNoEntry:false});
    if(!item?.isFile()||item.isSymbolicLink()||item.size===0||item.size>2_000_000)return {ok:false,error:'candidate.svg is missing, empty, over 2 MB, or not a regular file'};
    const bytes=fs.readFileSync(job.outputPath),text=exactUtf8(bytes);
    if(text===null)return {ok:false,error:'candidate.svg is not exact UTF-8'};
    return {ok:true,bytes,text,hash:sha(bytes)};
  }
  function restore(bytes){
    if(!bytes)throw Error('RESTORE_WITHOUT_BYTES'); // callers only revert to a base that has bytes
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

  const renderOrAuditFailed=error=>[makeFinding({source:'early',severity:'blocking',rule:'render-or-audit-failed',elements:['candidate.svg'],evidence:{measured:String(error?.message??error).slice(0,300),threshold:'candidate renders and audits without error'},suggestion:'Fix the SVG so it renders in Chromium (valid XML, viewBox or width/height, no unsupported constructs) and run the check again.'})];

  /** Phase 1: every script check on exact bytes (forbidden constructs, full auditor, early and measured-geometry findings, gate reasons). No reviewer, no images.
   *  eager: run the measured geometry even when the audit already failed, so one check shows every failure (two-phase). The one-phase path keeps its original order. */
  async function scriptCheck(cand,{eager=false}={}){
    const c={layoutIntentHash:layoutIntent?.hash??null,round,hash:cand.ok?cand.hash:null,bytes:cand.ok?cand.bytes:null,text:cand.ok?cand.text:null,findings:[],audit:null,render:null,review:null,gate:null,stage:'missing',forbidden:[],sources:['early','audit'],notes:[]};
    if(!cand.ok){c.findings=[makeFinding({source:'early',severity:'blocking',rule:'candidate-missing',elements:['candidate.svg'],evidence:{measured:cand.error,threshold:'a readable regular candidate.svg (<= 2 MB, exact UTF-8)'},suggestion:`Write the SVG to ${job.outputPath} and submit again.`})];return c}
    c.forbidden=scanForbidden(cand.text);
    if(c.forbidden.some(h=>HARD_FORBIDDEN.includes(h.construct))){c.stage='early';c.findings=earlyFindings({svgText:cand.text,audit:null});return c}
    try{
      const original=await d.original();
      if(!eager)c.render=await timed(()=>d.render(cand.bytes,{presentation})); // one-phase: render before the audit, as before
      c.audit=await timed(()=>d.audit(cand.bytes,{originalSvg:original.svgBytes,presentation}));
      assertJobManifest(job);
    }catch(error){c.stage='early';c.findings=renderOrAuditFailed(error);return c}
    c.stage='audit';
    c.findings=[...earlyFindings({svgText:cand.text,audit:c.audit,relaxed}),...auditToFindings(c.audit,{relaxed}).filter(f=>!EARLY_AUDIT_RULES.includes(f.rule)&&!EARLY_MEASURED_RULES.includes(f.rule)&&!isLowerBendMinor(f))];
    if(model&&(eager||!c.findings.some(f=>f.severity==='blocking'))){
      // Measured geometry: deterministic label-detachment and route-clearance checks, and the coordinates the reviewer is given.
      try{
        const geo=await timed(()=>d.geometry(cand.bytes));
        if(geo){c.geometry=geo;c.findings.push(...geometryFindings(geo,model,{relaxed}))}else c.notes.push('GEOMETRY_UNAVAILABLE');
      }catch(error){c.notes.push(`GEOMETRY_UNAVAILABLE: ${String(error?.message??error).slice(0,120)}`)}
    }
    if(relaxed)c.findings=relaxFindings(c.findings);
    if(c.findings.some(f=>f.severity==='blocking'))return c;
    if(!model){c.notes.push('SOURCE_NOT_PARSEABLE');return c}
    const reasons=auditGateReasons({audit:c.audit,forbidden:c.forbidden,relaxed});
    if(reasons.length)c.findings.push(...reasons.map(gateFinding));
    return c;
  }

  /** A per-round copy of a cached phase-1 result: findings and notes are fresh arrays, review state is empty. */
  const fromHit=hit=>({...hit,round,findings:[...hit.findings],notes:[...hit.notes],sources:['early','audit'],review:null,gate:null,render:null});

  /** One reviewer call (normal or diagnosis). Records time, usage and the reviewer call count. */
  async function callReviewer(c,{diagnosis=null}={}){
    const original=await d.original();
    const selected=selectReviewImages({originalFull:original.rendered.media.full,render:c.render,regions:ledger.open().map(e=>e.finding.region).filter(Boolean),mode:diagnosis?'all':reviewerCfg.images});
    const images=selected.map(x=>d.image(x.record));
    const prompt=buildReviewerPrompt({facts:buildReviewerFacts(model),layoutIntent,audit:c.audit,geometry:c.geometry?geometryForReviewer(c.geometry,model):{unavailable:true},imageLabels:selected.map(x=>x.label),measured:reviewerCfg.prompt,twoPhase,diagnosis});
    const review=await runReviewer({factory:reviewerFactory,prompt,images,model,natural:c.render.natural,now,diagnosis:!!diagnosis});
    timings.reviewerMs+=review.ms;tokens.reviewer=addUsage(tokens.reviewer,review.usage);reviewerCalls+=review.attempts??1;
    if(layoutIntent&&review.findings?.some(f=>f.rule==='layout-intent'&&f.severity==='blocking'))layoutIntentEvents.push({name:'magic_layout_contract_failed',layout_intent_hash:layoutIntent.hash,layout_intent_revision:layoutIntentHistory.length,layout_contract_outcome:'rejected',layout_contract_reason:'SEMANTIC_LAYOUT_CONFLICT',round});
    c.review={...review,layoutIntentHash:layoutIntent?.hash??null,imageCount:images.length};
    return review;
  }
  const ensureRender=async c=>{
    if(c.render)return true;
    try{c.render=await timed(()=>d.render(c.bytes,{presentation}));return true}
    catch(error){c.stage='early';c.findings=renderOrAuditFailed(error);return false}
  };

  /** Phase 2: the independent reviewer on a candidate whose script checks are clean. */
  async function reviewPhase(c,{allowReview=true}={}){
    if(c.stage!=='audit'||c.findings.some(f=>f.severity==='blocking')||c.notes.includes('SOURCE_NOT_PARSEABLE')||!allowReview)return c;
    if(!(await ensureRender(c)))return c;
    const review=await callReviewer(c);
    if(!review.ok){c.stage='reviewer-error';extraResidual.push({rule:'REVIEWER_ERROR',severity:'blocking',source:'review',detail:review.error});return c}
    c.stage='review';c.sources.push('review'); // only a review that actually ran may mark earlier review findings fixed
    const covered=applyCoverage(review.findings,{audit:c.audit,svgText:c.text,model});
    c.findings.push(...applyStability(covered,{previous:lastReview,svgText:c.text}));
    if(relaxed)c.findings=relaxFindings(c.findings);
    c.reviewSnapshot={keys:new Set(review.findings.map(f=>f.key)),svgText:c.text}; // becomes the stability baseline only if this round is kept
    return c;
  }

  /** Relaxed gate acceptance: the Judge (both passes) on the exact final bytes against the original. Runs only for a candidate with no blocking finding that passed review and the hash-identity gate. */
  async function judgePhase(c){
    const t0=now();let record=null,original=null;
    try{
      original=await d.original();
      const j=await d.judge({candidate:c.bytes,baseline:original.svgBytes,hasGroups:hasGroupsFromOriginalSvg(original.svgBytes)});
      const {wallMs,...rest}=j;record=rest;
    }catch(error){
      record=buildJudgement({candidateSha256:c.hash,originalSha256:original?.svgBytes?sha(Buffer.from(original.svgBytes)):null,mode:'original',model:judgeModel,passes:[],merged:{dims:{},mean:0},thresholds:acceptThresholds,verdict:'JUDGE_ERROR',verdictReason:String(error?.message??error).slice(0,400),extra:{inLoop:true}});
    }
    timings.judgeMs+=now()-t0;
    for(const p of record.passes??[]){tokens.judge=addUsage(tokens.judge,p.usage);judgeCalls+=p.attempts??1}
    if(record.coach){tokens.judge=addUsage(tokens.judge,record.coach.usage);judgeCalls+=record.coach.attempts??1}
    record=sealManifest({...record,layoutIntentHash:layoutIntent?.hash??null});
    writeJudgement(job.runDir,record);
    c.judgement=record;
    judgeRounds.push({round,svgHash:c.hash,...judgementSummary(record)});
    if(record.verdict==='JUDGE_ERROR'){c.stage='judge-error';extraResidual.push({rule:'JUDGE_ERROR',severity:'blocking',source:'judge',detail:record.verdictReason})}
    return c;
  }

  async function evaluate(cand,{allowReview=true,hit=null}={}){
    const c=hit?fromHit(hit):await scriptCheck(cand,{eager:twoPhase});
    return reviewPhase(c,{allowReview});
  }

  /** Escalation: the last allowed build_check of the round still FAILs. Semantic and structural fails are rejected as today (no reviewer).
   *  Otherwise the reviewer diagnoses with images and the remaining findings: WAIVER (code-validated, REVIEWED_WITH_EXCEPTIONS) or RELAYOUT advice. */
  async function escalate(hit){
    const c=fromHit(hit),blocking=c.findings.filter(f=>f.severity==='blocking');
    const record=(outcome,extra={})=>{c.escalation={outcome,failed:[...new Set(blocking.map(f=>f.rule))],...extra};escalations.push({round,svgHash:c.hash,...c.escalation});return c};
    if(blocking.some(f=>isHardRule(f.rule)))return record('rejected-semantic',{hard:[...new Set(blocking.filter(f=>isHardRule(f.rule)).map(f=>f.rule))]});
    if(!(await ensureRender(c)))return c;
    const briefs=blocking.map(f=>({id:f.id,rule:f.rule,elements:f.elements,measured:f.evidence?.measured,threshold:f.evidence?.threshold,suggestion:f.suggestion,...(f.repairHints?{repairHints:f.repairHints}:{}),...(f.moveHints?{moveHints:f.moveHints}:{}),waivableByCode:waivableByCode(f,c.audit)}));
    const review=await callReviewer(c,{diagnosis:briefs});
    // A diagnosis that cannot be obtained is not a pass and does not end the run: the script findings come back as a plain rejected round.
    if(!review.ok)return record('reviewer-error',{error:review.error});
    c.stage='review';c.sources.push('review');
    const covered=applyCoverage(review.findings,{audit:c.audit,svgText:c.text,model});
    c.findings.push(...applyStability(covered,{previous:lastReview,svgText:c.text}));
    if(relaxed)c.findings=relaxFindings(c.findings);
    c.reviewSnapshot={keys:new Set(review.findings.map(f=>f.key)),svgText:c.text};
    const diag=review.diagnosis;
    if(diag.outcome==='relayout'){
      c.findings.push(makeFinding({source:'review',severity:'blocking',rule:'relayout',elements:['canvas'],evidence:{measured:diag.relayout.summary,threshold:'a layout that satisfies the script checks'},suggestion:diag.relayout.changes.map(x=>`${x.kind}: ${x.detail}`).join('; ')}));
      return record('relayout',{relayout:diag.relayout});
    }
    const {accepted,rejected}=validateWaivers(blocking,diag.waivers,c.audit);
    const reviewBlocking=c.findings.filter(f=>f.source==='review'&&f.severity==='blocking');
    if(rejected.length)return record('waiver-rejected',{waiverRejected:rejected});
    if(reviewBlocking.length)return record('waiver-blocked-by-review',{waiverRejected:[{finding:null,rule:'review',reason:`the reviewer also reported ${reviewBlocking.length} blocking visual finding(s); a waiver cannot pass a candidate with a visual defect`}]});
    // Valid waiver: the waived script findings become minor and are listed as exceptions; REVIEWED_WITH_EXCEPTIONS needs a human to accept each one.
    const waivedIds=new Set(accepted.map(a=>a.finding.id));
    c.waived=accepted.map(a=>({check:a.finding.rule,findingId:a.finding.id,elements:a.finding.elements,measured:a.finding.evidence?.measured??null,threshold:a.finding.evidence?.threshold??null,reason:a.reason,round,svgSha256:c.hash,reviewerModel:review.modelId??null}));
    c.findings=c.findings.map(f=>waivedIds.has(f.id)?{...f,severity:'minor',waived:{reason:accepted.find(a=>a.finding.id===f.id).reason}}:f);
    return record('waived',{waived:c.waived.map(w=>({check:w.check,findingId:w.findingId,elements:w.elements,reason:w.reason}))});
  }

  // Audit NOT-CHECKABLE checks plus the measured-geometry checks (25-unit label gap, 12-unit clearance) that could not run for this candidate.
  const notCheckable=c=>{
    const audit=c?.audit,out=audit?.checks?Object.entries(audit.checks).filter(([,v])=>v?.status==='NOT-CHECKABLE').map(([k])=>k):[];
    return c&&model?[...out,...geometryNotCheckable(c.geometry??null,model)]:out;
  };
  const brief=f=>({key:f.key,id:f.id,rule:f.rule,source:f.source,severity:f.severity,...(f.impact!==undefined?{impact:f.impact}:{}),elements:f.elements,region:f.region,evidence:f.evidence,suggestion:f.suggestion,...(f.repairHints?{repairHints:f.repairHints}:{}),...(f.moveHints?{moveHints:f.moveHints}:{}),...(f.downgraded?{downgraded:f.downgraded}:{}),...(f.downgradeRefused?{downgradeRefused:f.downgradeRefused}:{}),...(f.unstable?{unstable:true,unstableReason:f.unstable.reason}:{}),...(f.waived?{waived:f.waived}:{})});

  const checksWithStatus=(audit,status)=>audit?.checks?Object.entries(audit.checks??{}).filter(([,v])=>v?.status===status).map(([k])=>k):[];

  const judgementSummary=j=>({verdict:j.verdict,verdictReason:j.verdictReason,mean:j.mean,passMeans:j.passMeans??null,dimensions:Object.fromEntries(Object.entries(j.merged?.dims??{}).map(([k,v])=>[k,v?v.score:null])),improvements:j.improvements??[],candidateSha256:j.candidateSha256,selfHash:j.selfHash});
  function roundRecord(c,score,extra={}){
    const auditRecord=c.audit?{
      status:c.audit.status,
      failedChecks:checksWithStatus(c.audit,'FAIL'),
      adjudicatedChecks:checksWithStatus(c.audit,'ADJUDICATED'),
      notCheckableChecks:checksWithStatus(c.audit,'NOT-CHECKABLE')}:null;
    return {layoutIntentHash:c.layoutIntentHash,round:c.round,svgHash:c.hash,renderedHash:c.render?.svgHash??null,stage:c.stage,reverted:false,
      audit:auditRecord,
      review:c.review?{layoutIntentHash:c.review.layoutIntentHash,ok:c.review.ok,verdict:c.review.verdict??null,...(c.review.diagnosis?{diagnosis:c.review.diagnosis}:{}),imageCount:c.review.imageCount??null,attempts:c.review.attempts,ms:c.review.ms,usage:c.review.usage,error:c.review.error??null,modelId:c.review.modelId??null,findings:(c.review.findings??[]).map(brief)}:null,
      findings:c.findings.map(brief),gate:c.gate,counts:score,...(c.judgement?{judgement:judgementSummary(c.judgement)}:{}),...(c.escalation?{escalation:c.escalation}:{}),...extra};
  }

  /** Every reviewer finding the early-check policy demoted, across all rounds: finding key, covering check, evidence pointer. */
  const downgradeList=()=>rounds.flatMap(r=>(r.findings??[]).filter(f=>f.downgraded).map(f=>({round:r.round,findingKey:f.downgraded.findingKey??f.key,rule:f.rule,from:'blocking',to:'minor',check:f.downgraded.check??f.downgraded.by,evidencePointer:f.downgraded.evidencePointer??null,verified:f.downgraded.verified??null,reason:f.downgraded.reason})));

  function buildManifest(){
    const bestC=best;
    const finalMedia=bestC?.render?{full:bestC.render.full?.sha256??null,fit:bestC.render.fullscreen?.sha256??null,...(bestC.render.presentationImage?{presentation:bestC.render.presentationImage.sha256}: {}),...(bestC.render.interactive?{interactive:bestC.render.interactive.sha256}:{})}:null;
    const ledgerSnap=ledger.snapshot();
    const residual=[...(bestC?.findings??[]).map(brief),...(bestC?.carried??[]).map(f=>({...brief(f),carried:true})),...extraResidual];
    const openRound=cur.buildCheckCalls||cur.refusals||cur.limitHits||cur.generatorErrors?[{round:doneRounds.length+1,open:true,...cur}]:[];
    return {schema:'pi-diagram-run/3',v2:true,gate,...(relaxed?{judge:{enabled:true,inLoop:true,thresholds:acceptThresholds,model:judgeModel,rounds:judgeRounds}}:{}),status,statusReason,
      startedAt:new Date(startedAt).toISOString(),finishedAt:new Date(now()).toISOString(),
      layoutIntentRequired:contractRequired,layoutIntent,layoutIntentHistory,layoutIntentEvents,finalLayoutIntentHash:bestC?.layoutIntentHash??null,
      sourceHash:job.sourceHash,rulesHash:job.rulesHash,rulesHistory:job.manifest?.rulesHistory??[],presentation,
      adjudication:job.manifest?.adjudication?{sha256:job.manifest.adjudication.sha256,records:job.manifest.adjudication.records?.length??0}:null,
      finalSvgSha256:bestC?.hash??null,finalMedia,originalSvgHash:bestC?.audit?.originalSvgHash??null,
      ...(bestC?.render?.interactive?{interactive:bestC.render.interactive}:{}),
      ...(bestC?.render?.interactiveExportError?{interactiveExportError:bestC.render.interactiveExportError}:{}),
      rounds,downgrades:downgradeList(),ledger:ledgerSnap,residual,notCheckable:notCheckable(bestC),
      exceptions:status==='REVIEWED_WITH_EXCEPTIONS'||status==='VALIDATED'?exceptions:[],...(status==='REVIEWED_WITH_EXCEPTIONS'?{publishAsDefault:false}:{}),
      twoPhase:{enabled:twoPhase,caps:{perRound:B.maxChecksPerRound,perRun:B.maxChecksPerRun,generatorErrorsPerRound:B.maxGeneratorErrorsPerRound,findingsPerCheck:B.maxFindingsPerCheck},checksTotal:callsTotal,cacheHits,generatorErrors,perRound:[...doneRounds,...openRound],checks:checkLog,refusals,escalations},
      ...(modelCallTimeouts.length?{modelCallTimeouts:[...modelCallTimeouts]}:{}),
      timings:{...timings,totalMs:now()-startedAt},modelCalls:{author:authorCalls,reviewer:reviewerCalls,...(relaxed?{judge:judgeCalls}:{})},tokens,budgets:{...B},reviewer:{...reviewerCfg},
      metrics:{rounds:rounds.length,gateStatus:status,authorSeconds:timings.authorMs/1000,reviewerSeconds:timings.reviewerMs/1000,
        authorTokens:{input:tokens.author.input??0,output:tokens.author.output??0},reviewerTokens:{input:tokens.reviewer.input??0,output:tokens.reviewer.output??0},
        modelCalls:{author:authorCalls,reviewer:reviewerCalls},buildChecks:callsTotal,generatorErrors,refusals:refusals.length,escalations:escalations.length,
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
      ?`REVIEWED: passed the ${relaxed?'relaxed':'deterministic'} gate (reviewed, rendered and final SVG hashes are identical, ${relaxed?'no blocking finding':'zero script FAILs'}${relaxed&&best?.judgement?`, the Judge rated it IMPROVED over the original with mean ${Math.round(best.judgement.mean*1000)/1000}`:''}). This is not validation: rules ${m.notCheckable.join(', ')||'(none)'} are NOT-CHECKABLE and only a human can accept the result (/magic-accept ${job.runDir} ${m.finalSvgSha256}). Stop and report: candidate path, hash ${m.finalSvgSha256}, status REVIEWED, the NOT-CHECKABLE rules, and any minor residual findings. Do not edit candidate.svg again.`
      :newStatus==='REVIEWED_WITH_EXCEPTIONS'
      ?`REVIEWED_WITH_EXCEPTIONS: the reviewer's diagnosis waived ${exceptions.length} script FAIL(s) that code permits to waive (${[...new Set(exceptions.map(e=>e.check))].join(', ')}); every other script check passed and no blocking visual finding remains. Waived: ${exceptions.map(e=>`${e.check} on ${e.elements.join(', ')||'(no element ids)'} (measured ${String(e.measured).slice(0,120)}; reviewer reason: ${e.reason})`).join(' | ')}. This status is NOT published as the default Magic image. Only a human can promote it: /magic-accept ${job.runDir} ${m.finalSvgSha256} --waive ${[...new Set(exceptions.map(e=>e.check))].join(',')} (the command must name every waived check). Stop and report: candidate path, hash ${m.finalSvgSha256}, status REVIEWED_WITH_EXCEPTIONS, each waived check with its element ids, measured value and reason, the NOT-CHECKABLE rules ${m.notCheckable.join(', ')||'(none)'}. Do not edit candidate.svg again.`
      :`CANDIDATE: did not pass the gate (${reason}). The best candidate (fewest blocking${relaxed?', then highest Judge mean':''}, then fewest minor findings) is restored at ${job.outputPath}, hash ${m.finalSvgSha256}. Stop and report: candidate path, hash, status CANDIDATE, and the residual findings below. Do not claim it is reviewed or validated.`;
    finalDetail={status:newStatus,statusReason:reason,round,svgHash:m.finalSvgSha256,candidatePath:job.outputPath,residual,notCheckable:m.notCheckable,runManifest:manifestPath,message:text,downgrades:m.downgrades,...(newStatus==='REVIEWED_WITH_EXCEPTIONS'?{exceptions,publishAsDefault:false}:{}),
      ...(m.interactive?{interactivePath:m.interactive.path}:{}),...(m.interactiveExportError?{interactiveExportError:m.interactiveExportError}:{}),
      findings:newStatus==='CANDIDATE'?formatForAuthor(selectForAuthor(ledger,{max:B.maxBlockingPerRound})).findings:[]};
    finalResult={content:[{type:'text',text:JSON.stringify(finalDetail)}],details:finalDetail};
    return finalResult;
  }

  const reply=(body)=>({content:[{type:'text',text:JSON.stringify(body)}],details:body});

  // One operation at a time: a finalisation requested while a submit is running (agent_end, wall-clock watchdog) waits for it.
  let queue=Promise.resolve();
  const serial=fn=>{const p=queue.then(fn,fn);queue=p.then(()=>{},()=>{});return p};
  const submit=opts=>serial(()=>submitNow(opts??{}));

  // ---- phase 1: diagram_build_check ------------------------------------------------------------
  const failedRules=c=>[...new Set(c.findings.filter(f=>f.severity==='blocking').map(f=>f.rule))];
  const advisoryRules=c=>[...new Set(c.findings.filter(f=>f.severity!=='blocking').map(f=>f.rule))];
  const left=()=>({generatorErrorsThisRound:cur.generatorErrors,generatorErrorsLeftThisRound:Math.max(0,B.maxGeneratorErrorsPerRound-cur.generatorErrors),checksUsedThisRound:callsRound,checksLeftThisRound:Math.max(0,B.maxChecksPerRound-callsRound),checksUsedThisRun:callsTotal,checksLeftThisRun:Math.max(0,B.maxChecksPerRun-callsTotal)});
  const checkStatuses=c=>{
    const out=Object.fromEntries(Object.entries(c.audit?.checks??{}).map(([k,v])=>[k,v?.status]));
    for(const f of c.findings)if(f.severity==='blocking')out[f.rule]='FAIL';
    return out;
  };
  // Relaxed CHECK_PASS: no blocking finding exists, so any audit FAIL left in the map is advisory-only; it is shown as ADVISORY so it does not read as work to do.
  const advisoryStatuses=m=>Object.fromEntries(Object.entries(m).map(([k,v])=>[k,v==='FAIL'?'ADVISORY':v]));
  // Relaxed gate: advance the blocking-finding history by one check. Returns the findings fixed earlier and broken again, with the check that fixed them.
  function trackBlocking(c,seq){
    const cur_=new Map(c.findings.filter(f=>f.severity==='blocking').map(f=>[f.key,f]));
    const regressed=new Map();
    for(const [key,h] of blockingHistory)if(h.present&&!cur_.has(key)){h.present=false;h.fixedInCheck=seq}
    for(const [key,f] of cur_){
      const h=blockingHistory.get(key);
      if(!h)blockingHistory.set(key,{rule:f.rule,present:true,fixedInCheck:null});
      else if(!h.present){if(h.fixedInCheck!==null)regressed.set(key,h.fixedInCheck);h.present=true;h.fixedInCheck=null}
    }
    return regressed;
  }
  // With many blocking findings the list stays complete; the evidence text is compressed instead.
  const COMPACT_ABOVE=8;
  const clipText=(v,n)=>typeof v==='string'&&v.length>n?v.slice(0,n-1)+'…':v;
  const compactFinding=f=>({...f,evidence:{...f.evidence,measured:clipText(f.evidence?.measured,200),threshold:clipText(f.evidence?.threshold,80)},suggestion:clipText(String(f.suggestion),240)});
  const submitNowText=h=>`No blocking findings. Submit now with diagram_submit (svgHash ${h}). Do not spend more checks on advisory items.`;
  function checkReply(c,{cached,source=null,buildNote=null,seq=null}){
    const blocking=c.findings.filter(f=>f.severity==='blocking');
    const minors=c.findings.filter(f=>f.severity!=='blocking').sort((a,b)=>(b.impact??0)-(a.impact??0));
    const l=left(),fail=blocking.length>0;
    const last=l.checksLeftThisRound===0||l.checksLeftThisRun===0;
    let sel,regressions=null;
    if(relaxed){
      const regressed=seq===null?new Map():trackBlocking(c,seq);
      const ordered=[...blocking.filter(f=>regressed.has(f.key)),...blocking.filter(f=>!regressed.has(f.key))];
      const shown=ordered.length>COMPACT_ABOVE?ordered.map(compactFinding):ordered;
      sel=formatForAuthor({sent:shown.map(f=>({...f,state:regressed.has(f.key)?'regressed':'open'})),omittedBlocking:0,minorCount:minors.length});
      sel.findings=sel.findings.map((x,i)=>regressed.has(ordered[i].key)?{...x,regression:`REGRESSION: fixed in check #${regressed.get(ordered[i].key)}, broken again`}:x);
      regressions=ordered.filter(f=>regressed.has(f.key)).map(f=>({rule:f.rule,fixedInCheck:regressed.get(f.key)}));
      c.regressionCount=regressions.length;
    }else sel=formatForAuthor({sent:blocking.slice(0,B.maxFindingsPerCheck).map(f=>({...f,state:'open'})),omittedBlocking:Math.max(0,blocking.length-B.maxFindingsPerCheck),minorCount:c.findings.length-blocking.length});
    const advisoryMore=Math.max(0,minors.length-3);
    const regressionNote=regressions?.length?`${regressions.length} REGRESSION(S) listed first: fixed earlier, broken again; do not undo earlier fixes. `:'';
    const relaxedFail=()=>`Fix ALL ${blocking.length} blocking finding(s) listed (repairHint/moveHint are evidence you may use or ignore), then call diagram_build_check again. ${l.checksLeftThisRound} check(s) left this round.${advisoryMore?` Advice: top 3 shown, +${advisoryMore} more not shown.`:''}`;
    // Relaxed CHECK_PASS: no advisory detail (rule names, advice, +N more), so nothing in the reply invites another polishing check.
    const relaxedPass=relaxed&&!fail;
    return reply({status:fail?'CHECK_FAIL':'CHECK_PASS',svgHash:c.hash,cached,...(source?{source}:{}),...(buildNote?{buildNote}:{}),checks:relaxedPass?advisoryStatuses(checkStatuses(c)):checkStatuses(c),failed:failedRules(c),...(relaxedPass?{}:{advisoryRules:advisoryRules(c)}),findings:sel.findings,omittedBlocking:sel.omittedBlocking,minorCount:sel.minorCount,...(relaxed&&fail?{advice:minors.slice(0,3).map(toAdviceItem),advisoryMore,...(regressions?.length?{regressions}:{})}:{}),notCheckable:notCheckable(c),...(c.notes.length?{notes:c.notes}:{}),...l,
      next:fail
        ?(last?`${relaxed?regressionNote:''}This was your last build_check ${l.checksLeftThisRun===0?'of the run':'this round'}. If you submit now with FAILs remaining, an escalation review decides: semantic FAILs are rejected, border-grazing or unavoidable-crossing FAILs may be waived, anything else comes back as layout advice. Better: fix what you can and submit.`:relaxed?regressionNote+relaxedFail():`Fix these findings (repairHint/moveHint are evidence you may use or ignore), then call diagram_build_check again. ${l.checksLeftThisRound} check(s) left this round.`)
        :relaxed?submitNowText(c.hash)
        :`All script checks pass for hash ${c.hash}. Optionally call diagram_inspect (at most ${B.maxInspectionsPerRound} per round) for the visual evidence, then call diagram_submit with svgHash ${c.hash}.`});
  }

  /** Relaxed gate: the `next` text appended to a diagram_inspect result when a CHECK_PASS exists this round, else null. */
  function inspectionNext(){
    if(!relaxed||!lastPass)return null;
    const cand=readCandidate();
    const passed=`Check #${lastPass.seq} passed for hash ${lastPass.hash}.`;
    if(cand.ok&&cand.hash===lastPass.hash)return `${passed} Submit it now with diagram_submit; advisory items are not a reason for another check.`;
    if(!cand.ok)return `${passed} candidate.svg is now unreadable (${cand.error}); restore the passing bytes and submit hash ${lastPass.hash}.`;
    const h=cache.get(cand.hash);
    if(h&&h.findings.some(f=>f.severity==='blocking'))return `${passed} The current candidate.svg bytes (hash ${cand.hash}) differ from it and have blocking findings; fix them and check again, or restore the passing bytes and submit hash ${lastPass.hash}.`;
    if(h)return `${passed} The current candidate.svg bytes (hash ${cand.hash}) differ from it and also passed; submit them with diagram_submit.`;
    return `${passed} The current candidate.svg bytes (hash ${cand.hash}) differ from it and are unchecked: call diagram_build_check before submitting them, or restore the passing bytes and submit hash ${lastPass.hash}.`;
  }
  /** Appends inspectionNext() to a diagram_inspect result (first text block, JSON body) and its details. Returns the result unchanged when there is no note. */
  function annotateInspection(result){
    const next=inspectionNext();
    const first=result?.content?.[0];
    if(!next||first?.type!=='text')return result;
    let body;try{body=JSON.parse(first.text)}catch{body=null}
    result.content[0]={...first,text:body&&typeof body==='object'?JSON.stringify({...body,next}):`${first.text}\n${JSON.stringify({next})}`};
    result.details={...result.details,next};
    return result;
  }

  /** The one binding script check: build step (the author's generator) -> hash -> phase-1 check -> cache. Text only. Every call counts against the caps. */
  async function buildCheckNow({build=null}={}){
    requireLayoutIntent();
    assertJobManifest(job);
    if(!twoPhase)throw Error('DIAGRAM_BUILD_CHECK_DISABLED');
    if(finalResult)return finalResult;
    if(callsRound>=B.maxChecksPerRound||callsTotal>=B.maxChecksPerRun){
      cur.limitHits++;persist();
      const scope=callsTotal>=B.maxChecksPerRun?'run':'round';
      if(relaxed)return reply({status:'CHECK_LIMIT_REACHED',scope,...left(),next:`No diagram_build_check calls remain this ${scope}. Submit the current candidate.svg now. Advisory findings never block: they go to the reviewer and the Judge with the candidate. Only a blocking FAIL (a wrong or unreadable drawing) is escalated.`});
      return reply({status:'CHECK_LIMIT_REACHED',scope,...left(),next:scope==='run'?'No diagram_build_check calls remain in this run. Submit the current candidate.svg: unchecked bytes are checked by the orchestrator itself and, if script FAILs remain, the escalation review decides.':'No diagram_build_check calls remain this round. Submit the current candidate.svg: if script FAILs remain, the escalation review decides (semantic FAILs are rejected, border-grazing or unavoidable-crossing FAILs may be waived, anything else comes back as layout advice).'});
    }
    if(build&&generatorCapHit()){
      cur.limitHits++;persist();
      return reply({status:'GENERATOR_ERROR_LIMIT_REACHED',message:`${cur.generatorErrors} build_check calls this round failed before producing candidate.svg (cap ${B.maxGeneratorErrorsPerRound}). No further diagram_build_check calls are accepted this round.`,...left(),next:`Write ${job.outputPath} yourself (fix the generator or the spec and rebuild it with your own tools), then call diagram_submit: the orchestrator checks the bytes itself and, if script FAILs remain, the escalation review decides. If no readable candidate.svg exists the submit is refused.`});
    }
    const t0=now();
    callsRound++;callsTotal++;cur.buildCheckCalls++;
    const seq=callsTotal;
    const finish=reply_=>{checkSinceMark+=now()-t0;timings.checkMs+=now()-t0;persist();return reply_};
    let source=null,buildNote=null;
    if(build){
      let built;
      try{built=await build()}catch(error){callsRound--;callsTotal--;cur.buildCheckCalls--;throw error} // a genuine tool failure is not a spent check
      source=built?.source??null;buildNote=built?.note??null;
      if(!built?.ok){
        // No bytes were checked, so this call is not a spent check: it counts against the separate generator-error cap only.
        callsRound--;callsTotal--;cur.buildCheckCalls--;
        generatorErrors++;cur.generatorErrors++;
        checkLog.push({layoutIntentHash:layoutIntent?.hash??null,seq:null,round:round+1,svgHash:null,cached:false,generatorError:true,source,failed:[],blocking:0,minor:0,ms:now()-t0});
        const l=left();
        return finish(reply({status:'GENERATOR_ERROR',source,...(buildNote?{buildNote}:{}),message:built?.message??'the generator failed',...l,next:`Fix the generator or the spec (see the message) and call diagram_build_check again. This call did not use a check; ${l.generatorErrorsLeftThisRound} generator error(s) left this round before build_check is refused.`}));
      }
    }
    const cand=readCandidate();
    if(!cand.ok){
      checkLog.push({layoutIntentHash:layoutIntent?.hash??null,seq,round:round+1,svgHash:null,cached:false,source,outcome:'CHECK_FAIL',failed:['candidate-missing'],advisory:[],blocking:1,minor:0,ms:now()-t0});
      return finish(reply({status:'CHECK_FAIL',svgHash:null,cached:false,failed:['candidate-missing'],findings:[{rule:'candidate-missing',severity:'blocking',evidence:{measured:cand.error,threshold:'a readable regular candidate.svg (<= 2 MB, exact UTF-8)'},suggestion:`Write the SVG to ${job.outputPath} (directly, or from make.py) and call diagram_build_check again.`}],...left(),next:'No candidate bytes to check.'}));
    }
    // Relaxed gate: the latest check of exactly these bytes passed, so another check would only repeat it. Refused, and not a spent check.
    if(relaxed&&lastCheck?.pass&&lastCheck.hash===cand.hash){
      callsRound--;callsTotal--;cur.buildCheckCalls--;
      refusals.push({round:round+1,code:'UNCHANGED_PASSING_BYTES',svgHash:cand.hash,afterChecks:callsRound});cur.refusals++;
      return finish(reply({status:'REFUSED',code:'UNCHANGED_PASSING_BYTES',countedAsCheck:false,svgHash:cand.hash,message:submitNowText(cand.hash),...left(),next:`Call diagram_submit with svgHash ${cand.hash}. A further diagram_build_check is accepted only after candidate.svg has changed.`}));
    }
    let hit=cache.get(cand.hash);const cached=!!hit;
    if(cached){cacheHits++;cur.cacheHits++}
    else{
      hit=await scriptCheck(cand,{eager:true});hit.checkSeq=seq;cache.set(cand.hash,hit);cur.freshChecks++;
    }
    checkLog.push({layoutIntentHash:layoutIntent?.hash??null,seq,round:round+1,svgHash:cand.hash,cached,source,outcome:hit.findings.some(f=>f.severity==='blocking')?'CHECK_FAIL':'CHECK_PASS',failed:failedRules(hit),advisory:advisoryRules(hit),blocking:hit.findings.filter(f=>f.severity==='blocking').length,minor:hit.findings.filter(f=>f.severity!=='blocking').length,ms:now()-t0});
    const entry=checkLog.at(-1),replyBody=checkReply(hit,{cached,source,buildNote,seq});
    if(relaxed){entry.regressions=hit.regressionCount??0;lastCheck={hash:cand.hash,pass:entry.outcome==='CHECK_PASS'};if(lastCheck.pass)lastPass={hash:cand.hash,seq}}
    return finish(replyBody);
  }
  const buildCheck=opts=>serial(()=>buildCheckNow(opts??{}));

  function refuse(code,{hit=null,message,next}){
    refusals.push({round:round+1,code,svgHash:hit?.hash??null,afterChecks:callsRound});cur.refusals++;persist();
    const blocking=hit?hit.findings.filter(f=>f.severity==='blocking'):[];
    const sel=formatForAuthor({sent:blocking.slice(0,B.maxFindingsPerCheck).map(f=>({...f,state:'open'})),omittedBlocking:Math.max(0,blocking.length-B.maxFindingsPerCheck),minorCount:0});
    return reply({status:'REFUSED',code,countedAsRound:false,message,...(hit?{svgHash:hit.hash,findings:sel.findings,omittedBlocking:sel.omittedBlocking}:{}),...left(),next});
  }

  async function submitNow({svgHash=null}={}){
    requireLayoutIntent();
    if(finalResult)return finalResult;
    const wallNow=now()-startedAt>B.maxWallMs;
    const cand=readCandidate();
    let hit=null,escalating=false;
    if(twoPhase){
      // Binding rule: only bytes whose latest diagram_build_check has no FAIL may be submitted; a refusal is never a round.
      // Exceptions that cannot deadlock the run: the wall clock is spent (no review anyway), or the check budget is spent (escalation rules apply).
      if(cand.ok&&svgHash&&svgHash!==cand.hash)return refuse('STALE_HASH',{message:`candidate.svg now has hash ${cand.hash}, not the ${svgHash} you named: the bytes changed after that diagram_build_check.`,next:'Run diagram_build_check on the current bytes, then submit the hash it returns.'});
      // An unreadable candidate is never passed on: there is nothing to hash, audit or review. With the check budget spent the author can still write the file and submit it (the orchestrator then checks the bytes itself).
      if(!cand.ok&&!wallNow)return refuse('NO_CANDIDATE',{message:cand.error,next:exhausted()?`Write the SVG to ${job.outputPath} (or fix and run your generator yourself), then call diagram_submit; no diagram_build_check calls remain, so the orchestrator checks the bytes itself.`:`Write the SVG to ${job.outputPath}, run diagram_build_check, then submit.`});
      if(cand.ok){
        hit=cache.get(cand.hash)??null;
        if(!hit){
          if(!wallNow&&!exhausted())return refuse('UNCHECKED_BYTES',{message:`these bytes (${cand.hash}) were never script-checked.`,next:'Call diagram_build_check (it rebuilds from make.py when present) and submit the hash it returns once it has no FAIL.'});
          // No check left (or no time): the orchestrator checks the bytes itself, without spending a check.
          const t0=now();hit=await scriptCheck(cand,{eager:true});cache.set(cand.hash,hit);
          checkLog.push({layoutIntentHash:layoutIntent?.hash??null,seq:null,round:round+1,svgHash:cand.hash,cached:false,implicit:true,outcome:hit.findings.some(f=>f.severity==='blocking')?'CHECK_FAIL':'CHECK_PASS',failed:failedRules(hit),advisory:advisoryRules(hit),blocking:hit.findings.filter(f=>f.severity==='blocking').length,minor:hit.findings.filter(f=>f.severity!=='blocking').length,ms:now()-t0});
        }
        if(hit.findings.some(f=>f.severity==='blocking')&&!wallNow){
          if(exhausted())escalating=true;
          else return refuse('FAILING_BYTES',{hit,message:`the latest diagram_build_check of these bytes (${hit.hash}) has script FAILs; fix them before submitting.`,next:`Fix the findings and call diagram_build_check again (${left().checksLeftThisRound} check(s) left this round). Submitting failing bytes is only possible after the last check of the round.`});
        }
      }
    }
    const begin=now();timings.authorMs+=Math.max(0,begin-authorMark-checkSinceMark);checkSinceMark=0;authorMark=begin; // consume the interval now: a submit that throws part-way must not add it again on the next submit
    round++;
    const wallExceeded=begin-startedAt>B.maxWallMs;
    const c=escalating?await escalate(hit):await evaluate(cand,{allowReview:!wallExceeded,hit});
    let reasonOverride=null;
    if(c.stage==='review'&&!c.findings.some(f=>f.severity==='blocking')){
      const finalRead=readCandidate();
      c.gate=evaluateGate({reviewedHash:c.render.svgHash,finalHash:finalRead.ok?finalRead.hash:null,renderedHash:c.hash,audit:c.audit,forbidden:c.forbidden,review:c.review,openBlocking:0,waived:(c.waived??[]).map(w=>w.check),relaxed});
      if(!c.gate.pass)c.findings.push(...c.gate.reasons.map(gateFinding));
      else if(relaxed&&!c.escalation&&c.bytes)await judgePhase(c);
    }
    carryReview(c);
    const score=summarise(c);
    let reverted=false;
    if(base?.bytes&&(!c.bytes||cmpPair(score,base.score)>0)){
      reverted=true;reverts++;
      for(const f of c.findings)if(ledger.get(f.key)?.state==='fixed')oscillationsInReverted++;
      restore(base.bytes);
      rounds.push(roundRecord(c,score,{reverted:true,revertedTo:base.hash}));
      stagnant++;
    }else{
      const svgText=c.text;
      ledger.update(round,c.findings,{sources:c.sources,sigOf:svgText?f=>regionSignature(svgText,f):null});
      c.score=score;if(c.bytes)base=c; // a round without candidate bytes is recorded but never becomes the revert target
      if(c.reviewSnapshot)lastReview=c.reviewSnapshot;
      const improved=!best||cmpPair(score,best.score)<0;
      if(c.bytes&&(!best||betterOrEqual({...c,score},best)))best={...c,score};
      stagnant=improved||c.judgement?0:stagnant+1; // a judged round is bounded by the round and wall budgets, not by the blocking-count stagnation rule
      rounds.push(roundRecord(c,score));
    }
    // Late defensive check: a pass must also leave no open blocking finding in the ledger.
    if(!reverted&&c.gate?.pass&&ledger.openBlocking().length>0)c.gate={pass:false,reasons:[{code:'OPEN_BLOCKING',detail:`${ledger.openBlocking().length} open blocking finding(s) in the ledger`}]};
    doneRounds.push({round,...cur});cur=freshStats();callsRound=0;lastCheck=null;lastPass=null; // the per-round check budget resets when a round ends
    let result;
    const judgeOk=!relaxed||c.judgement?.verdict==='IMPROVED'; // relaxed: REVIEWED needs the Judge's IMPROVED on exactly these bytes; fail closed
    const niNote=(()=>{const j=c.judgement??best?.judgement;return j?.verdict==='NOT_IMPROVED'?`NOT_IMPROVED (${j.verdictReason}): `:''})();
    if(!reverted&&c.gate?.pass&&judgeOk){exceptions=c.waived??[];result=finalize(exceptions.length?'REVIEWED_WITH_EXCEPTIONS':'REVIEWED',null)}
    else if(c.stage==='reviewer-error')result=finalize('CANDIDATE','REVIEWER_ERROR: '+c.review.error);
    else if(c.stage==='judge-error')result=finalize('CANDIDATE','JUDGE_ERROR: '+c.judgement.verdictReason);
    else if(c.notes.includes('SOURCE_NOT_PARSEABLE'))result=finalize('CANDIDATE','SOURCE_NOT_PARSEABLE: semantics cannot be established by the auditor');
    else if(wallExceeded||now()-startedAt>B.maxWallMs)result=finalize('CANDIDATE',`${niNote}WALL_CLOCK: exceeded ${Math.round(B.maxWallMs/1000)} s`);
    else if(round>=B.maxRounds)result=finalize('CANDIDATE',`${niNote}ROUNDS_EXHAUSTED: ${B.maxRounds} submit rounds used`);
    else if(stagnant>=B.stagnationRounds)result=finalize('CANDIDATE',`NO_PROGRESS: blocking findings did not decrease for ${B.stagnationRounds} rounds`);
    else{
      persist();
      const sel=formatForAuthor(selectForAuthor(ledger,{max:B.maxBlockingPerRound}));
      const body={status:'REVISE',round,maxRounds:B.maxRounds,svgHash:reverted?base.hash:c.hash,...(reverted?{reverted:true,revertedTo:base.hash,discarded:{auditBlocking:score.auditBlocking,reviewBlocking:score.reviewBlocking,note:'your last edit increased blocking findings; candidate.svg was restored to the previous best bytes. Fix the findings below on top of that version.'}}:{}),
        ...(c.escalation?{escalation:publicEscalation(c.escalation)}:{}),
        findings:sel.findings,downgrades:downgradeList(),omittedBlocking:sel.omittedBlocking,minorCount:sel.minorCount,
        ...(relaxed?reviseExtras(c,reverted):{}),
        next:relaxed&&c.judgement?.verdict==='NOT_IMPROVED'
          ?`The Judge compared your drawing with the original and it is not yet clearly better (see judge). Apply judge.improvements, most valuable first; fix any blocking finding; use advice only where it helps the picture. Then ${twoPhase?`diagram_build_check (${B.maxChecksPerRound} checks this round), then diagram_submit with the hash it returns`:'call diagram_submit again'}. You have ${B.maxRounds-round} submit round(s) left.`
          :twoPhase
          ?(c.escalation?.outcome==='relayout'
            ?`The reviewer advises a layout-level change (see escalation.relayout): redo the layout accordingly, then diagram_build_check (${B.maxChecksPerRound} checks this round), then diagram_submit with the hash it returns. You have ${B.maxRounds-round} submit round(s) left.`
            :`Fix these findings, then diagram_build_check (${B.maxChecksPerRound} checks this round; at most ${B.maxInspectionsPerRound} diagram_inspect calls), then diagram_submit with the hash it returns. You have ${B.maxRounds-round} submit round(s) left.`)
          :`Fix these findings (at most ${B.maxInspectionsPerRound} self-inspections with diagram_inspect this round), then call diagram_submit again. You have ${B.maxRounds-round} submit round(s) left.`};
      result=reply(body);
    }
    authorMark=now();
    onRoundEnd?.(round);
    return result;
  }
  /** Relaxed revise message: the Judge's top 3 improvements (judged rounds only) and the 3 highest-impact advice items. The full advice list is never sent. */
  function reviseExtras(c,reverted){
    const a=selectAdvice(ledger,{max:3}),j=c.judgement;
    return {advice:a.sent,adviceTotal:a.total,
      ...(!reverted&&j&&j.verdict==='NOT_IMPROVED'?{judge:{verdict:j.verdict,reason:j.verdictReason,mean:j.mean,passMeans:j.passMeans??null,dimensions:Object.fromEntries(Object.entries(j.merged?.dims??{}).map(([k,v])=>[k,v?v.score:null])),improvements:(j.improvements??[]).slice(0,3)}}:{})};
  }
  const publicEscalation=e=>({outcome:e.outcome,failed:e.failed,...(e.hard?{hard:e.hard}:{}),...(e.error?{error:e.error}:{}),...(e.waiverRejected?{waiverRejected:e.waiverRejected}:{}),...(e.relayout?{relayout:e.relayout}:{})});

  async function finalizeNow(kind){
    if(finalResult)return finalResult;
    timings.authorMs+=Math.max(0,now()-authorMark-checkSinceMark);checkSinceMark=0;authorMark=now();
    const wall=kind==='wall'?`WALL_CLOCK: exceeded ${Math.round(B.maxWallMs/1000)} s while the author was still working; `:kind==='call-timeout'?`MODEL_CALL_TIMEOUT: an author model call ran past its per-call limit twice in a row (${modelCallTimeouts.length} timeout(s) recorded); `:'';
    if(!best){
      round++;
      const cand=readCandidate();
      const c=await evaluate(cand,{allowReview:false,hit:twoPhase&&cand.ok?cache.get(cand.hash)??null:null});
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
  /** The author's model call outlasted its per-call limit and was aborted; the second consecutive one ends the run (CANDIDATE MODEL_CALL_TIMEOUT). */
  const finalizeModelCallTimeout=()=>serial(()=>finalizeNow('call-timeout'));
  const noteModelCallTimeout=({elapsedMs,limitMs,action})=>{modelCallTimeouts.push({n:modelCallTimeouts.length+1,at:new Date(now()).toISOString(),elapsedS:Math.round(elapsedMs/100)/10,limitS:limitMs/1000,action});persist()};
  const wallExceeded=()=>now()-startedAt>B.maxWallMs;

  const submitLayoutIntent=opts=>serial(()=>{
    if(finalResult)throw Error('LAYOUT_INTENT_RUN_FINISHED: resume the run for a fresh contract');
    try {
      if(layoutIntent&&(opts.predecessorHash!==layoutIntent.hash||!opts.reason?.trim()))throw Error('LAYOUT_INTENT_REVISION_REQUIRES_PREDECESSOR_AND_REASON');
      const intent=validateLayoutIntent(opts.intent,model);
      const record={schema:'pi-layout-intent/1',sourceHash:job.sourceHash,rulesHash:job.rulesHash,predecessorHash:layoutIntent?.hash??null,reason:opts.reason??null,intent};record.hash=hashLayoutIntent(record);
      layoutIntent=JSON.parse(JSON.stringify(record));layoutIntentHistory.push(layoutIntent);
      ledger=createLedger();blockingHistory.clear();
      cache.clear();lastCheck=null;lastPass=null;best=null;base=null;lastReview=null;exceptions=[];
      layoutIntentEvents.push({name:record.predecessorHash?'magic_layout_intent_revised':'magic_layout_intent_created',layout_intent_hash:record.hash,previous_layout_intent_hash:record.predecessorHash,layout_intent_revision:layoutIntentHistory.length,layout_contract_outcome:'accepted',layout_node_count:intent.nodes.length,layout_layer_count:new Set(intent.nodes.map(n=>n.layer)).size});
      persist();return reply({status:'LAYOUT_INTENT_ACCEPTED',layoutIntentHash:record.hash,intent,next:'Author the frozen contract; build, inspect and submit are now enabled.'});
    } catch(error){layoutIntentEvents.push({name:'magic_layout_contract_failed',layout_contract_outcome:'rejected',layout_contract_reason:String(error.message).split(':')[0]});persist();throw error}
  });
  persist(); // status RUNNING, before the first author turn

  return {
    setPlanningFacts:facts=>{if(!facts?.nodes?.length||facts.conflicts?.length||facts.membershipConflicts?.length)throw Error('LAYOUT_SOURCE_FACTS_UNRESOLVED');if(layoutIntent)throw Error('LAYOUT_INTENT_ALREADY_FROZEN');model=JSON.parse(JSON.stringify(facts))},submitLayoutIntent,requireLayoutIntent,submit,buildCheck,annotateInspection,finalizeWithoutSubmit,expireWallClock,finalizeModelCallTimeout,noteModelCallTimeout,wallExceeded,manifest:()=>lastManifest,manifestPath,
    addAuthorUsage:u=>{tokens.author=addUsage(tokens.author,u)},
    noteAuthorCall:()=>{authorCalls++},
    state:()=>({status,statusReason,round,rounds,ledger:ledger.snapshot(),oscillationsInReverted,best:best?{hash:best.hash,score:best.score}:null,manifest:lastManifest}),
    manifestSelfHash:()=>lastManifest?.selfHash??null,
    isFinal:()=>finalResult!==null,
    budgets:B,
  };
}
