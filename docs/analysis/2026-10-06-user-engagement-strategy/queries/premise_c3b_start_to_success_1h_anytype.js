// premise_c3b_start_to_success_1h_anytype: same as premise_c3 but a success of ANY macro_type counts (start macro_type defaults to sequence for new sequence-family macros, forgeIndex.ts:1003); external, 2026-09-06..2026-10-05
// re-add private/operations/internal-analytics-domain-exclusions.md before rerun
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"];
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== 'unknown_user_account_id' && id.indexOf('$device:') !== 0; }
function main(){
  return Events({from_date:'2026-09-06', to_date:'2026-10-05', event_selectors:[{event:'macro_create_started'},{event:'macro_create_succeeded'},{event:'macro_edit_started'},{event:'macro_save_succeeded'}]})
  .filter(function(e){ return !isInternal(e.properties.client_domain) && okUser(e); })
  .groupByUser(function(state, events){
     state = state || {starts:[], succ:[]};
     for (var i=0;i<events.length;i++){ var e=events[i]; var mt=String(e.properties.macro_type), pt=String(e.properties.product_type);
       if (e.name==='macro_create_started') state.starts.push([e.time,'create',mt,pt]);
       else if (e.name==='macro_edit_started') state.starts.push([e.time,'edit',mt,pt]);
       else state.succ.push([e.time, e.name==='macro_create_succeeded'?'create':'edit', mt, pt]); }
     return state; })
  .map(function(r){
     var s=r.value.starts, c=r.value.succ, per={}, rows=[];
     for (var i=0;i<s.length;i++){ var k=s[i][3]+'|'+s[i][1]+'|'+s[i][2]; per[k]=per[k]||{starts:0,conv:0,user_conv:false};
       per[k].starts++; var ok=false;
       for (var j=0;j<c.length;j++){ if (c[j][1]===s[i][1] && c[j][3]===s[i][3] && c[j][0]>=s[i][0] && c[j][0]-s[i][0]<=3600000){ ok=true; break; } }
       if (ok){ per[k].conv++; per[k].user_conv=true; } }
     for (var k2 in per) rows.push([k2, per[k2].starts, per[k2].conv, per[k2].user_conv?1:0]);
     return rows; })
  .flatten()
  .groupBy([function(x){return x[0];}], function(accs, xs){ var a={users:0,users_conv:0,starts:0,starts_conv:0}; for (var i=0;i<accs.length;i++){ for (var k in a) a[k]+=accs[i][k]; }
      for (var j=0;j<xs.length;j++){ a.users++; a.users_conv+=xs[j][3]; a.starts+=xs[j][1]; a.starts_conv+=xs[j][2]; } return a; });
}
