// Pure helpers for run-bench.mjs. No network, no model, no browser: unit-tested in bench-lib.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readRunManifest} from '../src/manifest.mjs';

/** Text a rate-limit matcher may look at. Matched on error TEXT only; never on numbers such as tMs timestamps. */
const RATE_LIMIT_RE=/rate[\s_-]?limit|usage[\s_-]?limit|too many requests|\bquota\b|(?:status|http|error|code)[\s:=]*429\b|\b429\b[^\d]*(?:too many|rate|limit|exceeded)/i;
export const matchesRateLimit=text=>typeof text==='string'&&RATE_LIMIT_RE.test(text);

/** Which logged events carry provider/runtime error text. Only their string fields are examined. */
export function eventErrorTexts(event){
  if(!event||typeof event!=='object')return [];
  switch(event.kind){
    case 'stderr':return [event.text];
    case 'response':return event.success===false?[event.error]:[];
    case 'tool-end':return event.isError?[event.error]:[];
    case 'assistant':return event.errorMessage?[event.errorMessage]:[];
    case 'agent-error':return [event.text];
    default:return [];
  }
}
export const eventIsRateLimit=event=>eventErrorTexts(event).some(matchesRateLimit);

export function median(values){
  const v=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!v.length)return null;
  const m=v.length>>1;
  return v.length%2?v[m]:(v[m-1]+v[m])/2;
}
const min=v=>{const x=v.filter(Number.isFinite);return x.length?Math.min(...x):null};
const max=v=>{const x=v.filter(Number.isFinite);return x.length?Math.max(...x):null};
export const stats=v=>({n:v.filter(Number.isFinite).length,median:median(v),min:min(v),max:max(v)});

/** Audit checks that are NOT-CHECKABLE by construction (the auditor never certifies them), so they are not reported per run. */
export const STRUCTURAL_NOT_CHECKABLE=['routeGeometry','visualQuality'];

/** Reduce a run's event list (as logged by the harness) to the numbers the summary needs. */
export function reduceEvents(events){
  const r={doneReason:null,elapsedMs:null,toolCalls:0,inspections:0,inputTokens:0,outputTokens:0,assistantMessages:0,
    firstAssistantMs:null,specRenders:0,submits:0,buildChecks:0,sourceFactsIncluded:false,specModeOffered:false,outputTokensBeforeFirstInspection:null,firstInspectionStartMs:null,firstInspectionEndMs:null,rateLimited:false,agentError:null,runDir:null,errors:[]};
  for(const e of events){
    if(e.kind==='notify'){if(/^Source facts included/.test(e.text??''))r.sourceFactsIncluded=true;if(/^Layout spec mode on/.test(e.text??''))r.specModeOffered=true}
    if(e.kind==='notify'&&r.runDir===null){const m=/private work directory:\s*(\S+)/.exec(e.text??'');if(m)r.runDir=m[1]}
    if(e.kind==='tool-start'){r.toolCalls++;if(e.tool==='diagram_render_spec')r.specRenders++;if(e.tool==='diagram_submit')r.submits++;if(e.tool==='diagram_build_check')r.buildChecks++;if(e.tool==='diagram_inspect'){r.inspections++;if(r.firstInspectionStartMs===null){r.firstInspectionStartMs=e.tMs;r.outputTokensBeforeFirstInspection=r.outputTokens}}}
    if(e.kind==='tool-end'&&e.tool==='diagram_inspect'){r.firstInspectionEndMs??=e.tMs}
    if(e.kind==='tool-end'&&e.isError)r.errors.push(`${e.tool}: ${String(e.error??'').slice(0,160)}`);
    if(e.kind==='assistant'){r.assistantMessages++;r.agentError=e.stopReason==='error'?(e.errorMessage??'error'):null;r.firstAssistantMs??=e.tMs;r.inputTokens+=e.usage?.input??0;r.outputTokens+=e.usage?.output??0}
    if(e.kind==='done'){r.doneReason=e.reason;r.elapsedMs=e.elapsedMs}
    if(eventIsRateLimit(e))r.rateLimited=true;
  }
  // The agent loop ends with AGENT_END even when the provider call failed (e.g. WebSocket error). Surface that.
  if(AGENT_DONE_REASONS.includes(r.doneReason)&&r.agentError)r.doneReason='AGENT_ERROR';
  return r;
}

/** Two-phase gate usage from run.json: what the caps (6/round, 16/run) need to be re-measured against. */
function twoPhaseSummary(m){
  const t=m.twoPhase,per=(t.perRound??[]).map(r=>r.buildCheckCalls??0);
  return {buildChecks:t.checksTotal??0,cacheHits:t.cacheHits??0,generatorErrors:t.generatorErrors??0,refusals:(t.refusals??[]).length,escalations:(t.escalations??[]).length,
    escalationOutcomes:(t.escalations??[]).map(e=>e.outcome),waived:(m.exceptions??[]).map(e=>e.check),checksPerRound:per,maxChecksInARound:per.length?Math.max(...per):0};
}

/** v2 metrics from the orchestrator's run.json (null when the run produced none, e.g. PI_DIAGRAM_V2=0). */
export function summariseManifest(m){
  if(!m||typeof m!=='object')return null;
  const rounds=Array.isArray(m.rounds)?m.rounds:[];
  const met=m.metrics??{};
  return {gateStatus:m.status??null,statusReason:typeof m.statusReason==='string'?m.statusReason.split(':')[0]:null,rounds:rounds.length,reverts:met.reverts??rounds.filter(r=>r.reverted).length,
    authorSeconds:(m.timings?.authorMs??0)/1000,reviewerSeconds:(m.timings?.reviewerMs??0)/1000,
    authorTokens:{input:m.tokens?.author?.input??0,output:m.tokens?.author?.output??0},reviewerTokens:{input:m.tokens?.reviewer?.input??0,output:m.tokens?.reviewer?.output??0},
    reviewerBlockingFindings:rounds.reduce((n,r)=>n+(r.review?.findings??[]).filter(f=>f.severity==='blocking').length,0),
    falseBlockCandidates:met.falseBlockCandidates??0,oscillations:met.oscillations??0,finalSvgSha256:m.finalSvgSha256??null,
    ...(Array.isArray(m.modelCallTimeouts)?{modelCallTimeouts:m.modelCallTimeouts.length}:{}),
    ...(m.twoPhase?{modelCalls:m.modelCalls??null,twoPhase:twoPhaseSummary(m)}:{})};
}

/** Load and verify the orchestrator's run.json, waiting up to waitMs for it (the agent_end finalisation may land after the run is reported done). */
export async function loadV2Metrics(runDir,{waitMs=60_000,pollMs=500}={}){
  const deadline=Date.now()+waitMs;
  for(;;){
    try{
      const m=readRunManifest(runDir);
      // A RUNNING manifest is written before the first author turn; keep waiting for the final status until the deadline.
      if(m.status!=='RUNNING')return {v2:summariseManifest(m)};
      if(Date.now()>=deadline)return {v2:summariseManifest(m),error:'manifest still RUNNING at the deadline'};
      await new Promise(r=>setTimeout(r,pollMs));
    }catch(error){
      const message=String(error?.message??error);
      if(message.startsWith('MANIFEST_TAMPERED'))return {v2:null,error:message};
      if(Date.now()>=deadline)return {v2:null,error:'no run.json'};
      await new Promise(r=>setTimeout(r,pollMs));
    }
  }
}

/** Split an audit result into FAIL checks, ADJUDICATED checks, and NOT-CHECKABLE checks (excluding the structural pair). */
export function summariseAudit(audit){
  if(!audit||!audit.checks)return {status:audit?.status??'NO-AUDIT',fail:[],notCheckable:[],adjudicated:[],error:audit?.error??null};
  const fail=[],notCheckable=[],adjudicated=[];
  for(const [name,c] of Object.entries(audit.checks)){
    if(c?.status==='FAIL')fail.push(name);
    else if(c?.status==='ADJUDICATED')adjudicated.push(name);
    else if(c?.status==='NOT-CHECKABLE'&&!STRUCTURAL_NOT_CHECKABLE.includes(name))notCheckable.push(name);
  }
  return {status:audit.status,fail,notCheckable,adjudicated,error:null};
}

/** A run is "completed" when the agent ended on its own and no rate limit hit it. Only these enter the timing statistics. */
export const AGENT_DONE_REASONS=['AGENT_SETTLED','AGENT_END_NO_SETTLE','AGENT_END'];
/** Runs worth repeating: the provider failed (transport error, surfaced as AGENT_ERROR) or one author model call hung past PI_DIAGRAM_MAX_CALL_S twice (run.json statusReason MODEL_CALL_TIMEOUT). */
export const RETRYABLE_STATUS_REASONS=['MODEL_CALL_TIMEOUT'];
export const isRetryableRun=run=>run?.doneReason==='AGENT_ERROR'||RETRYABLE_STATUS_REASONS.includes(run?.v2?.statusReason);
export const isCompleted=run=>AGENT_DONE_REASONS.includes(run.doneReason)&&!run.rateLimited;

/** Pi RPC clients should wait for `agent_settled` (docs/rpc.md, Pi >= 1.0); `agent_end` is not final. Pure state machine for that rule:
 *  agent_settled -> finish AGENT_SETTLED; agent_end -> arm a grace timer, expiry -> finish AGENT_END_NO_SETTLE (Pi 0.84.x never emits agent_settled). */
export const SETTLE_GRACE_MS=5000;
export function createRunTracker({graceMs=SETTLE_GRACE_MS}={}){
  let ended=false,settled=false,graceFired=false;
  return {
    onEvent(type){
      if(type==='agent_settled'&&!settled){settled=true;return {finish:'AGENT_SETTLED'}}
      if(type==='agent_end'&&!ended&&!settled){ended=true;return {armGraceMs:graceMs}}
      // The extension re-prompted the author after a model-call timeout: the run is not over, so the settle grace timer must not finish it.
      if(type==='agent_start'&&ended&&!settled){ended=false;return {cancelGrace:true}}
      return {};
    },
    onGraceTimeout(){
      if(!ended||settled||graceFired)return null;
      graceFired=true;return 'AGENT_END_NO_SETTLE';
    }
  };
}

export function aggregate(runs){
  const byFixture={};
  for(const run of runs){(byFixture[run.fixture]??=[]).push(run)}
  const fixtures=Object.entries(byFixture).sort(([a],[b])=>a.localeCompare(b)).map(([fixture,rs])=>{
    const done=rs.filter(isCompleted);
    return {fixture,runs:rs.length,completed:done.length,
      elapsedMs:stats(done.map(r=>r.elapsedMs)),
      outputTokens:stats(done.map(r=>r.outputTokens)),
      inspections:stats(done.map(r=>r.inspections)),
      firstInspectionStartMs:stats(done.map(r=>r.firstInspectionStartMs)),
      finalInspected:done.filter(r=>r.finalSvgInspected===true).length,
      auditFailRuns:rs.filter(r=>r.audit?.fail?.length).map(r=>r.id),
      auditNotCheckableRuns:rs.filter(r=>r.audit?.notCheckable?.length).map(r=>r.id)};
  });
  const done=runs.filter(isCompleted);
  return {totalRuns:runs.length,completedRuns:done.length,
    rateLimitedRuns:runs.filter(r=>r.rateLimited).map(r=>r.id),
    nonCompletedRuns:runs.filter(r=>!isCompleted(r)).map(r=>({id:r.id,doneReason:r.doneReason})),
    overall:{elapsedMs:stats(done.map(r=>r.elapsedMs)),outputTokens:stats(done.map(r=>r.outputTokens)),firstInspectionStartMs:stats(done.map(r=>r.firstInspectionStartMs))},
    fixtures};
}

const sec=ms=>ms==null?'-':(ms/1000).toFixed(0)+'s';
const tok=n=>n==null?'-':Math.round(n).toString();
export function renderMarkdown(summary,{meta={}}={}){
  const L=[];
  L.push('# Pi diagram agent benchmark','');
  for(const [k,v] of Object.entries(meta))L.push(`- ${k}: ${v}`);
  L.push(`- runs: ${summary.totalRuns} (completed ${summary.completedRuns})`,'');
  L.push('## Per run','','| run | done | elapsed | first inspect | out tok | in tok | tools | inspections | final SVG inspected | audit | FAIL checks | NOT-CHECKABLE checks |','|---|---|---|---|---|---|---|---|---|---|---|---|');
  for(const r of summary.runs??[])L.push(`| ${r.id} | ${r.doneReason}${r.rateLimited?' (rate-limited)':''} | ${sec(r.elapsedMs)} | ${sec(r.firstInspectionStartMs)} | ${tok(r.outputTokens)} | ${tok(r.inputTokens)} | ${r.toolCalls} | ${r.inspections} | ${r.finalSvgInspected===null||r.finalSvgInspected===undefined?'n/a':r.finalSvgInspected?'yes':'NO'} | ${r.audit?.status??'-'} | ${(r.audit?.fail??[]).join(', ')||'-'} | ${(r.audit?.notCheckable??[]).join(', ')||'-'} |`);
  L.push('','## Per fixture (completed runs only)','','| fixture | n | elapsed median / min / max | output tokens median / min / max | inspections median | first inspect median |','|---|---|---|---|---|---|');
  for(const f of summary.fixtures)L.push(`| ${f.fixture} | ${f.completed}/${f.runs} | ${sec(f.elapsedMs.median)} / ${sec(f.elapsedMs.min)} / ${sec(f.elapsedMs.max)} | ${tok(f.outputTokens.median)} / ${tok(f.outputTokens.min)} / ${tok(f.outputTokens.max)} | ${f.inspections.median??'-'} | ${sec(f.firstInspectionStartMs.median)} |`);
  const o=summary.overall;
  L.push('',`Overall: elapsed median ${sec(o.elapsedMs.median)} (min ${sec(o.elapsedMs.min)}, max ${sec(o.elapsedMs.max)}); output tokens median ${tok(o.outputTokens.median)}; time to first diagram_inspect median ${sec(o.firstInspectionStartMs.median)}.`);
  const v2runs=(summary.runs??[]).filter(r=>r.v2);
  if(v2runs.length){
    L.push('','## v2 loop (independent reviewer + deterministic gate)','','| run | gate status | rounds | reverts | author s | reviewer s | author tok in/out | reviewer tok in/out | reviewer blocking findings | false-block candidates | oscillations | reason |','|---|---|---|---|---|---|---|---|---|---|---|---|');
    for(const r of v2runs){const v=r.v2;L.push(`| ${r.id} | ${v.gateStatus} | ${v.rounds} | ${v.reverts} | ${sec(v.authorSeconds*1000)} | ${sec(v.reviewerSeconds*1000)} | ${v.authorTokens.input}/${v.authorTokens.output} | ${v.reviewerTokens.input}/${v.reviewerTokens.output} | ${v.reviewerBlockingFindings} | ${v.falseBlockCandidates} | ${v.oscillations} | ${v.statusReason??'-'} |`)}
  }
  const tp=v2runs.filter(r=>r.v2.twoPhase);
  if(tp.length){
    L.push('','## Two-phase gate (diagram_build_check)','','| run | gate status | build_checks | per round | refusals | escalations | generator errors | waived | cache hits | model calls author/reviewer |','|---|---|---|---|---|---|---|---|---|---|');
    for(const r of tp){const t=r.v2.twoPhase;L.push(`| ${r.id} | ${r.v2.gateStatus} | ${t.buildChecks} | ${t.checksPerRound.join(',')||'-'} | ${t.refusals} | ${t.escalations} | ${t.generatorErrors} | ${t.waived.join(', ')||'-'} | ${t.cacheHits} | ${r.v2.modelCalls?`${r.v2.modelCalls.author}/${r.v2.modelCalls.reviewer}`:(r.assistantMessages??'-')} |`)}
  }
  L.push('','## Audit',`FAIL runs: ${summary.fixtures.flatMap(f=>f.auditFailRuns).join(', ')||'none'}`,`NOT-CHECKABLE runs (excluding the structural ${STRUCTURAL_NOT_CHECKABLE.join('/')} pair): ${summary.fixtures.flatMap(f=>f.auditNotCheckableRuns).join(', ')||'none'}`);
  L.push('','## Non-completed runs',summary.nonCompletedRuns.length?summary.nonCompletedRuns.map(r=>`- ${r.id}: ${r.doneReason}`).join('\n'):'none');
  if(summary.rateLimitedRuns.length)L.push('',`Rate-limit signals (error text only): ${summary.rateLimitedRuns.join(', ')}`);
  L.push('');
  return L.join('\n');
}

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Parse adjudication records from a file path (used in --magic-options or env). */
export function loadAdjudications(adjudicationPath){
  if(!adjudicationPath)return [];
  try{
    const file=fs.realpathSync(adjudicationPath);
    const item=fs.statSync(file);
    if(!item.isFile()||item.size===0||item.size>64_000)return [];
    const bytes=fs.readFileSync(file);
    const parsed=JSON.parse(bytes.toString('utf8'));
    return Array.isArray(parsed)?parsed:[parsed];
  }catch{
    return [];
  }
}

/** Re-audit the final SVG with optional adjudication records passed to the auditor. */
export async function postProcess({runDir,source,outBase,auditFn,adjudications=[],v2=true}){
  const res={finalSvgSha256:null,finalSvgInspected:null,audit:null};
  if(v2&&runDir&&fs.existsSync(runDir)){const m=await loadV2Metrics(runDir);if(m.v2){res.v2=m.v2;fs.copyFileSync(path.join(runDir,'run.json'),outBase+'.run.json')}else res.v2Error=m.error}
  if(!runDir||!fs.existsSync(runDir))return {...res,audit:{status:'NO-AUDIT',fail:[],notCheckable:[],adjudicated:[],error:'run directory missing'}};
  const cand=path.join(runDir,'candidate.svg');
  if(!fs.existsSync(cand))return {...res,finalSvgInspected:false,audit:{status:'NO-AUDIT',fail:[],notCheckable:[],adjudicated:[],error:'no candidate.svg'}};
  const bytes=fs.readFileSync(cand);res.finalSvgSha256=sha(bytes);
  fs.copyFileSync(cand,outBase+'.candidate.svg');
  // diagram_inspect writes candidate.<first 12 hex of SVG sha256>.<role>.png: its presence means this exact SVG was rendered for inspection.
  res.finalSvgInspected=fs.readdirSync(runDir).some(f=>f.startsWith(`candidate.${res.finalSvgSha256.slice(0,12)}.`)&&f.endsWith('.png'));
  const orig=fs.readdirSync(runDir).find(f=>f.startsWith('source.original.')&&f.endsWith('.svg'));
  try{
    const audit=await auditFn(fs.readFileSync(source),bytes,{originalSvg:orig?fs.readFileSync(path.join(runDir,orig)):undefined,adjudications});
    fs.writeFileSync(outBase+'.audit.json',JSON.stringify(audit,null,2));
    res.audit=summariseAudit(audit);res.audit.originalRenderFound=!!orig;
  }catch(error){res.audit={status:'NO-AUDIT',fail:[],notCheckable:[],adjudicated:[],error:String(error?.message??error)}}
  return res;
}

/** Detect when the gate marked a run REVIEWED but the post-hoc audit says FAIL. */
export function gateAuditMismatch(run){
  return run?.v2?.gateStatus==='REVIEWED'&&run?.audit?.status==='FAIL';
}

/** Per-diagram_build_check telemetry from the raw Pi RPC events. Records sizes, statuses, rule names and the svgHash only: never SVG, args or assistant text.
 *  Feed every raw event to onEvent; it returns a {kind:'check',...} record when a diagram_build_check finishes, else null.
 *  failedBlocking = rules that made the check FAIL; failedAdvisory = rules reported as advice (minor). Needs an orchestrator that reports advisoryRules (null otherwise). */
export function createCheckTelemetry(){
  let lastTextLen=0;const pending=new Map();let n=0;
  const textOf=e=>(e.result?.content??[]).filter(c=>c.type==='text').map(c=>c.text).join(' ');
  return {
    onEvent(e){
      if(e?.type==='message_end'&&e.message?.role==='assistant'){
        lastTextLen=(e.message.content??[]).filter(c=>c.type==='text').reduce((s,c)=>s+String(c.text??'').length,0);
        return null;
      }
      if(e?.type==='tool_execution_start'&&e.toolName==='diagram_build_check'){
        pending.set(e.toolCallId??'_',{argsBytes:e.args===undefined?null:Buffer.byteLength(JSON.stringify(e.args)),precedingTextLen:lastTextLen});
        return null;
      }
      if(e?.type==='tool_execution_end'&&e.toolName==='diagram_build_check'){
        const p=pending.get(e.toolCallId??'_')??{argsBytes:null,precedingTextLen:lastTextLen};pending.delete(e.toolCallId??'_');
        let body=null;if(!e.isError){try{body=JSON.parse(textOf(e))}catch{}}
        const names=v=>Array.isArray(v)?v.filter(x=>typeof x==='string'):[];
        return {kind:'check',n:++n,outcome:e.isError?'ERROR':(typeof body?.status==='string'?body.status:'UNPARSED'),
          failedBlocking:names(body?.failed),failedAdvisory:Array.isArray(body?.advisoryRules)?names(body.advisoryRules):null,
          svgHash:typeof body?.svgHash==='string'?body.svgHash:null,argsBytes:p.argsBytes,precedingTextLen:p.precedingTextLen};
      }
      return null;
    },
  };
}
