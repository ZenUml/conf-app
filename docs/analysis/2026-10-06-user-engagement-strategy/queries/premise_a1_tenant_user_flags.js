// premise_a1_tenant_user_flags: per (product_type, client_domain) count of accounts by activity bitmask — census windows (lite/diagramly 2026-08-09..08-26, full 08-21..09-09, asyncapi 08-18..08-28) and current 30d 2026-09-06..10-05; events app_first_seen, macro_viewed, macro_create_succeeded, macro_save_succeeded
// re-add private/operations/internal-analytics-domain-exclusions.md before rerun
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"];
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== 'unknown_user_account_id' && id.indexOf('$device:') !== 0; }
var CENSUS = {lite:['2026-08-09','2026-08-26'], diagramly:['2026-08-09','2026-08-26'], full:['2026-08-21','2026-09-09'], asyncapi:['2026-08-18','2026-08-28']};
function day(e){ return new Date(e.time).toISOString().slice(0,10); }
function main(){
  return Events({from_date:'2026-08-09', to_date:'2026-10-05',
    event_selectors:[{event:'app_first_seen'},{event:'macro_viewed'},{event:'macro_create_succeeded'},{event:'macro_save_succeeded'}]})
  .filter(function(e){ return !isInternal(e.properties.client_domain) && okUser(e); })
  .groupBy([function(e){return String(e.properties.product_type);}, function(e){return e.properties.client_domain;}, 'distinct_id'],
    function(accs, events){
      var m = 0;
      for (var i=0;i<accs.length;i++) m |= accs[i];
      for (var j=0;j<events.length;j++){ var e=events[j]; var d=day(e); var c=CENSUS[e.properties.product_type];
        var inC = c && d>=c[0] && d<=c[1]; var inCur = d>='2026-09-06' && d<='2026-10-05';
        var n=e.name;
        if (n==='app_first_seen'){ if(inC) m|=1; if(inCur) m|=512; }
        else if (n==='macro_viewed'){ if(inC){ m|=2; if(e.properties.surface==='viewer') m|=4; } if(inCur){ m|=32; if(e.properties.surface==='viewer') m|=64; } }
        else if (n==='macro_create_succeeded'){ if(inC) m|=8; if(inCur) m|=128; }
        else if (n==='macro_save_succeeded'){ if(inC) m|=16; if(inCur) m|=256; }
      }
      return m; })
  .groupBy([function(r){return r.key[0];}, function(r){return r.key[1];}, function(r){return r.value;}], mixpanel.reducer.count());
}
