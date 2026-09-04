var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"]; // plus the entries in private/operations/internal-analytics-domain-exclusions.md
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== 'unknown_user_account_id' && id.indexOf('$device:') !== 0; }
var W = new Date('2026-07-23T00:00:00Z').getTime();
function main(){
  return Events({from_date:'2026-07-25', to_date:'2026-08-22',
    event_selectors:[{event:'byline_create_clicked'},{event:'byline_diagram_created'},{event:'byline_editor_deeplinked'},{event:'byline_unplaced_scanned'},{event:'macro_create_succeeded'},{event:'macro_save_succeeded'}]})
  .filter(function(e){ return okUser(e) && e.properties.product_type==='lite'; })
  .groupByUser([], function(acc, events){
     acc = acc || {clicks:0, created:0, deeplinked:0, createSuccAfterClick30m:0, unplacedSum:0, diagramSum:0, scans:0, lastClick:null, internal:null};
     events.sort(function(a,b){return a.time-b.time;});
     for (var i=0;i<events.length;i++){ var e=events[i]; var n=e.name; if (acc.internal===null) acc.internal=isInternal(e.properties.client_domain);
       if (n==='byline_create_clicked') { acc.clicks++; acc.lastClick=e.time; }
       else if (n==='byline_diagram_created') acc.created++;
       else if (n==='byline_editor_deeplinked') acc.deeplinked++;
       else if (n==='byline_unplaced_scanned') { acc.scans++; acc.unplacedSum += (e.properties.unplaced_count||0); acc.diagramSum += (e.properties.diagram_count||0); }
       else if (acc.lastClick!==null && e.time-acc.lastClick<=30*60*1000) { acc.createSuccAfterClick30m++; acc.lastClick=null; }
     }
     return acc; })
  .filter(function(r){ return r.value.clicks>0 || r.value.scans>0; })
  .groupBy([function(r){return r.value.internal?'internal':'external';}], [mixpanel.reducer.count(), mixpanel.reducer.sum(function(r){return r.value.clicks;}), mixpanel.reducer.sum(function(r){return r.value.created;}), mixpanel.reducer.sum(function(r){return r.value.deeplinked;}), mixpanel.reducer.sum(function(r){return r.value.createSuccAfterClick30m;}), mixpanel.reducer.sum(function(r){return r.value.scans;}), mixpanel.reducer.sum(function(r){return r.value.unplacedSum;}), mixpanel.reducer.sum(function(r){return r.value.diagramSum;})]);
}
