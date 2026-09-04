var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"]; // plus the entries in private/operations/internal-analytics-domain-exclusions.md
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== 'unknown_user_account_id' && id.indexOf('$device:') !== 0; }
var W = new Date('2026-07-23T00:00:00Z').getTime();
function main(){
  return Events({from_date:'2026-04-18', to_date:'2026-08-22',
    event_selectors:[{event:'macro_create_started'},{event:'macro_create_succeeded'},{event:'create_macro_end'},{event:'macro_save_succeeded'},{event:'edit_macro_end'}]})
  .filter(function(e){ return !isInternal(e.properties.client_domain) && okUser(e); })
  .groupByUser([], function(acc, events){
     acc = acc || {started30:false, succeeded30:false, firstCreateTime:null, firstCreateLite:false};
     events.sort(function(a,b){return a.time-b.time;});
     for (var i=0;i<events.length;i++){ var e=events[i]; var n=e.name; var lite = e.properties.product_type==='lite';
       if (n==='macro_create_started') { if (e.time>=W && lite) acc.started30=true; continue; }
       if (acc.firstCreateTime===null) { acc.firstCreateTime=e.time; acc.firstCreateLite=lite; }
       if (n==='macro_create_succeeded' && e.time>=W && lite) acc.succeeded30=true;
     }
     return acc; })
  .groupBy([function(r){ var v=r.value; return (v.started30?'started30':'noStart30')+'|'+(v.succeeded30?'createSucceeded30':'noCreateSuccess30')+'|'+(v.firstCreateTime!==null && v.firstCreateTime>=W ? (v.firstCreateLite?'FIRST_EVER_IN_WINDOW_lite':'FIRST_EVER_IN_WINDOW_other') : 'firstEarlierOrNone'); }], mixpanel.reducer.count());
}
