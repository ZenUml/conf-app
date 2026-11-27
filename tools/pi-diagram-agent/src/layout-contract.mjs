// The semantic layout contract of one run: frozen once from source facts, revised only against its predecessor with a reason, every outcome recorded as an event. Pure code: no model, no browser, no run state.
import {validateLayoutIntent,hashLayoutIntent} from './layout-intent.mjs';
const copy=v=>v==null?v:JSON.parse(JSON.stringify(v));
export class LayoutContract {
  #required;#sourceHash;#rulesHash;#model;#current=null;#history=[];#events=[];
  constructor({required=false,sourceHash,rulesHash,model=null}={}){this.#required=required;this.#sourceHash=sourceHash;this.#rulesHash=rulesHash;this.#model=copy(model)}
  get required(){return this.#required}
  get model(){return this.#model}
  get current(){return copy(this.#current)}
  get hash(){return this.#current?.hash??null}
  get history(){return copy(this.#history)}
  get events(){return this.#events.map(e=>({...e}))}
  get revision(){return this.#history.length}
  /** Source facts must be resolved and the contract not yet frozen. Returns the stored copy. */
  setModel(facts){
    if(!facts?.nodes?.length||facts.conflicts?.length||facts.membershipConflicts?.length)throw Error('LAYOUT_SOURCE_FACTS_UNRESOLVED');
    if(this.#current)throw Error('LAYOUT_INTENT_ALREADY_FROZEN');
    return this.#model=copy(facts);
  }
  require(){if(this.#required&&!this.#current)throw Error('LAYOUT_INTENT_REQUIRED: submit semantic plan through diagram_layout_intent before authoring')}
  /** @param opts {intent,predecessorHash,reason}  First call freezes; later calls revise and need the current hash plus a reason. Returns the accepted record; any failure is recorded and rethrown. */
  submit(opts){
    try{
      const current=this.#current;
      if(current&&(opts.predecessorHash!==current.hash||!opts.reason?.trim()))throw Error('LAYOUT_INTENT_REVISION_REQUIRES_PREDECESSOR_AND_REASON');
      const intent=validateLayoutIntent(opts.intent,this.#model);
      const record={schema:'pi-layout-intent/1',sourceHash:this.#sourceHash,rulesHash:this.#rulesHash,predecessorHash:current?.hash??null,reason:opts.reason??null,intent};record.hash=hashLayoutIntent(record);
      this.#current=copy(record);this.#history.push(this.#current);
      this.#events.push({name:record.predecessorHash?'magic_layout_intent_revised':'magic_layout_intent_created',layout_intent_hash:record.hash,previous_layout_intent_hash:record.predecessorHash,layout_intent_revision:this.#history.length,layout_contract_outcome:'accepted',layout_node_count:intent.nodes.length,layout_layer_count:new Set(intent.nodes.map(n=>n.layer)).size});
      return record;
    }catch(error){this.#events.push({name:'magic_layout_contract_failed',layout_contract_outcome:'rejected',layout_contract_reason:String(error.message).split(':')[0]});throw error}
  }
  /** The reviewer found a blocking layout-intent conflict in this round. Recorded only against a frozen contract. */
  noteSemanticConflict({round}){
    if(this.#current)this.#events.push({name:'magic_layout_contract_failed',layout_intent_hash:this.#current.hash,layout_intent_revision:this.#history.length,layout_contract_outcome:'rejected',layout_contract_reason:'SEMANTIC_LAYOUT_CONFLICT',round});
  }
  /** Plain data for the sealed run manifest. Key order is part of the manifest self-hash. */
  manifestFields(){return {layoutIntentRequired:this.#required,layoutIntent:this.current,layoutIntentHistory:this.history,layoutIntentEvents:this.events}}
}
