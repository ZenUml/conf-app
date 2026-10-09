// premise_c4_edit_cancelled: macro_edit_cancelled and macro_create_cancelled by product_type x macro_type x close_source x had_changes (events and distinct users via later dedupe), external, 2026-09-13 (first external event) .. 2026-10-05
// re-add private/operations/internal-analytics-domain-exclusions.md before rerun
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"];
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== 'unknown_user_account_id' && id.indexOf('$device:') !== 0; }
function main(){
  return Events({from_date:'2026-09-13', to_date:'2026-10-05', event_selectors:[{event:'macro_edit_cancelled'},{event:'macro_create_cancelled'},{event:'macro_edit_started'},{event:'macro_create_started'}]})
  .filter(function(e){ return !isInternal(e.properties.client_domain) && okUser(e); })
  .groupBy(['name', function(e){return String(e.properties.product_type);}, function(e){return String(e.properties.macro_type);}, function(e){return String(e.properties.close_source);}, function(e){return String(e.properties.had_changes);}], mixpanel.reducer.count());
}
