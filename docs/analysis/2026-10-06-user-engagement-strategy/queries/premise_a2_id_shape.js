// premise_a2_id_shape: distinct_id shape on external macro_viewed / create / save events, current 30d 2026-09-06..10-05 (data-quality check for okUser)
// re-add private/operations/internal-analytics-domain-exclusions.md before rerun
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"];
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== 'unknown_user_account_id' && id.indexOf('$device:') !== 0; }
function shape(id){ if(!id) return 'empty'; if(id==='unknown_user_account_id') return 'unknown_literal'; if(id.indexOf('$device:')===0) return 'device';
  if(/^[0-9]{6}:[0-9a-f-]{36}$/.test(id)) return 'atl_prefixed'; if(/^[0-9a-f]{24}$/.test(id)) return 'atl_hex24'; if(/^anon/i.test(id)) return 'anon_prefix'; return 'other'; }
function main(){
  return Events({from_date:'2026-09-06', to_date:'2026-10-05', event_selectors:[{event:'macro_viewed'},{event:'macro_create_succeeded'},{event:'macro_save_succeeded'}]})
  .filter(function(e){ return !isInternal(e.properties.client_domain); })
  .groupBy(['name', function(e){return shape(e.distinct_id);}, function(e){ var a=e.properties.user_account_id; return a===undefined?'uaid_absent':(a===e.distinct_id?'uaid_eq':'uaid_ne'); }], mixpanel.reducer.count());
}
