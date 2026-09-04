var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"]; // plus the entries in private/operations/internal-analytics-domain-exclusions.md
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== 'unknown_user_account_id' && id.indexOf('$device:') !== 0; }
var W = new Date('2026-07-23T00:00:00Z').getTime();
function main(){
  return Events({from_date:'2026-07-23', to_date:'2026-08-22',
    event_selectors:[{event:'homepage_feed_viewed'},{event:'homepage_feed_action_clicked'},{event:'homepage_feed_diagram_opened'},{event:'homepage_feed_example_expanded'},{event:'macro_create_succeeded'},{event:'macro_save_succeeded'}]})
  .filter(function(e){ return !isInternal(e.properties.client_domain) && okUser(e); })
  .groupByUser([], function(acc, events){
     acc = acc || {viewed:false, clicked:false, opened:false, expanded:false, firstClick:null, createAfterClick30m:false, domains:{}};
     events.sort(function(a,b){return a.time-b.time;});
     for (var i=0;i<events.length;i++){ var e=events[i]; var n=e.name;
       if (n==='macro_create_succeeded'||n==='macro_save_succeeded') { if (acc.firstClick!==null && e.time-acc.firstClick<=30*60*1000) acc.createAfterClick30m=true; continue; }
       if (e.properties.product_type!=='lite') continue;
       if (n==='homepage_feed_viewed') { acc.viewed=true; acc.domains[e.properties.client_domain]=1; }
       if (n==='homepage_feed_action_clicked') { acc.clicked=true; if (acc.firstClick===null) acc.firstClick=e.time; }
       if (n==='homepage_feed_diagram_opened') acc.opened=true;
       if (n==='homepage_feed_example_expanded') acc.expanded=true;
     }
     return acc; })
  .filter(function(r){ return r.value.viewed; })
  .groupBy([function(r){ var v=r.value; return (v.clicked?'clicked':'noClick')+'|'+(v.opened?'openedDiagram':'noOpen')+'|'+(v.expanded?'expanded':'noExpand')+'|'+(v.createAfterClick30m?'CREATE_AFTER_CLICK':'noCreate'); }], mixpanel.reducer.count());
}
