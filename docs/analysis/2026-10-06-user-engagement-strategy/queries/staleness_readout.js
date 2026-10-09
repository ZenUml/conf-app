// Staleness hint readout (B-1 step ②/③): shown / clicked / dismissed per tenant and author status,
// plus saves within 1h of a click on the same custom_content_id. Window: edit from/to before running.
// Re-add private/operations/internal-analytics-domain-exclusions.md entries to INTERNAL before rerun.
var INTERNAL = ["zenuml","whimet","full-stg","lite-stg","lite-dev","lite-prod","dia-stg","asyncapi-stg","diagramly","danshuitaihejie"];
function isInternal(d){ if(!d) return true; for (var i=0;i<INTERNAL.length;i++) if (d.indexOf(INTERNAL[i])!==-1) return true; return false; }
function okUser(e){ var id=e.distinct_id; return !!id && id!=='unknown_user_account_id' && id.indexOf('$device:')!==0; }
function main(){
  return Events({from_date:'2026-10-09', to_date:'2026-10-23',
    event_selectors:[{event:'staleness_hint_shown'},{event:'staleness_hint_clicked'},{event:'staleness_hint_dismissed'},{event:'macro_save_succeeded'}]})
  .filter(function(e){ return e.properties.product_type==='lite' && okUser(e); })
  .groupByUser(['properties.client_domain'], function(acc, events){
    acc = acc || {shown:0, clicked:0, dismissed:0, saveAfterClick:0, lastClick:null, lastClickCc:null, author:null, internal:false};
    for (var i=0;i<events.length;i++){ var e=events[i], p=e.properties;
      if (isInternal(p.client_domain)) acc.internal = true;
      if (e.name==='staleness_hint_shown'){ acc.shown++; if (acc.author===null) acc.author = !!p.is_diagram_author; }
      else if (e.name==='staleness_hint_clicked'){ acc.clicked++; acc.lastClick=e.time; acc.lastClickCc=p.custom_content_id; }
      else if (e.name==='staleness_hint_dismissed'){ acc.dismissed++; }
      else if (e.name==='macro_save_succeeded' && acc.lastClick && e.time-acc.lastClick <= 3600000 && p.custom_content_id===acc.lastClickCc){ acc.saveAfterClick++; acc.lastClick=null; }
    }
    return acc; })
  .filter(function(r){ return !r.value.internal && r.value.shown>0; })
  .groupBy([function(r){ return r.key[0]; }, function(r){ return r.value.author ? 'author' : 'non_author'; }],
    mixpanel.reducer.object_merge ? mixpanel.reducer.count() : mixpanel.reducer.count())
  ;
}
