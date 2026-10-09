// premise_c1_authoring_ended: macro_authoring_ended outcome x had_input (3-valued) x macro_type x operation_mode x product_type, plus start-event counts for reconciliation, external, 2026-10-05 (first full live day) and 2026-10-06 (partial day)
// re-add private/operations/internal-analytics-domain-exclusions.md before rerun
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"];
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== 'unknown_user_account_id' && id.indexOf('$device:') !== 0; }
function main(){
  return Events({from_date:'2026-10-05', to_date:'2026-10-06', event_selectors:[{event:'macro_authoring_ended'},{event:'macro_create_started'},{event:'macro_edit_started'},{event:'macro_create_succeeded'},{event:'macro_save_succeeded'}]})
  .filter(function(e){ return !isInternal(e.properties.client_domain) && okUser(e); })
  .groupBy([function(e){ return new Date(e.time).toISOString().slice(0,10); }, 'name', function(e){return String(e.properties.product_type);}, function(e){return String(e.properties.operation_mode);}, function(e){return String(e.properties.macro_type);},
            function(e){return String(e.properties.authoring_outcome);}, function(e){ var h=e.properties.had_input; return h===undefined?'absent':String(h);}, function(e){return e.properties.paywall_blocked?'pw':'-';}], mixpanel.reducer.count());
}
