var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"]; // plus the entries in private/operations/internal-analytics-domain-exclusions.md
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== 'unknown_user_account_id' && id.indexOf('$device:') !== 0; }
var W = new Date('2026-07-23T00:00:00Z').getTime();
function main(){
  return Events({from_date:'2026-07-23', to_date:'2026-08-22', event_selectors:[{event:'paywall_banner_shown'},{event:'space_admin_active'}]})
  .filter(function(e){ return !isInternal(e.properties.client_domain) && okUser(e) && e.properties.product_type==='lite'; })
  .groupBy(['name', function(e){return String(e.properties.banner_audience);}, function(e){return String(e.properties.is_space_admin);}, function(e){return e.properties.client_domain+'/'+e.properties.confluence_space;}], mixpanel.reducer.count())
  .groupBy([function(r){return r.key[0]+'|aud='+r.key[1]+'|admin='+r.key[2];}], mixpanel.reducer.count());
}
