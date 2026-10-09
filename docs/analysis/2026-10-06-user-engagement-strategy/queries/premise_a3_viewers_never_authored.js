// premise_a3_viewers_never_authored: Lite/Full viewer-surface macro_viewed accounts in current 30d 2026-09-06..2026-10-05, split by whether the account has any create/save success (incl. legacy names) 2026-04-18..2026-10-05 in the same product_type (compare with 2026-08-22 anchor A1')
// re-add private/operations/internal-analytics-domain-exclusions.md before rerun
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"];
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== 'unknown_user_account_id' && id.indexOf('$device:') !== 0; }
var CUR = new Date('2026-09-06T00:00:00Z').getTime();
function main(){
  return Events({from_date:'2026-04-18', to_date:'2026-10-05', event_selectors:[{event:'macro_viewed'},{event:'macro_create_succeeded'},{event:'create_macro_end'},{event:'macro_save_succeeded'},{event:'edit_macro_end'}]})
  .filter(function(e){ if (isInternal(e.properties.client_domain) || !okUser(e)) return false; if (e.name==='macro_viewed') return e.time>=CUR && e.properties.surface==='viewer'; return true; })
  .groupBy(['distinct_id', function(e){return String(e.properties.product_type);}], function(accs, events){ var a=0; for (var i=0;i<accs.length;i++) a|=accs[i];
     for (var j=0;j<events.length;j++) a |= (events[j].name==='macro_viewed'?1:2); return a; })
  .groupBy([function(r){return r.key[1];}, function(r){return r.value;}], mixpanel.reducer.count());
}
