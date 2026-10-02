// Pure helpers for run-bench.mjs. No network, no model, no browser: unit-tested in bench-lib.test.mjs.
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
    firstAssistantMs:null,specRenders:0,submits:0,sourceFactsIncluded:false,specModeOffered:false,outputTokensBeforeFirstInspection:null,firstInspectionStartMs:null,firstInspectionEndMs:null,rateLimited:false,agentError:null,runDir:null,errors:[]};
  for(const e of events){
    if(e.kind==='notify'){if(/^Source facts included/.test(e.text??''))r.sourceFactsIncluded=true;if(/^Layout spec mode on/.test(e.text??''))r.specModeOffered=true}
    if(e.kind==='notify'&&r.runDir===null){const m=/private work directory:\s*(\S+)/.exec(e.text??'');if(m)r.runDir=m[1]}
    if(e.kind==='tool-start'){r.toolCalls++;if(e.tool==='diagram_render_spec')r.specRenders++;if(e.tool==='diagram_submit')r.submits++;if(e.tool==='diagram_inspect'){r.inspections++;if(r.firstInspectionStartMs===null){r.firstInspectionStartMs=e.tMs;r.outputTokensBeforeFirstInspection=r.outputTokens}}}
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

/** v2 metrics from the orchestrator's run.json (null when the run produced none, e.g. PI_DIAGRAM_V2=0). */
export function summariseManifest(m){
  if(!m||typeof m!=='object')return null;
  const rounds=Array.isArray(m.rounds)?m.rounds:[];
  const met=m.metrics??{};
  return {gateStatus:m.status??null,statusReason:typeof m.statusReason==='string'?m.statusReason.split(':')[0]:null,rounds:rounds.length,reverts:met.reverts??rounds.filter(r=>r.reverted).length,
    authorSeconds:(m.timings?.authorMs??0)/1000,reviewerSeconds:(m.timings?.reviewerMs??0)/1000,
    authorTokens:{input:m.tokens?.author?.input??0,output:m.tokens?.author?.output??0},reviewerTokens:{input:m.tokens?.reviewer?.input??0,output:m.tokens?.reviewer?.output??0},
    reviewerBlockingFindings:rounds.reduce((n,r)=>n+(r.review?.findings??[]).filter(f=>f.severity==='blocking').length,0),
    falseBlockCandidates:met.falseBlockCandidates??0,oscillations:met.oscillations??0,finalSvgSha256:m.finalSvgSha256??null};
}

/** Load and verify the orchestrator's run.json, waiting up to waitMs for it (the agent_end finalisation may land after the run is reported done). */
export async function loadV2Metrics(runDir,{waitMs=60_000,pollMs=500}={}){
  const deadline=Date.now()+waitMs;
  for(;;){
    try{return {v2:summariseManifest(readRunManifest(runDir))}}
    catch(error){
      const message=String(error?.message??error);
      if(message.startsWith('MANIFEST_TAMPERED'))return {v2:null,error:message};
      if(Date.now()>=deadline)return {v2:null,error:'no run.json'};
      await new Promise(r=>setTimeout(r,pollMs));
    }
  }
}

/** Split an audit result into FAIL checks and NOT-CHECKABLE checks (excluding the structural pair). */
export function summariseAudit(audit){
  if(!audit||!audit.checks)return {status:audit?.status??'NO-AUDIT',fail:[],notCheckable:[],error:audit?.error??null};
  const fail=[],notCheckable=[];
  for(const [name,c] of Object.entries(audit.checks)){
    if(c?.status==='FAIL')fail.push(name);
    else if(c?.status==='NOT-CHECKABLE'&&!STRUCTURAL_NOT_CHECKABLE.includes(name))notCheckable.push(name);
  }
  return {status:audit.status,fail,notCheckable,error:null};
}

/** A run is "completed" when the agent ended on its own and no rate limit hit it. Only these enter the timing statistics. */
export const AGENT_DONE_REASONS=['AGENT_SETTLED','AGENT_END_NO_SETTLE','AGENT_END'];
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
  L.push('','## Audit',`FAIL runs: ${summary.fixtures.flatMap(f=>f.auditFailRuns).join(', ')||'none'}`,`NOT-CHECKABLE runs (excluding the structural ${STRUCTURAL_NOT_CHECKABLE.join('/')} pair): ${summary.fixtures.flatMap(f=>f.auditNotCheckableRuns).join(', ')||'none'}`);
  L.push('','## Non-completed runs',summary.nonCompletedRuns.length?summary.nonCompletedRuns.map(r=>`- ${r.id}: ${r.doneReason}`).join('\n'):'none');
  if(summary.rateLimitedRuns.length)L.push('',`Rate-limit signals (error text only): ${summary.rateLimitedRuns.join(', ')}`);
  L.push('');
  return L.join('\n');
}
