// premise_a0_firstseen_split: app_first_seen daily volume by product_type x internal/external, and whether distinct_id == properties.account_id; window 2026-08-01..2026-10-05
// re-add private/operations/internal-analytics-domain-exclusions.md before rerun
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"];
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== 'unknown_user_account_id' && id.indexOf('$device:') !== 0; }
function main(){
  return Events({from_date:'2026-08-01', to_date:'2026-10-05', event_selectors:[{event:'app_first_seen'}]})
  .groupBy([function(e){ return new Date(e.time).toISOString().slice(0,10); },
            function(e){ return String(e.properties.product_type); },
            function(e){ return isInternal(e.properties.client_domain)?'int':'ext'; },
            function(e){ return e.distinct_id===e.properties.account_id?'id_eq':'id_ne'; }], mixpanel.reducer.count());
}
