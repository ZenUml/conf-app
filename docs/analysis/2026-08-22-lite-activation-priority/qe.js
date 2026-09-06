var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"]; // plus the entries in private/operations/internal-analytics-domain-exclusions.md
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== 'unknown_user_account_id' && id.indexOf('$device:') !== 0; }
var W = new Date('2026-07-23T00:00:00Z').getTime();
function main(){
  return Events({from_date:'2026-07-23', to_date:'2026-08-22', event_selectors:[{event:'viewer_source_opened'},{event:'viewer_source_copied'},{event:'copy_for_ai_clicked'},{event:'fullscreen_opened'},{event:'macro_create_started'}]})
  .filter(function(e){ return !isInternal(e.properties.client_domain) && okUser(e) && e.properties.product_type==='lite'; })
  .groupBy(['name', function(e){return String(e.properties.entry_point);}, function(e){return String(e.properties.has_edit_permission);}, function(e){return String(e.properties.surface);}, 'distinct_id'], mixpanel.reducer.count())
  .groupBy([function(r){return r.key[0]+'|ep='+r.key[1]+'|edit='+r.key[2]+'|surf='+r.key[3];}], [mixpanel.reducer.count(), mixpanel.reducer.sum(function(r){return r.value;})]);
}
