// bets_viewer_denominators.js — macro_viewed distinct users per product_type x window, split by surface=viewer and text-DSL (sequence/mermaid/plantuml/markdown) viewer; external tenants; prior 2026-08-07..09-05, cur 2026-09-06..10-05
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"]; // re-add private/operations/internal-analytics-domain-exclusions.md before rerun
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== "unknown_user_account_id" && String(id).indexOf("$device:") !== 0; }
var CUR = new Date("2026-09-06T00:00:00Z").getTime();   // current 30d = 2026-09-06..2026-10-05
var PRI = new Date("2026-08-07T00:00:00Z").getTime();   // prior 30d   = 2026-08-07..2026-09-05
function win(t) { return t >= CUR ? "cur" : (t >= PRI ? "prior" : "pre"); }
function w(e) { return 1 / (Number(e.properties.sample_rate) || 1); }
var TEXT = {sequence: 1, mermaid: 1, plantuml: 1, markdown: 1};
function main() {
  return Events({from_date: "2026-08-07", to_date: "2026-10-05", event_selectors: [{event: "macro_viewed"}]})
  .filter(function (e) { return !isInternal(e.properties.client_domain) && okUser(e); })
  .groupByUser([function (e) { return e.properties.product_type || "none"; }, function (e) { return win(e.time); }],
    function (acc, events) {
      acc = acc || {any: 0, viewer: 0, text: 0};
      for (var i = 0; i < events.length; i++) { var p = events[i].properties; acc.any++;
        if (p.surface === "viewer") { acc.viewer++; if (TEXT[p.macro_type]) acc.text++; } }
      return acc; })
  .groupBy([function (r) { return r.key[1]; }, function (r) { return r.key[2]; }],
    [mixpanel.reducer.count(),
     mixpanel.reducer.sum(function (r) { return r.value.viewer > 0 ? 1 : 0; }),
     mixpanel.reducer.sum(function (r) { return r.value.text > 0 ? 1 : 0; }),
     mixpanel.reducer.sum(function (r) { return r.value.any; }),
     mixpanel.reducer.sum(function (r) { return r.value.viewer; }),
     mixpanel.reducer.sum(function (r) { return r.value.text; })]);
}
