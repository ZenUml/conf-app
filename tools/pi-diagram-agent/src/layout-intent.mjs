// The main Pi model plans; code freezes the source-bound contract before authoring.
import {createHash} from 'node:crypto';
export const hashLayoutIntent=record=>createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(record).filter(([key])=>key!=='hash')))).digest('hex');
const fail=message=>{throw Error(`LAYOUT_CONTRACT_INVALID: ${message}`)};
const text=(value,name)=>{if(typeof value!=='string'||!value.trim()||value.length>4000)fail(name+' must be nonempty text')};
export function validateLayoutIntent(intent,model){
  if(!model?.nodes?.length)fail('source facts unavailable');
  if(model.conflicts?.length||model.membershipConflicts?.length)fail('source facts contain unresolved conflicts or unsupported statements');
  if(Buffer.byteLength(JSON.stringify(intent)??'')>128000)fail('intent exceeds 128 KB');
  if(!intent||typeof intent!=='object')fail('intent must be an object');
  for(const key of ['purpose','readingOrder','layoutGrammar'])text(intent[key],key);
  const ids=new Set(model.nodes.map(n=>n.id)),seen=new Set();
  if(!Array.isArray(intent.nodes))fail('nodes must cover every source node');
  for(const n of intent.nodes){
    if(!ids.has(n.id)||seen.has(n.id))fail('unknown or duplicate node '+n.id);seen.add(n.id);
    text(n.role,'role');text(n.layer,'layer');
    const source=model.nodes.find(x=>x.id===n.id),groups=source.groupPath??(source.group?[source.group]:[]);
    if(JSON.stringify(n.groupPath)!==JSON.stringify(groups))fail('group membership changed for '+n.id);
    if(!Array.isArray(n.peers)||new Set(n.peers).size!==n.peers.length||n.peers.some(id=>!ids.has(id)||id===n.id))fail('invalid peers for '+n.id);
  }
  if(seen.size!==ids.size)fail('missing source nodes');
  const edges=[...model.edges,...(model.groupEdges??[])],relations=intent.relations;
  if(!Array.isArray(relations)||relations.length!==edges.length)fail('relations must cover every source relation');
  const relationIds=new Set();
  for(const r of relations){const source=edges.find(e=>e.id===r.id);if(!source||relationIds.has(r.id)||source.source!==r.source||source.target!==r.target)fail('invalid relation '+r.id);relationIds.add(r.id)}
  if(!Array.isArray(intent.constraints)||!intent.constraints.length||intent.constraints.length>100)fail('ranked constraints required');
  for(const c of intent.constraints){if(!['hard','soft'].includes(c.priority))fail('constraint priority');text(c.reason,'constraint reason');text(c.description,'constraint description');if(!Array.isArray(c.nodeIds)||c.nodeIds.some(id=>!ids.has(id)))fail('constraint source IDs')}
  if(!Array.isArray(intent.uncertainties)||intent.uncertainties.length>100||intent.uncertainties.some(x=>typeof x!=='string'))fail('uncertainties must be text array');
  return JSON.parse(JSON.stringify(intent));
}
export const LAYOUT_INTENT_PROMPT=`Mandatory planning phase, before generation. This overrides direct-first-draft instructions. Source facts must be available. Use the main model to infer the diagram purpose, reading order and layout grammar, source-specific semantic roles and layers, peer relationships and ranked, reasoned structural constraints. Do not impose fixed tiers or turn a source group into a semantic layer by default. Preserve every source node, relation direction and effective group path as hard facts. User visual requests, reading-order design choices and inferred layers are soft preferences; only source meaning, effective membership and relation preservation are hard. If a better result needs a different design, revise the intent with a reason. Record ambiguity in uncertainties; never invent source facts. Call diagram_layout_intent with intent {purpose,readingOrder,layoutGrammar,nodes:[{id,role,layer,peers:[],groupPath:[]}],relations:[{id,source,target}],constraints:[{priority:'hard'|'soft',reason,description,nodeIds:[]}],uncertainties:[]}. Use exact parser IDs. Only after acceptance, draw that contract. To revise, call the tool with predecessorHash and a reason citing feedback; revision invalidates all old checks/review/Judge receipts. Files cannot establish or revise the contract.`;
