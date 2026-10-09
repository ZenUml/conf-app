// premise_c2_authoring_ended_joined: attribute each macro_authoring_ended to the latest preceding macro_create_started/macro_edit_started of the same user (same macro_uuid preferred, else any, within 6h) to recover create/edit + macro_type where the terminal event lacks them; external, 2026-10-05..2026-10-06 (10-06 partial)
// re-add private/operations/internal-analytics-domain-exclusions.md before rerun
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"];
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== 'unknown_user_account_id' && id.indexOf('$device:') !== 0; }
function main(){
  return Events({from_date:'2026-10-04', to_date:'2026-10-06', event_selectors:[{event:'macro_authoring_ended'},{event:'macro_create_started'},{event:'macro_edit_started'}]})
  .filter(function(e){ return !isInternal(e.properties.client_domain) && okUser(e); })
  .groupByUser(function(state, events){
     state = state || {starts:[], out:[]};
     for (var i=0;i<events.length;i++){ var e=events[i];
       if (e.name!=='macro_authoring_ended'){ state.starts.push({t:e.time, u:e.properties.macro_uuid, m:(e.name==='macro_create_started'?'create':'edit'), mt:String(e.properties.macro_type), pt:String(e.properties.product_type)}); continue; }
       if (e.time < new Date('2026-10-05T00:00:00Z').getTime()) continue;
       var best=null, how='none';
       for (var k=state.starts.length-1;k>=0;k--){ var s=state.starts[k]; if (s.t>e.time || e.time-s.t>6*3600*1000) continue; if (s.u && s.u===e.properties.macro_uuid){ best=s; how='uuid'; break; } }
       if (!best){ for (var k2=state.starts.length-1;k2>=0;k2--){ var s2=state.starts[k2]; if (s2.t<=e.time && e.time-s2.t<=6*3600*1000){ best=s2; how='latest'; break; } } }
       var om = e.properties.operation_mode ? String(e.properties.operation_mode) : (best?best.m:'unmatched');
       var mt = e.properties.macro_type ? String(e.properties.macro_type) : (best?best.mt:'unmatched');
       var h = e.properties.had_input; 
       state.out.push([String(e.properties.product_type), om, mt, String(e.properties.authoring_outcome), h===undefined?'absent':String(h), e.properties.operation_mode?'native':how]);
     }
     return state; })
  .map(function(r){ return r.value.out; })
  .flatten()
  .groupBy([function(x){return x[0];},function(x){return x[1];},function(x){return x[2];},function(x){return x[3];},function(x){return x[4];},function(x){return x[5];}], mixpanel.reducer.count());
}
