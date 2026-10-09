// premise_c0_terminal_first_dates: external daily counts by product_type for macro_authoring_ended / macro_edit_cancelled / macro_create_cancelled / macro_create_started / macro_edit_started, 2026-09-01..2026-10-05 (finds first-live date per variant)
// re-add private/operations/internal-analytics-domain-exclusions.md before rerun
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"];
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== 'unknown_user_account_id' && id.indexOf('$device:') !== 0; }
function main(){
  return Events({from_date:'2026-09-01', to_date:'2026-10-05', event_selectors:[{event:'macro_authoring_ended'},{event:'macro_edit_cancelled'},{event:'macro_create_cancelled'},{event:'macro_create_started'},{event:'macro_edit_started'}]})
  .filter(function(e){ return !isInternal(e.properties.client_domain); })
  .groupBy(['name', function(e){return String(e.properties.product_type);}, function(e){ return new Date(e.time).toISOString().slice(0,10); }], mixpanel.reducer.count());
}
