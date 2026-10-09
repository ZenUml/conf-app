// bets_surface_clickers.js — per external user who touched a byline / homepage-feed / create-guide surface 2026-08-07..10-05: product_type, event times by name, plus their macro_create_succeeded times in the same span; per-user rows joined offline with bets_authors_first_success (30-min click->create gate)
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"]; // re-add private/operations/internal-analytics-domain-exclusions.md before rerun
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== "unknown_user_account_id" && String(id).indexOf("$device:") !== 0; }
var CUR = new Date("2026-09-06T00:00:00Z").getTime();   // current 30d = 2026-09-06..2026-10-05
var PRI = new Date("2026-08-07T00:00:00Z").getTime();   // prior 30d   = 2026-08-07..2026-09-05
function win(t) { return t >= CUR ? "cur" : (t >= PRI ? "prior" : "pre"); }
function w(e) { return 1 / (Number(e.properties.sample_rate) || 1); }
var KEEP = {byline_opened: 1, byline_create_clicked: 1, byline_diagram_created: 1, byline_create_cancelled: 1, homepage_feed_viewed: 1, homepage_feed_action_clicked: 1, homepage_feed_diagram_opened: 1, create_guide_impression: 1, create_guide_opened: 1};
function main() {
  return Events({from_date: "2026-08-07", to_date: "2026-10-05",
    event_selectors: [{event: "byline_opened"}, {event: "byline_create_clicked"}, {event: "byline_diagram_created"}, {event: "byline_create_cancelled"}, {event: "homepage_feed_viewed"}, {event: "homepage_feed_action_clicked"}, {event: "homepage_feed_diagram_opened"}, {event: "create_guide_impression"}, {event: "create_guide_opened"}, {event: "macro_create_succeeded"}]})
  .filter(function (e) { return !isInternal(e.properties.client_domain) && okUser(e); })
  .groupByUser(function (acc, events) {
      acc = acc || {t: {}, pt: {}, touched: false};
      for (var i = 0; i < events.length; i++) { var e = events[i];
        if (KEEP[e.name]) { acc.touched = true; acc.pt[e.properties.product_type || "none"] = 1; }
        (acc.t[e.name] = acc.t[e.name] || []).push(e.time); }
      return acc; })
  .filter(function (r) { return r.value.touched; });
}
