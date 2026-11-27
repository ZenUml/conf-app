// Pure policy checks over measured SVG geometry.  These helpers deliberately
// consume neutral boxes/spans supplied by the browser auditor; they do not
// parse SVG or infer semantic layout from coordinates.
import {BOX_RULES_PROFILE} from './rules-profile.mjs';

export const GEOMETRY_EPS=1e-6;

const finite=v=>typeof v==='number'&&Number.isFinite(v);
const numeric=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const round=v=>Math.round(v*1000)/1000;
const edgeId=edge=>edge?.id??(edge?.source!==undefined&&edge?.target!==undefined?`${edge.source}->${edge.target}`:null);
const outlineIsRect=outline=>outline==='rect'||outline==='rectangle';

function normaliseBox(value){
  const box=Array.isArray(value)&&value.length===4?{x:value[0],y:value[1],w:value[2],h:value[3]}:value;
  if(!box||![box.x,box.y,box.w,box.h].every(finite))return null;
  if(box.w<=GEOMETRY_EPS||box.h<=GEOMETRY_EPS)return null;
  const x0=Math.min(box.x,box.x+box.w),x1=Math.max(box.x,box.x+box.w);
  const y0=Math.min(box.y,box.y+box.h),y1=Math.max(box.y,box.y+box.h);
  return {x0,x1,y0,y1};
}

function idOf(value){
  if(value&&typeof value==='object')return value.id??value.groupId??value.nodeId??value.value??null;
  return value;
}

function idsOf(value){
  if(!Array.isArray(value))return [];
  return value.map(idOf).filter(value=>value!==undefined&&value!==null).map(String);
}

function cornerRadii(group,box){
  const raw=group?.cornerRadius??group?.radius;
  if(raw===undefined||raw===null)return {rx:0,ry:0,valid:true};
  const rx=numeric(typeof raw==='object'?(raw.rx??raw.x??raw.width??0):raw);
  const ry=numeric(typeof raw==='object'?(raw.ry??raw.y??raw.height??rx??0):raw);
  if(rx===null||ry===null||rx<0||ry<0)return {rx:0,ry:0,valid:false};
  const width=box.x1-box.x0,height=box.y1-box.y0;
  return {rx,ry,valid:rx<=width/2+GEOMETRY_EPS&&ry<=height/2+GEOMETRY_EPS};
}

function strokeWidth(value){
  const n=numeric(value);
  return n!==null&&n>=0?n:0;
}

function intervalOverlap(a0,a1,b0,b1){
  return Math.min(Math.max(a0,a1),Math.max(b0,b1))-Math.max(Math.min(a0,a1),Math.min(b0,b1));
}

function sidesOf(box,strokeWidth=0,{rx=0,ry=0}={}){
  return [
    {side:'top',axis:'h',fixed:box.y0,lo:box.x0+rx,hi:box.x1-rx,strokeWidth},
    {side:'bottom',axis:'h',fixed:box.y1,lo:box.x0+rx,hi:box.x1-rx,strokeWidth},
    {side:'left',axis:'v',fixed:box.x0,lo:box.y0+ry,hi:box.y1-ry,strokeWidth},
    {side:'right',axis:'v',fixed:box.x1,lo:box.y0+ry,hi:box.y1-ry,strokeWidth},
  ];
}

function measuredSpan(span){
  if(!span||!['h','v'].includes(span.axis)||![span.fixed,span.lo,span.hi].every(finite))return null;
  if(Math.abs(span.hi-span.lo)<=GEOMETRY_EPS)return null;
  return {axis:span.axis,fixed:span.fixed,lo:Math.min(span.lo,span.hi),hi:Math.max(span.lo,span.hi)};
}

function relationFor(group,edge,nodesById){
  const groupId=String(group?.id??'');
  const ancestorsOf=node=>{
    if(!node)return new Set();
    const explicit=node.ancestors??node.groupPath??node.groups;
    const out=new Set(idsOf(explicit));
    if(node.group!==undefined&&node.group!==null)out.add(String(idOf(node.group)));
    if(node.groupId!==undefined&&node.groupId!==null)out.add(String(idOf(node.groupId)));
    return out;
  };
  const getNode=id=>nodesById.get(String(idOf(id)));
  const source=getNode(edge?.source),target=getNode(edge?.target);
  const sourceAnc=ancestorsOf(source),targetAnc=ancestorsOf(target);
  if(!sourceAnc.size&&!targetAnc.size){
    const box=normaliseBox(group?.box);
    const contains=(outer,inner)=>!!outer&&!!inner&&inner.x0>=outer.x0-GEOMETRY_EPS&&inner.y0>=outer.y0-GEOMETRY_EPS&&inner.x1<=outer.x1+GEOMETRY_EPS&&inner.y1<=outer.y1+GEOMETRY_EPS;
    for(const endpoint of ['source','target']){
      const node=getNode(edge?.[endpoint]);
      const nodeBox=normaliseBox(node?.box??node?.bbox);
      if(contains(box,nodeBox))(endpoint==='source'?sourceAnc:targetAnc).add(groupId);
    }
  }
  const sourceHas=sourceAnc.has(groupId),targetHas=targetAnc.has(groupId);
  return sourceHas&&targetHas?'both-ancestor':sourceHas?'source-ancestor':targetHas?'target-ancestor':'unrelated';
}

/**
 * Detailed pure boundary comparison for one measured straight span and one
 * rectangular side. Positive longitudinal overlap is required. The normal
 * tolerance includes half of each painted stroke, so a centerline can be
 * offset by the combined stroke radii and still coincide with the side.
 */
export function boundaryCoincidence(span,side,{edgeStrokeWidth=span?.strokeWidth??0,groupStrokeWidth=side?.strokeWidth??0,eps=GEOMETRY_EPS}={}){
  const s=measuredSpan(span);
  if(!s||!side||!['h','v'].includes(side.axis)||![side.fixed,side.lo,side.hi].every(finite))return {coincident:false,overlap:0,distance:null,reason:'unsupported span or side'};
  if(s.axis!==side.axis)return {coincident:false,overlap:0,distance:null,reason:'perpendicular crossing'};
  const overlap=intervalOverlap(s.lo,s.hi,side.lo,side.hi),distance=Math.abs(s.fixed-side.fixed);
  const allowance=(strokeWidth(edgeStrokeWidth)+strokeWidth(groupStrokeWidth))/2;
  return {coincident:overlap>eps&&distance<=allowance+eps,overlap:Math.max(0,overlap),distance,allowance};
}

/** Boolean form for route-witness feasibility checks. */
export function isBoundaryCoincident(span,side,options={}){
  return boundaryCoincidence(span,side,options).coincident;
}

/**
 * Check every measured straight route span against every rectangular group
 * side. Source/target ancestor groups are intentionally included; this rule
 * has no short-overlap or required-crossing waiver.
 */
export function checkRouteBoundaryCoincidence({groups=[],nodes=[],edges=[]}={}){
  const violations=[],notCheckable=[];
  const rects=[];
  for(const group of Array.isArray(groups)?groups:[]){
    const box=normaliseBox(group?.box);
    const radii=box?cornerRadii(group,box):{valid:false};
    if(!box||!outlineIsRect(group?.outline)||group?.axisAligned===false||!radii.valid){
      notCheckable.push({group:group?.id??null,reason:'group outline is not a measured rectangle'});
      continue;
    }
    rects.push({...group,_box:box,_sides:sidesOf(box,strokeWidth(group.strokeWidth),radii)});
  }
  const nodeList=Array.isArray(nodes)?nodes:[],nodesById=new Map(nodeList.filter(n=>n?.id!==undefined).map(n=>[String(n.id),n]));
  for(const edge of Array.isArray(edges)?edges:[]){
    const id=edgeId(edge);
    if(id===null){notCheckable.push({edge:null,reason:'edge id or source/target relation is unavailable'});continue}
    const spans=edge?.spans;
    if(!Array.isArray(spans)){
      notCheckable.push({edge:id,reason:'route straight spans are unavailable'});
      continue;
    }
    const validSpans=[];
    for(const raw of spans){
      const span=measuredSpan(raw);
      if(!span){notCheckable.push({edge:id,reason:'route contains an unsupported or degenerate straight span'});continue}
      validSpans.push({...span,strokeWidth:strokeWidth(raw.strokeWidth??edge.strokeWidth)});
    }
    if(!spans.length){notCheckable.push({edge:id,reason:'route straight spans are empty'});continue}
    if(!validSpans.length)continue;
    for(const group of rects)for(const side of group._sides)for(const span of validSpans){
      const hit=boundaryCoincidence(span,side,{edgeStrokeWidth:span.strokeWidth,groupStrokeWidth:group.strokeWidth});
      if(!hit.coincident)continue;
      violations.push({edge:id,group:group.id,side:side.side,overlap:round(hit.overlap),distance:round(hit.distance),strokeAllowance:round(hit.allowance),relation:relationFor(group,edge,nodesById)});
    }
  }
  const method='actual measured orthogonal centerline spans versus every measured rectangular group side; positive-length collinear overlap is a failure after half the painted edge/group stroke widths are applied; perpendicular point crossings, short-length cutoffs and required-crossing exemptions are not used; source/target ancestor groups remain checked';
  const status=violations.length?'FAIL':notCheckable.length?'NOT-CHECKABLE':'PASS';
  return {status,evidence:{method,violations,notCheckable,checkedGroups:rects.length,checkedEdges:(Array.isArray(edges)?edges:[]).filter(e=>Array.isArray(e?.spans)).length}};
}

function explicitAncestors(group){
  const out=new Set(idsOf(group?.ancestors));
  for(const key of ['parentId','parent','parentGroup'])if(group?.[key]!==undefined&&group?.[key]!==null){const value=idOf(group[key]);if(value!==undefined&&value!==null)out.add(String(value))}
  return out;
}

function childrenOf(group){return group?.children??group?.childIds??group?.memberGroupIds??group?.members}

function declaredNesting(a,b,groupsById){
  const aId=String(a?.id??''),bId=String(b?.id??'');
  // An ancestor declaration can be transitive; follow only explicit links.
  const reaches=(start,target)=>{
    const seen=new Set(),queue=[String(start)];
    while(queue.length){const id=queue.shift();if(id===target)return true;if(seen.has(id))continue;seen.add(id);const g=groupsById.get(id);if(!g)continue;for(const p of explicitAncestors(g))queue.push(p)}
    return false;
  };
  const aDescendsFromB=explicitAncestors(a).has(bId)||idsOf(childrenOf(b)).includes(aId)||reaches(aId,bId);
  const bDescendsFromA=explicitAncestors(b).has(aId)||idsOf(childrenOf(a)).includes(bId)||reaches(bId,aId);
  if(aDescendsFromB&&bDescendsFromA)return 'cycle';
  if(aDescendsFromB)return 'b-ancestor';
  if(bDescendsFromA)return 'a-ancestor';
  return null;
}

function expandedBox(group){
  const b=normaliseBox(group?.box);if(!b)return null;
  const pad=strokeWidth(group?.strokeWidth)/2;
  return {x:b.x0-pad,y:b.y0-pad,w:b.x1-b.x0+2*pad,h:b.y1-b.y0+2*pad};
}

/**
 * Detect overlapping group outlines. Geometric containment alone is never
 * treated as intentional nesting; an explicit ancestor/member declaration is
 * required to suppress a pair.
 */
export function checkSiblingGroupOverlap({groups=[]}={}){
  const violations=[],notCheckable=[],nestedPairs=[];
  const list=Array.isArray(groups)?groups:[],groupsById=new Map(list.filter(g=>g?.id!==undefined).map(g=>[String(g.id),g]));
  const usable=[];
  for(const group of list){
    if(!normaliseBox(group?.box)||!outlineIsRect(group?.outline)){
      notCheckable.push({group:group?.id??null,reason:'group outline is not a measured rectangle'});
      continue;
    }
    usable.push({...group,_box:expandedBox(group)});
  }
  const overlap=(a,b)=>{
    const x0=Math.max(a.x,b.x),y0=Math.max(a.y,b.y),x1=Math.min(a.x+a.w,b.x+b.w),y1=Math.min(a.y+a.h,b.y+b.h);
    return x1-x0>GEOMETRY_EPS&&y1-y0>GEOMETRY_EPS?{x:x0,y:y0,w:x1-x0,h:y1-y0,area:(x1-x0)*(y1-y0)}:null;
  };
  for(let i=0;i<usable.length;i++)for(let j=i+1;j<usable.length;j++){
    const a=usable[i],b=usable[j],hit=overlap(a._box,b._box);if(!hit)continue;
    const nesting=declaredNesting(a,b,groupsById);
    if(nesting==='cycle'){
      notCheckable.push({groupA:a.id,groupB:b.id,reason:'explicit hierarchy contains a contradictory cycle'});
      continue;
    }
    if(nesting){nestedPairs.push({ancestor:nesting==='a-ancestor'?a.id:b.id,descendant:nesting==='a-ancestor'?b.id:a.id,overlap:{x:round(hit.x),y:round(hit.y),w:round(hit.w),h:round(hit.h)}});continue}
    violations.push({groupA:a.id,groupB:b.id,overlap:{x:round(hit.x),y:round(hit.y),w:round(hit.w),h:round(hit.h)},overlapArea:round(hit.area)});
  }
  const method='actual measured rectangular group boxes, expanded by half the painted outline stroke; positive-area overlap fails; touching edges/corners pass; only explicit ancestor/member declarations suppress an overlap, never geometric containment alone';
  const status=violations.length?'FAIL':notCheckable.length?'NOT-CHECKABLE':'PASS';
  return {status,evidence:{method,violations,notCheckable,nestedPairs,checkedGroups:usable.length}};
}

const TIER_ALIASES=Object.freeze({compact:0,standard:1,wide:2,extra:3});
const tiers=BOX_RULES_PROFILE.sizingContract.tiers;
const gridStep=BOX_RULES_PROFILE.gridStep;

function boxOfNode(node){return normaliseBox(node?.box??node?.bbox??node?.outline)}
function labelBoxOfNode(node){
  const raw=node?.labelBox??node?.label?.box??node?.declaredLabelBox??null;
  return {raw,box:normaliseBox(raw)};
}
function shapeOfNode(node){return node?.shape??node?.dataShape??node?.dataShapeName??null}
function sizeDeclaration(node){
  const size=node?.size&&typeof node.size==='object'?node.size:{};
  return {
    family:node?.sizeFamily??size.family??null,
    tier:node?.sizeTier??size.tier??null,
    extension:node?.sizeExtension??size.extension??node?.extensionSteps??size.extensionSteps??null,
    layer:node?.layer??size.layer??null,
    group:node?.group??node?.groupId??size.group??null,
  };
}

function tierIndex(value){
  if(typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<tiers.length)return value;
  const text=String(value??'').trim().toLowerCase();
  if(Object.hasOwn(TIER_ALIASES,text))return TIER_ALIASES[text];
  return null;
}

function extensionSteps(value){
  if(value===null||value===undefined)return {width:0,height:0,provided:false,valid:true};
  if(typeof value==='number')return Number.isInteger(value)&&value>=0?{width:value,height:value,provided:true,valid:true}:{width:0,height:0,provided:true,valid:false};
  if(Array.isArray(value)){
    const [width,height=value[0]]=value.map(Number);
    return Number.isInteger(width)&&Number.isInteger(height)&&width>=0&&height>=0?{width,height,provided:true,valid:true}:{width:0,height:0,provided:true,valid:false};
  }
  if(typeof value==='object'){
    const width=Number(value.width??value.w??value.widthSteps??value.x??0),height=Number(value.height??value.h??value.heightSteps??value.y??width);
    return Number.isInteger(width)&&Number.isInteger(height)&&width>=0&&height>=0?{width,height,provided:true,valid:true}:{width:0,height:0,provided:true,valid:false};
  }
  return {width:0,height:0,provided:true,valid:false};
}

function contextKey(node,decl,extension={width:0,height:0}){
  const tier=tierIndex(decl.tier)??String(decl.tier).toLowerCase();
  // Explicit extensions define a distinct measured size while preserving the
  // same semantic family/tier.  Group membership is intentionally excluded:
  // peers can span groups when their declared size contract is comparable.
  return `${decl.family}|${shapeOfNode(node)}|${tier}|${extension.width}x${extension.height}|${decl.layer??''}`;
}

/**
 * Check declared node-size contracts against a measured/proven labelBox and
 * independently measured outer outline boxes. The profile's tier dimensions
 * and grid step are the single source of truth; undeclared dimensions are
 * reported as advisory/NOT-CHECKABLE and are never assigned a business tier
 * from geometry alone.
 */
export function checkBoxSizeConsistency({nodes=[]}={}){
  const violations=[],notCheckable=[],advisories=[],peerGroups=new Map();
  const list=Array.isArray(nodes)?nodes:[];
  const method='actual measured label boxes against explicit sizeFamily + sizeTier declarations and the package rules profile tiers; label-box extensions use whole profile grid steps; actual outline boxes are compared independently across declared family/shape/tier/extension/layer peers; geometric size alone never infers business meaning';
  for(const node of list){
    const id=node?.id??null,box=boxOfNode(node),label=labelBoxOfNode(node),shape=shapeOfNode(node),decl=sizeDeclaration(node);
    if(!box){
      notCheckable.push({node:id,reason:'node outline box is unavailable or non-numeric'});
      advisories.push({kind:'missing-outline-box',node:id,suggestion:'provide the actual measured node outline box before checking size consistency'});
      continue;
    }
    const outlineActual={width:box.x1-box.x0,height:box.y1-box.y0};
    const labelIssue=label.raw===null||label.raw===undefined?'missing':!label.box?'unsupported':null;
    if(labelIssue==='missing'){
      notCheckable.push({node:id,reason:'measured/proven labelBox is unavailable'});
      advisories.push({kind:'missing-label-box',node:id,measured:outlineActual,suggestion:'provide the measured or independently proven labelBox; never infer it from the outer outline'});
    }else if(labelIssue==='unsupported'){
      notCheckable.push({node:id,reason:'measured/proven labelBox is unsupported or non-positive'});
      advisories.push({kind:'unsupported-label-box',node:id,measured:outlineActual,suggestion:'provide a finite positive labelBox measured in root coordinates'});
    }
    if(!decl.family||decl.tier===null||decl.tier===undefined||!shape){
      notCheckable.push({node:id,reason:'explicit sizeFamily, sizeTier and shape declaration is required'});
      advisories.push({kind:'missing-size-declaration',node:id,group:decl.group??node?.groupId??null,shape:shape??null,measured:outlineActual,labelBox:label.box?{width:label.box.x1-label.box.x0,height:label.box.y1-label.box.y0}:null,suggestion:'declare sizeFamily, sizeTier and shape before using dimensions as a semantic size contract'});
      continue;
    }
    const tier=tierIndex(decl.tier);
    if(tier===null){notCheckable.push({node:id,reason:`unknown sizeTier ${String(decl.tier)}`});continue}
    const ext=extensionSteps(decl.extension);
    if(!ext.valid){violations.push({node:id,kind:'invalid-size-extension',sizeExtension:decl.extension,gridStep});continue}
    const key=contextKey(node,decl,ext),peer=peerGroups.get(key)??{key,sizeFamily:decl.family,shape,sizeTier:decl.tier,extensionSteps:{width:ext.width,height:ext.height},layer:decl.layer??null,nodes:[],dimensions:[]};
    peer.nodes.push(id);peer.dimensions.push(outlineActual);peerGroups.set(key,peer);
    if(labelIssue)continue;
    const [baseW,baseH]=tiers[tier],expected={width:baseW+ext.width*gridStep,height:baseH+ext.height*gridStep},labelActual={width:label.box.x1-label.box.x0,height:label.box.y1-label.box.y0};
    const mismatch=Math.abs(labelActual.width-expected.width)>GEOMETRY_EPS||Math.abs(labelActual.height-expected.height)>GEOMETRY_EPS;
    if(mismatch)violations.push({node:id,kind:'size-mismatch',subject:'labelBox',sizeFamily:decl.family,shape,sizeTier:decl.tier,expected,actual:labelActual,outline: outlineActual,extensionSteps:{width:ext.width,height:ext.height},gridStep});
  }
  for(const peer of peerGroups.values()){
    const first=peer.dimensions[0];
    if(peer.dimensions.some(dim=>Math.abs(dim.width-first.width)>GEOMETRY_EPS||Math.abs(dim.height-first.height)>GEOMETRY_EPS))violations.push({kind:'peer-size-mismatch',subject:'outline',key:peer.key,sizeFamily:peer.sizeFamily,shape:peer.shape,sizeTier:peer.sizeTier,extensionSteps:peer.extensionSteps,layer:peer.layer,nodes:peer.nodes,dimensions:peer.dimensions});
  }
  // Group+shape is useful for a review hint, but without an explicit size
  // declaration it is only advisory and never certifies a semantic tier.
  const observed=new Map();
  for(const node of list){const box=boxOfNode(node),shape=shapeOfNode(node),decl=sizeDeclaration(node);if(!box||!shape||decl.family||decl.tier!==null&&decl.tier!==undefined)continue;const key=`${decl.group??node?.groupId??node?.groupPath?.join('/')??''}|${shape}`;const a=observed.get(key)??[];a.push(node.id??null);observed.set(key,a)}
  for(const [key,nodeIds] of observed)if(nodeIds.length>1)advisories.push({kind:'undeclared-peer-group',key,nodes:nodeIds,suggestion:'peer grouping by actual group and shape is advisory until each node declares sizeFamily and sizeTier'});
  const status=violations.length?'FAIL':notCheckable.length?'NOT-CHECKABLE':'PASS';
  return {status,evidence:{method,violations,notCheckable,advisories,peerGroups:[...peerGroups.values()],tiers:tiers.map(([width,height],index)=>({index,width,height})),tierAliases:TIER_ALIASES,gridStep,checkedNodes:list.length}};
}
