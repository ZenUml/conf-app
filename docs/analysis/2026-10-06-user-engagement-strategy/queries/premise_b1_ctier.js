// premise_b1_ctier: Lite per-(client_domain, account) bitmask for C-tier — August training 2026-05-05..07-03, current 60d training 2026-08-07..10-05, current 30d authors 2026-09-06..10-05; macro_viewed / macro_create_succeeded / macro_save_succeeded
// re-add private/operations/internal-analytics-domain-exclusions.md before rerun
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"];
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== 'unknown_user_account_id' && id.indexOf('$device:') !== 0; }
function day(e){ return new Date(e.time).toISOString().slice(0,10); }
function main(){
  return Events({from_date:'2026-05-05', to_date:'2026-10-05',
    event_selectors:[{event:'macro_viewed'},{event:'macro_create_succeeded'},{event:'macro_save_succeeded'}]})
  .filter(function(e){ return e.properties.product_type==='lite' && !isInternal(e.properties.client_domain) && okUser(e); })
  .groupBy([function(e){return e.properties.client_domain;}, 'distinct_id'],
    function(accs, events){
      var m=0; for (var i=0;i<accs.length;i++) m|=accs[i];
      for (var j=0;j<events.length;j++){ var e=events[j]; var d=day(e); var n=e.name;
        var b = n==='macro_viewed'?0:(n==='macro_create_succeeded'?1:2);
        if (d>='2026-05-05' && d<='2026-07-03') m |= (1<<b);
        if (d>='2026-08-07') m |= (8<<b);
        if (d>='2026-09-06' && b>0) m |= 64;
      }
      return m; })
  .groupBy([function(r){return r.key[0];}, function(r){return r.value;}], mixpanel.reducer.count());
}
