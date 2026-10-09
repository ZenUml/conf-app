// premise_c5_start_to_success_1h_op: user-level conversion per (product_type, op): distinct users with >=1 create/edit start, and users with a same-op success of ANY macro_type within 1h after any start; external, current 30d 2026-09-06..2026-10-05 (compare anchor A3)
// re-add private/operations/internal-analytics-domain-exclusions.md before rerun
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"];
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== 'unknown_user_account_id' && id.indexOf('$device:') !== 0; }
function main(){
  return Events({from_date:'2026-09-06', to_date:'2026-10-05', event_selectors:[{event:'macro_create_started'},{event:'macro_create_succeeded'},{event:'macro_edit_started'},{event:'macro_save_succeeded'}]})
  .filter(function(e){ return !isInternal(e.properties.client_domain) && okUser(e); })
  .groupByUser(function(state, events){
     state = state || {starts:[], succ:[]};
     for (var i=0;i<events.length;i++){ var e=events[i]; var pt=String(e.properties.product_type);
       if (e.name==='macro_create_started') state.starts.push([e.time,'create',pt]);
       else if (e.name==='macro_edit_started') state.starts.push([e.time,'edit',pt]);
       else state.succ.push([e.time, e.name==='macro_create_succeeded'?'create':'edit', pt]); }
     return state; })
  .map(function(r){
     var s=r.value.starts, c=r.value.succ, per={}, rows=[];
     for (var i=0;i<s.length;i++){ var k=s[i][2]+'|'+s[i][1]; per[k]=per[k]||0;
       for (var j=0;j<c.length;j++){ if (c[j][1]===s[i][1] && c[j][2]===s[i][2] && c[j][0]>=s[i][0] && c[j][0]-s[i][0]<=3600000){ per[k]=1; break; } } }
     for (var k2 in per) rows.push([k2, per[k2]]);
     return rows; })
  .flatten()
  .groupBy([function(x){return x[0];}, function(x){return x[1];}], mixpanel.reducer.count());
}
