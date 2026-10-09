// bets_liveness_postwindow.js — liveness check outside the 30d window: create_guide_* / whats_new_* / magic_view_* / template_offer_* events 2026-09-28..2026-10-06 (today partial) by day x product_type x internal/external; event and user counts
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"]; // re-add private/operations/internal-analytics-domain-exclusions.md before rerun
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== "unknown_user_account_id" && String(id).indexOf("$device:") !== 0; }
function main() {
  return Events({from_date: "2026-09-28", to_date: "2026-10-06", event_selectors: [
    {event: "create_guide_impression"}, {event: "create_guide_opened"}, {event: "create_guide_closed"}, {event: "create_guide_open_failed"},
    {event: "whats_new_banner_evaluated"}, {event: "whats_new_banner_shown"}, {event: "whats_new_banner_expanded"}, {event: "whats_new_banner_dismissed"}, {event: "whats_new_link_clicked"},
    {event: "magic_view_requested"}, {event: "magic_view_succeeded"}, {event: "magic_view_failed"}, {event: "magic_view_restored"}, {event: "magic_availability_checked"},
    {event: "template_offer_shown"}, {event: "template_offer_clicked"}, {event: "template_created"}]})
  .filter(function (e) { return okUser(e); })
  .groupByUser([function (e) { return e.name; }, function (e) { return new Date(e.time).toISOString().slice(0, 10); }, function (e) { return e.properties.product_type || "none"; }, function (e) { return isInternal(e.properties.client_domain) ? "internal" : "external"; }], mixpanel.reducer.count())
  .groupBy([function (r) { return r.key[1]; }, function (r) { return r.key[2]; }, function (r) { return r.key[3]; }, function (r) { return r.key[4]; }], [mixpanel.reducer.count(), mixpanel.reducer.sum("value")]);
}
