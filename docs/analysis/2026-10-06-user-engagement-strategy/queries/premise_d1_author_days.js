// premise_d1_author_days: per (account, product_type) first create day and set of authoring days (create or save, incl. legacy create_macro_end / edit_macro_end), external, 2026-04-18..2026-10-05 — feeds creator-cohort retention (June/July first-create cohorts, +30/+60d) and prior-30d -> current-30d author retention
// re-add private/operations/internal-analytics-domain-exclusions.md before rerun
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"];
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== 'unknown_user_account_id' && id.indexOf('$device:') !== 0; }
function day(e){ return new Date(e.time).toISOString().slice(0,10); }
function main(){
  return Events({from_date:'2026-04-18', to_date:'2026-10-05', event_selectors:[{event:'macro_create_succeeded'},{event:'create_macro_end'},{event:'macro_save_succeeded'},{event:'edit_macro_end'}]})
  .filter(function(e){ return !isInternal(e.properties.client_domain) && okUser(e); })
  .groupBy(['distinct_id', function(e){return String(e.properties.product_type);}], function(accs, events){
     var a={fc:null, fcAny:null, days:{}};
     for (var i=0;i<accs.length;i++){ var x=accs[i]; if (x.fc && (!a.fc || x.fc<a.fc)) a.fc=x.fc; for (var k in x.days) a.days[k]=1; }
     for (var j=0;j<events.length;j++){ var e=events[j]; var d=day(e);
       if (e.name==='macro_create_succeeded'||e.name==='create_macro_end'){ if(!a.fc||d<a.fc) a.fc=d; }
       a.days[d]=1; }
     return a; })
  .map(function(r){ return {k:r.key, fc:r.value.fc, days:Object.keys(r.value.days).sort()}; });
}
