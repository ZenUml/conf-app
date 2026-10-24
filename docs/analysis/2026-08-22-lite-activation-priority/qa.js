var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"]; // plus the entries in private/operations/internal-analytics-domain-exclusions.md
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== 'unknown_user_account_id' && id.indexOf('$device:') !== 0; }
var W = new Date('2026-07-23T00:00:00Z').getTime();
function main(){
  return Events({from_date:'2026-04-18', to_date:'2026-08-22',
    event_selectors:[{event:'macro_viewed'},{event:'view_macro'},{event:'macro_create_succeeded'},{event:'create_macro_end'},{event:'macro_save_succeeded'},{event:'edit_macro_end'}]})
  .filter(function(e){ return !isInternal(e.properties.client_domain) && okUser(e); })
  .groupByUser([], function(acc, events){
     acc = acc || {viewLite30:false, viewLiteViewer30:false, created:false, createdLite:false, lite30domains:{}};
     for (var i=0;i<events.length;i++){ var e=events[i];
       var isView = (e.name==='macro_viewed'||e.name==='view_macro');
       if (isView) { if (e.time >= W && e.properties.product_type==='lite') { acc.viewLite30=true; if (e.properties.surface==='viewer') acc.viewLiteViewer30=true; } }
       else { acc.created=true; if (e.properties.product_type==='lite') acc.createdLite=true; }
     }
     return acc; })
  .groupBy([function(r){ return (r.value.viewLite30?'viewLite30':'noViewLite30')+'|'+(r.value.viewLiteViewer30?'viewerSurface':'noViewerSurface')+'|'+(r.value.created?'createdEver':'neverCreated')+'|'+(r.value.createdLite?'createdLite':'noCreateLite'); }], mixpanel.reducer.count());
}
