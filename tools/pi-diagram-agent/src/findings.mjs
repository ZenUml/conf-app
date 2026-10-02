// Findings format, ledger, and audit-to-findings mapping for the v2 loop. Pure code: no model, no browser.
import {createHash} from 'node:crypto';

export const FINDING_SOURCES=['audit','review','early'];
export const FINDING_SEVERITIES=['blocking','minor'];

export const findingKey=(rule,elements)=>`${rule}|${[...new Set(elements.map(String))].sort().join(',')}`;

const clip=(v,n=400)=>{const s=typeof v==='string'?v:JSON.stringify(v);return s.length>n?s.slice(0,n-1)+'…':s};
const finiteRegion=r=>r&&['x','y','w','h'].every(k=>Number.isFinite(r[k]))?{x:r.x,y:r.y,w:r.w,h:r.h}:null;

/** Findings format shared by auditor, early checks and reviewer: {id,key,source,severity,rule,elements,region,evidence:{measured,threshold},suggestion}. */
export function makeFinding({source,severity,rule,elements=[],region=null,evidence={},suggestion=''}){
  if(!FINDING_SOURCES.includes(source))throw Error(`FINDING_SOURCE: ${source}`);
  if(!FINDING_SEVERITIES.includes(severity))throw Error(`FINDING_SEVERITY: ${severity}`);
  if(typeof rule!=='string'||!rule)throw Error('FINDING_RULE_REQUIRED');
  const ids=[...new Set(elements.map(String))].sort(),key=findingKey(rule,ids);
  return {id:'F-'+createHash('sha256').update(key).digest('hex').slice(0,8),key,source,severity,rule,elements:ids,region:finiteRegion(region),
    evidence:{...evidence,measured:evidence.measured??null,threshold:evidence.threshold??null},suggestion:String(suggestion)};
}

/** Findings ledger across rounds. States: open | fixed | regressed. Only the sources that ran in a round can mark their findings fixed. */
export function createLedger(){
  const entries=new Map();
  return {
    update(round,findings,{sources=['audit','review','early'],sigOf=null}={}){
      const present=new Map(findings.map(x=>[x.key,x]));
      for(const [key,x] of present){
        const e=entries.get(key);
        if(e&&e.lastSeenRound===round)continue; // idempotent within a round
        const sig=sigOf?sigOf(x):null;
        if(!e){entries.set(key,{key,state:'open',finding:x,firstRound:round,lastSeenRound:round,oscillations:0,falseBlockCandidate:false,lastSig:sig,history:[{round,state:'open'}]});continue}
        const next=e.state==='fixed'||e.state==='regressed'?'regressed':'open';
        if(e.state==='fixed')e.oscillations++;
        e.state=next;e.finding=x;e.lastSeenRound=round;e.lastSig=sig;e.history.push({round,state:next});
      }
      for(const [key,e] of entries){
        if(present.has(key)||e.state==='fixed'||!sources.includes(e.finding.source))continue;
        e.state='fixed';e.history.push({round,state:'fixed'});
        if(e.finding.source==='review'&&e.finding.severity==='blocking'&&sigOf&&e.lastSig!=null&&sigOf(e.finding)===e.lastSig)e.falseBlockCandidate=true;
      }
    },
    get:key=>entries.get(key),
    entries:()=>[...entries.values()],
    open:()=>[...entries.values()].filter(e=>e.state!=='fixed'),
    openBlocking:()=>[...entries.values()].filter(e=>e.state!=='fixed'&&e.finding.severity==='blocking'),
    snapshot:()=>[...entries.values()].map(e=>({key:e.key,id:e.finding.id,source:e.finding.source,severity:e.finding.severity,rule:e.finding.rule,elements:e.finding.elements,state:e.state,firstRound:e.firstRound,lastSeenRound:e.lastSeenRound,oscillations:e.oscillations,falseBlockCandidate:e.falseBlockCandidate,unstable:!!e.finding.unstable,history:e.history})),
  };
}

const rank=e=>(e.state==='regressed'?0:10)+(e.finding.source==='review'?2:e.finding.source==='early'?0:1);

/** At most `max` open blocking findings, regressed first, then mechanical (early, audit) before review. Minor findings are counted, not sent. */
export function selectForAuthor(ledger,{max=5}={}){
  const blocking=ledger.openBlocking().map((e,i)=>({e,i})).sort((a,b)=>rank(a.e)-rank(b.e)||a.i-b.i).map(x=>x.e);
  const minorCount=ledger.open().filter(e=>e.finding.severity==='minor').length;
  return {sent:blocking.slice(0,max).map(e=>({...e.finding,state:e.state})),omittedBlocking:Math.max(0,blocking.length-max),minorCount};
}

export function formatForAuthor(selection){
  return {findings:selection.sent.map(({id,source,severity,rule,elements,region,evidence,suggestion,state})=>({id,source,severity,rule,elements,region,evidence,suggestion,state})),omittedBlocking:selection.omittedBlocking,minorCount:selection.minorCount};
}

// ---- audit -> findings -------------------------------------------------------------------------
const ID_KEYS=new Set(['nodeId','nodeIds','edge','edgeA','edgeB','groupId','groupIds','missing','extra','mismatchedNodeIds','mismatchedEdges','unadjudicatedNodeIds','unboundLabels','malformedEdges','intrudedNodeIds','source','target']);
function collectIds(value,out,key=null){
  if(value==null)return;
  if(typeof value==='string'){if(key&&ID_KEYS.has(key)&&value.length<=120)out.add(value);return}
  if(Array.isArray(value)){for(const v of value)collectIds(v,out,key);return}
  if(typeof value==='object'){
    if(typeof value.source==='string'&&typeof value.target==='string'){out.add(`${value.source}->${value.target}`);return}
    for(const [k,v] of Object.entries(value))collectIds(v,out,k);
  }
}
const SUGGESTIONS={
  svgWellFormed:'Fix the SVG so it parses as well-formed XML, then re-render.',
  nodeIdentity:'Draw every source node exactly once as g[data-node="<id>"]; remove drawn nodes that are not in the source.',
  nodeText:'Make the drawn node text match the source label exactly (whitespace-normalized).',
  relations:'Draw each source relation as one visible path with data-source/data-target bound to its endpoints; remove extra or malformed ones.',
  relationStyle:'Match the source edge style: dashed source relations need a dash array, solid ones none.',
  groups:'Draw each source group as a container with its group id; do not add or drop groups.',
  groupMembership:'Move the listed nodes inside their group outline, or outside it if they are not members.',
  originalGroupParity:'Keep the original render\'s visible group membership; or ask the user for an adjudication.',
  semanticPreservation:'Keep the original visible group membership for the listed nodes (the user has not adjudicated a change).',
  textFit:'Enlarge the node or shorten line breaks so all text sits inside the outline inset by 12 units.',
  labelClearance:'Move the edge label so its box does not touch any node or container outline.',
  routeNodeIntrusion:'Re-route the edge so it stays out of unrelated nodes and starts/ends on its own node outlines.',
  routeHeadingClearance:'Re-route the edge away from the group heading text (2-unit guard).',
  routeUnrelatedContainerTransit:'Re-route the edge so it does not cross a container that contains neither endpoint.',
  markerDrawing:'Give the arrowhead marker a visible fill matching the edge stroke (no context-stroke).',
  routePairClearance:'Separate the listed parallel route spans to at least the required clearance.',
  routeCrossings:'Re-route so the listed edges do not cross; move a bend or port.',
  arrowShaft:'Lengthen the final straight segment before the arrowhead to the required visible shaft.',
};
const fallbackSuggestion=rule=>`Resolve the ${rule} failure shown in the evidence, then re-render.`;

/** Every FAIL check of an auditAgentSvg result becomes one blocking finding. NOT-CHECKABLE and PASS never produce findings. */
export function auditToFindings(audit){
  if(!audit||!audit.checks)return [];
  const out=[];
  for(const [rule,check] of Object.entries(audit.checks)){
    if(check?.status!=='FAIL')continue;
    const ev=check.evidence;
    const ids=new Set();collectIds(ev,ids);
    const method=typeof ev==='object'&&ev&&typeof ev.method==='string'?ev.method:null;
    const detail=typeof ev==='string'?ev:Object.fromEntries(Object.entries(ev??{}).filter(([k])=>k!=='method'&&k!=='reasons'));
    out.push(makeFinding({source:'audit',severity:'blocking',rule,elements:[...ids],region:null,
      evidence:{measured:clip(detail),threshold:method?clip(method,240):'rule check passes (see Diagram Rules)'},
      suggestion:SUGGESTIONS[rule]??fallbackSuggestion(rule)}));
  }
  return out;
}
