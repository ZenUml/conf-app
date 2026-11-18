// Derive exact, measured shared route sections from neutral Chromium facts.
// This module never infers a bus from proximity: every returned portion comes
// from a pairwise sharedSuffix proof and the actual straight L spans of both
// paths after a supported root-space transform.
import {parseOrthogonalRoute} from './route-lower-bend.mjs';
import {sharedSuffix} from './trunk.mjs';

const EPS=1e-6;
const MAX_FACTS=300;
const MAX_PAIR_CHECKS=50_000;
const MAX_PORTIONS=200_000;
const MAX_CLIQUES=4_096;
const MAX_PATH_LENGTH=1_000_000;
const MAX_SPANS=20_000;
const TOKEN_RE=/\s*,?\s*([MLQA]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/y;

const finite=v=>typeof v==='number'&&Number.isFinite(v);
const close=(a,b)=>Math.abs(a-b)<=EPS;
const round=v=>Math.round(v*1e6)/1e6;

function tokenize(path){
  if(typeof path!=='string'||!path.trim()||path.length>MAX_PATH_LENGTH)return null;
  const tokens=[];let at=0;
  while(at<path.length){
    TOKEN_RE.lastIndex=at;
    const match=TOKEN_RE.exec(path);
    if(!match)return path.slice(at).trim()?null:(tokens.length?tokens:null);
    tokens.push(match[1]);at=TOKEN_RE.lastIndex;
  }
  return tokens.length?tokens:null;
}

/** Collect only actual L commands. Q/A fillet regions are deliberately absent. */
function actualStraightSpans(path){
  const tokens=tokenize(path);if(!tokens)return null;
  let at=0,point=null,lastCommand=null,spans=[];
  while(at<tokens.length){
    const command=tokens[at++],arity={M:2,L:2,Q:4,A:7}[command];
    if(!arity||at+arity>tokens.length)return null;
    const args=tokens.slice(at,at+arity).map(Number);at+=arity;
    if(!args.every(finite))return null;
    if(command==='M'){
      if(point)return null; // multiple subpaths are unsupported by the route proof
      point=[args[0],args[1]];lastCommand=command;continue;
    }
    if(!point)return null;
    const next=command==='L'?[args[0],args[1]]:command==='Q'?[args[2],args[3]]:[args[5],args[6]];
    if(command==='L'){
      const dx=next[0]-point[0],dy=next[1]-point[1];
      const axis=Math.abs(dy)<=EPS?'h':Math.abs(dx)<=EPS?'v':null;
      if(!axis)return null;
      const start=axis==='h'?point[0]:point[1],end=axis==='h'?next[0]:next[1];
      if(Math.abs(end-start)>EPS)spans.push({axis,fixed:axis==='h'?point[1]:point[0],lo:Math.min(start,end),hi:Math.max(start,end),dir:Math.sign(end-start)});
    }
    point=next;lastCommand=command;
  }
  if(spans.length>MAX_SPANS)return null;
  return {spans,lastCommand};
}

function transformOf(value){
  if(!value||typeof value!=='object')return null;
  const m={a:Number(value.a),b:Number(value.b),c:Number(value.c),d:Number(value.d),e:Number(value.e),f:Number(value.f)};
  if(!Object.values(m).every(finite)||Math.abs(m.b)>EPS||Math.abs(m.c)>EPS||m.a<=EPS||m.d<=EPS)return null;
  if(Math.abs(m.a-m.d)>EPS*Math.max(1,m.a,m.d))return null;
  return m;
}

function transformPoint(point,m){return [m.a*point[0]+m.e,m.d*point[1]+m.f]}
function transformSpan(span,m){
  if(span.axis==='h')return {...span,fixed:m.d*span.fixed+m.f,lo:m.a*span.lo+m.e,hi:m.a*span.hi+m.e};
  return {...span,fixed:m.a*span.fixed+m.e,lo:m.d*span.lo+m.f,hi:m.d*span.hi+m.f};
}

function markerEndOf(style){
  if(!style||typeof style!=='object')return null;
  return style.markerEnd??style['marker-end']??style.marker??style.markerId??style.endGeometry??null;
}

function scaledDash(value,scale){
  if(value===null||value===undefined)return null;
  if(Array.isArray(value))return value.map(Number).every(finite)?value.map(Number).map(part=>round(part*scale)).join(' '):String(value);
  const text=String(value).trim();
  if(!text||text==='none')return text||null;
  const numbers=text.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if(!numbers)return text;
  return numbers.map(part=>round(Number(part)*scale)).join(' ');
}

function styleOf(style,scale=1){
  if(!style||typeof style!=='object')return null;
  const width=round(Number(style.width)*scale);
  if(!finite(width)||width<0)return null;
  const rawVectorEffect=style.vectorEffect??style.vector_effect??style['vector-effect'];
  const vectorEffect=rawVectorEffect===undefined||rawVectorEffect===null?'none':String(rawVectorEffect).trim().toLowerCase();
  // Width/dash scaling below is valid only for ordinary SVG strokes. A
  // non-scaling stroke has different root-space rendering semantics, so it
  // must not participate in a shared-section proof until measured explicitly.
  if(vectorEffect!=='none')return null;
  const value={
    dash:scaledDash(style.dash,scale),
    width,
    stroke:style.stroke??null,
    markerEnd:markerEndOf(style),
    vectorEffect,
    linecap:style.linecap??style.lineCap??style['stroke-linecap']??null,
    linejoin:style.linejoin??style.lineJoin??style['stroke-linejoin']??null,
    miterlimit:style.miterlimit??style.miterLimit??style['stroke-miterlimit']??null,
  };
  return value;
}

function styleKey(style){
  return [style?.dash,style?.width,style?.stroke,style?.markerEnd,style?.vectorEffect,style?.linecap,style?.linejoin,style?.miterlimit].map(value=>JSON.stringify(value)).join('|');
}

function sameStyle(a,b){
  return a&&b&&a.dash===b.dash&&a.width===b.width&&a.stroke===b.stroke&&a.markerEnd===b.markerEnd&&a.vectorEffect===b.vectorEffect&&a.linecap===b.linecap&&a.linejoin===b.linejoin&&a.miterlimit===b.miterlimit;
}

function prepare(fact){
  if(!fact||fact.id===undefined||fact.id===null||fact.source===undefined||fact.target===undefined)return null;
  const family=fact.trunk??fact.family;
  if(family===undefined||family===null||String(family)==='')return null;
  const path=fact.path??fact.d;
  if(typeof path!=='string'||path.length>MAX_PATH_LENGTH)return null;
  const parsed=parseOrthogonalRoute(path);
  if(!parsed||parsed.error)return null;
  const actual=actualStraightSpans(path),transform=transformOf(fact.rootTransform),style=transform&&styleOf(fact.style,transform.a);
  if(!actual||!actual.spans.length||actual.lastCommand!=='L'||!transform||!style)return null;
  const points=parsed.points.map(point=>transformPoint(point,transform));
  const spans=actual.spans.map(span=>transformSpan(span,transform));
  return {
    ...fact,
    id:String(fact.id),
    source:String(fact.source),
    target:String(fact.target),
    trunk:String(family),
    family:String(family),
    path,
    points,
    spans,
    style,
    trim:parsed.trim*transform.a,
    lastCommand:fact.lastCommand??actual.lastCommand,
  };
}

function sameEndpoint(a,b){
  const ap=a.points.at(-1),bp=b.points.at(-1);
  return !!ap&&!!bp&&close(ap[0],bp[0])&&close(ap[1],bp[1]);
}

function intervalHits(section,spans){
  return spans.filter(span=>span.axis===section.axis&&span.dir===section.dir&&close(span.fixed,section.fixed)).map(span=>({
    axis:section.axis,
    fixed:(span.fixed+section.fixed)/2,
    dir:section.dir,
    lo:Math.max(span.lo,section.lo),
    hi:Math.min(span.hi,section.hi),
  })).filter(hit=>hit.hi-hit.lo>EPS);
}

function pairIntervals(a,b){
  if(a.target!==b.target||a.family!==b.family||!sameStyle(a.style,b.style)||!sameEndpoint(a,b))return [];
  const suffix=sharedSuffix(a,b);if(!suffix)return [];
  const out=[];
  for(const section of suffix.sections??[]){
    const left=intervalHits(section,a.spans),right=intervalHits(section,b.spans);
    for(const x of left)for(const y of right){
      const lo=Math.max(x.lo,y.lo),hi=Math.min(x.hi,y.hi);
      if(hi-lo>EPS)out.push({family:a.family,target:a.target,styleKey:styleKey(a.style),axis:section.axis,fixed:(x.fixed+y.fixed)/2,dir:section.dir,lo,hi,pair:[a.id,b.id].sort()});
    }
  }
  return out;
}

function uniqueNumbers(values){
  return [...values].sort((a,b)=>a-b).filter((value,index,all)=>index===0||Math.abs(value-all[index-1])>EPS);
}

function maximalCliques(vertices,edges){
  const adjacent=new Map(vertices.map(v=>[v,new Set()]));
  for(const [a,b] of edges){adjacent.get(a)?.add(b);adjacent.get(b)?.add(a)}
  const found=[];let exhausted=false;
  const visit=(chosen,candidates,excluded)=>{
    if(exhausted)return;
    if(!candidates.size&&!excluded.size){if(chosen.length>=2)found.push([...chosen].sort());return}
    const pivot=[...new Set([...candidates,...excluded])].sort()[0];
    const skip=adjacent.get(pivot)??new Set();
    for(const vertex of [...candidates].filter(v=>!skip.has(v)).sort()){
      if(found.length>=MAX_CLIQUES){exhausted=true;return}
      const nextCandidates=new Set([...candidates].filter(v=>adjacent.get(vertex)?.has(v)));
      const nextExcluded=new Set([...excluded].filter(v=>adjacent.get(vertex)?.has(v)));
      visit([...chosen,vertex],nextCandidates,nextExcluded);
      candidates.delete(vertex);excluded.add(vertex);
    }
  };
  visit([],new Set(vertices),new Set());
  if(exhausted)return [];
  return [...new Map(found.map(clique=>[clique.join('\0'),clique])).values()].sort((a,b)=>a.join('\0').localeCompare(b.join('\0')));
}

function pointsFor(section,lo,hi){
  const fixed=round(section.fixed),start=section.dir>0?lo:hi,end=section.dir>0?hi:lo;
  const p1=section.axis==='h'?[start,fixed]:[fixed,start],p2=section.axis==='h'?[end,fixed]:[fixed,end];
  return [p1.map(round),p2.map(round)];
}

/**
 * Return exact shared straight portions proved by pairwise same-target,
 * same-family suffixes. Every section is in root coordinates and has the
 * exact member set for that atomic interval.
 */
export function deriveSharedSections(facts){
  if(!Array.isArray(facts)||facts.length<2||facts.length>MAX_FACTS)return [];
  const rawIds=facts.filter(fact=>fact?.id!==undefined&&fact?.id!==null).map(fact=>String(fact.id));
  if(new Set(rawIds).size!==rawIds.length)return [];
  const routes=facts.map(prepare).filter(Boolean);
  const portions=[];
  let pairChecks=0;
  for(let i=0;i<routes.length;i++)for(let j=i+1;j<routes.length;j++){
    if(++pairChecks>MAX_PAIR_CHECKS)return [];
    portions.push(...pairIntervals(routes[i],routes[j]));
    if(portions.length>MAX_PORTIONS)return [];
  }
  if(!portions.length)return [];
  const buckets=new Map();
  for(const portion of portions){
    const key=[portion.family,portion.target,portion.styleKey,portion.axis,round(portion.fixed),portion.dir].join('\0');
    const bucket=buckets.get(key)??{...portion,intervals:[]};
    bucket.intervals.push(portion);buckets.set(key,bucket);
  }
  const sections=[];
  for(const bucket of buckets.values()){
    const endpoints=uniqueNumbers(bucket.intervals.flatMap(interval=>[interval.lo,interval.hi]));
    for(let i=0;i<endpoints.length-1;i++){
      const lo=endpoints[i],hi=endpoints[i+1];if(hi-lo<=EPS)continue;
      const mid=(lo+hi)/2;
      const active=bucket.intervals.filter(interval=>interval.lo<=mid+EPS&&interval.hi>=mid-EPS);
      const vertices=[...new Set(active.flatMap(interval=>interval.pair))].sort();
      const edges=[...new Map(active.map(interval=>[interval.pair.join('\0'),interval.pair])).values()];
      for(const members of maximalCliques(vertices,edges)){
        const section={family:bucket.family,target:bucket.target,axis:bucket.axis,fixed:bucket.fixed,dir:bucket.dir,lo,hi,members};
        sections.push({id:`shared:${bucket.family}:${bucket.target}:${bucket.axis}:${round(bucket.fixed)}:${round(lo)}-${round(hi)}:${members.join(',')}`,family:bucket.family,members,points:pointsFor(section,lo,hi)});
      }
    }
  }
  return sections.sort((a,b)=>a.id.localeCompare(b.id));
}
