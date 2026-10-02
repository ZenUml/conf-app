import { createHash } from 'node:crypto';
const sha = s=>createHash('sha256').update(s,'utf8').digest('hex');
const clean = s=>s.replace(/<br\s*\/?\s*>/gi,'\n').replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const fail=(line,why)=>{throw Error(`UNSUPPORTED_MERMAID_FEATURE line ${line}: ${why}`)};
function nodeSpec(raw,line){
  const s=raw.trim(); const id=s.match(/^[A-Za-z_][\w-]*/)?.[0]; if(!id)fail(line,`node ${s}`);
  const tail=s.slice(id.length).trim(); if(!tail)return {id};
  let shape,text;
  if(tail.startsWith('[(')&&tail.endsWith(')]')){shape='cylinder';text=tail.slice(2,-2)}
  else if(tail.startsWith('[[')&&tail.endsWith(']]')){shape='subroutine';text=tail.slice(2,-2)}
  else if(tail.startsWith('{')&&tail.endsWith('}')){shape='diamond';text=tail.slice(1,-1)}
  else if(tail.startsWith('[')&&tail.endsWith(']')){shape='rect';text=tail.slice(1,-1)}
  else if(tail.startsWith('(')&&tail.endsWith(')')){shape='capsule';text=tail.slice(1,-1)}
  else fail(line,`shape ${tail}`);
  if(text.startsWith('"')&&text.endsWith('"'))text=text.slice(1,-1);
  if(/[<>]/.test(text.replace(/<br\s*\/?\s*>/gi,'')))fail(line,'HTML in node text');
  return {id,text:clean(text),shape};
}
function splitLinks(line,n){
  const re=/\s*(--\s*"([^"]*)"\s*-->|-\.\s*"([^"]*)"\s*\.->|-->|-\.->|~~~)\s*/g;
  const ends=[],links=[];let last=0,m;
  while((m=re.exec(line))){ends.push(line.slice(last,m.index));links.push({style:m[1].startsWith('-.')?'dashed':m[1]==='~~~'?'invisible':'solid',label:m[2]??m[3]??''});last=re.lastIndex}
  if(!links.length)return null;ends.push(line.slice(last));
  if(ends.some(x=>!x.trim()))fail(n,'empty edge endpoint');
  return {ends,links};
}
export function parseMermaid(source){
  if(typeof source!=='string'||source.length>2_000_000)throw Error('UNSUPPORTED_MERMAID_FEATURE: input size');
  const lines=source.replace(/\r\n/g,'\n').split('\n');
  const head=lines.find(x=>x.trim()&&!x.trim().startsWith('%%'))?.trim();
  const direction=head?.match(/^(?:flowchart|graph)\s+(LR|RL|TB|BT)$/)?.[1];
  if(!direction)fail(1,'expected flowchart direction');
  const nodes=new Map(),groups=[],edges=[],palette={},classes=new Map(),stack=[];
  function addNode(spec,n){let prev=nodes.get(spec.id);if(!prev){prev={id:spec.id,text:spec.text??spec.id,shape:spec.shape??'rect',group:spec.text===undefined?null:(stack.at(-1)??null),role:'neutral',order:n,defined:spec.text!==undefined};nodes.set(spec.id,prev)}else if(spec.text!==undefined){if(prev.defined&&prev.text!==spec.text)fail(n,`conflicting text for ${spec.id}`);prev.text=spec.text;prev.shape=spec.shape;prev.group=stack.at(-1)??null;prev.defined=true}return prev}
  for(let i=1;i<lines.length;i++){
    let x=lines[i].trim();if(!x||x.startsWith('%%')||x===head)continue;
    if(x.startsWith('subgraph ')){
      if(stack.length)fail(i+1,'nested subgraphs are not supported');
      let m=x.match(/^subgraph\s+([\w-]+)(?:\[(?:"([^"]*)"|([^\]]+))\])?$/);if(!m)fail(i+1,'subgraph');
      if(groups.some(g=>g.id===m[1]))fail(i+1,'duplicate group');
      groups.push({id:m[1],label:m[2]??m[3]??m[1],parent:stack.at(-1)??null,direction:null,order:i});stack.push(m[1]);continue;
    }
    if(x==='end'){if(!stack.length)fail(i+1,'unmatched end');stack.pop();continue}
    if(x.startsWith('direction ')){let m=x.match(/^direction (LR|RL|TB|BT)$/);if(!m||!stack.length)fail(i+1,'direction');groups.find(g=>g.id===stack.at(-1)).direction=m[1];continue}
    if(x.startsWith('classDef ')){
      const m=x.match(/^classDef\s+([\w-]+)\s+(.+?)\s*;?$/);if(!m)fail(i+1,'classDef');const values={};for(const part of m[2].replace(/;$/,'').split(',')){const k=part.indexOf(':');if(k<1)fail(i+1,'classDef token');values[part.slice(0,k).trim()]=part.slice(k+1).trim()}
      if(!values.fill||!values.stroke)fail(i+1,'classDef fill/stroke required');palette[m[1]]={fill:values.fill,stroke:values.stroke,text:values.color??'#17212b',meaning:m[1]};continue;
    }
    if(x.startsWith('class ')){
      const m=x.match(/^class\s+([\w,-]+)\s+([\w-]+)\s*;?$/);if(!m)fail(i+1,'class');for(const id of m[1].split(','))classes.set(id,m[2]);continue;
    }
    const chain=splitLinks(x,i+1);
    if(chain){if(chain.links.every(link=>link.style==='invisible')){for(const endpoint of chain.ends){const id=nodeSpec(endpoint,i+1).id;if(!groups.some(g=>g.id===id))fail(i+1,`invisible link endpoint ${id} is not a declared group`)}continue}if(chain.links.some(link=>link.style==='invisible'))fail(i+1,'mixed invisible and directed link chain');const ns=chain.ends.map(s=>addNode(nodeSpec(s,i+1),i));for(let j=0;j<chain.links.length;j++){const link=chain.links[j];edges.push({id:`e${edges.length+1}`,source:ns[j].id,target:ns[j+1].id,label:link.label,style:link.style})}continue}
    if(/^[A-Za-z_][\w-]*/.test(x)){addNode(nodeSpec(x,i+1),i);continue}
    fail(i+1,x.slice(0,80));
  }
  if(stack.length)fail(lines.length,'unclosed group');
  for(const node of nodes.values()){const c=classes.get(node.id);if(c){if(!palette[c])fail(node.order+1,`unknown class ${c}`);node.role=c}}
  if(!palette.neutral)palette.neutral={fill:'#f1f5f9',stroke:'#334155',text:'#0f172a',meaning:'Unclassified diagram element'};
  for(const edge of edges){if(!nodes.has(edge.source)||!nodes.has(edge.target))throw Error('SEMANTIC_MISMATCH edge endpoint');}
  return {sourceHash:sha(source),direction,nodes:[...nodes.values()],edges,groups,palette,sourceBytes:Buffer.byteLength(source,'utf8')};
}
