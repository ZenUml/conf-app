// premise_e1_reader_breadth: per diagram (client_domain + custom_content_id) distinct viewers (macro_viewed surface=viewer, 2026-09-06..2026-10-05) and how many are not a known author (create/save of that content id, incl. legacy names, 2026-04-18..2026-10-05); histogram by product_type x viewer count x known-author flag, external
// re-add private/operations/internal-analytics-domain-exclusions.md before rerun
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"];
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== 'unknown_user_account_id' && id.indexOf('$device:') !== 0; }
function main(){
  return Events({from_date:'2026-04-18', to_date:'2026-10-05', event_selectors:[{event:'macro_viewed'},{event:'macro_create_succeeded'},{event:'create_macro_end'},{event:'macro_save_succeeded'},{event:'edit_macro_end'}]})
  .filter(function(e){ if (isInternal(e.properties.client_domain) || !okUser(e) || !e.properties.custom_content_id) return false;
     if (e.name==='macro_viewed') return e.time >= new Date('2026-09-06T00:00:00Z').getTime() && e.properties.surface==='viewer';
     return true; })
  .groupBy([function(e){return e.properties.client_domain;}, function(e){return String(e.properties.custom_content_id);}], function(accs, events){
     var a={pt:null, au:{}, vw:{}, views:0, nav:0};
     for (var i=0;i<accs.length;i++){ var x=accs[i]; for (var k in x.au) a.au[k]=1; for (var k2 in x.vw) a.vw[k2]=(a.vw[k2]||0)+x.vw[k2]; a.pt=a.pt||x.pt; }
     for (var j=0;j<events.length;j++){ var e=events[j];
       if (e.name==='macro_viewed'){ a.vw[e.distinct_id]=(a.vw[e.distinct_id]||0)+1; a.pt=a.pt||String(e.properties.product_type); }
       else a.au[e.distinct_id]=1; }
     return a; })
  .filter(function(r){ return Object.keys(r.value.vw).length>0; })
  .map(function(r){ var v=r.value, n=0, nn=0, views=0, nviews=0; for (var u in v.vw){ n++; views+=v.vw[u]; if(!v.au[u]){ nn++; nviews+=v.vw[u]; } }
     return {pt:v.pt, n:Math.min(n,500), hasAuthor:Object.keys(v.au).length>0, nn:nn, views:views, nviews:nviews}; })
  .groupBy([function(x){return x.pt;}, function(x){return x.n;}, function(x){return x.hasAuthor?'known_author':'no_known_author';}],
     function(accs, xs){ var a={diagrams:0, viewers:0, nonauthor_viewers:0, views:0, nonauthor_views:0};
       for (var i=0;i<accs.length;i++) for (var k in a) a[k]+=accs[i][k];
       for (var j=0;j<xs.length;j++){ a.diagrams++; a.viewers+=xs[j].n; a.nonauthor_viewers+=xs[j].nn; a.views+=xs[j].views; a.nonauthor_views+=xs[j].nviews; } return a; });
}
