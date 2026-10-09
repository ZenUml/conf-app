// bets_view_source_14d.js — per external text-DSL viewer (surface=viewer, sequence/mermaid/plantuml/markdown) in anchor window 2026-08-23..2026-09-21: product_type, first text view, first viewer_source_opened, copied flag; per-user rows joined offline with bets_authors_first_success for first create within 14d (correlation only)
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"]; // re-add private/operations/internal-analytics-domain-exclusions.md before rerun
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== "unknown_user_account_id" && String(id).indexOf("$device:") !== 0; }
var CUR = new Date("2026-09-06T00:00:00Z").getTime();   // current 30d = 2026-09-06..2026-10-05
var PRI = new Date("2026-08-07T00:00:00Z").getTime();   // prior 30d   = 2026-08-07..2026-09-05
function win(t) { return t >= CUR ? "cur" : (t >= PRI ? "prior" : "pre"); }
function w(e) { return 1 / (Number(e.properties.sample_rate) || 1); }
var TEXT = {sequence: 1, mermaid: 1, plantuml: 1, markdown: 1};
var A0 = new Date("2026-08-23T00:00:00Z").getTime(), A1 = new Date("2026-09-22T00:00:00Z").getTime();
function main() {
  return Events({from_date: "2026-08-23", to_date: "2026-09-21",
    event_selectors: [{event: "macro_viewed"}, {event: "viewer_source_opened"}, {event: "viewer_source_copied"}]})
  .filter(function (e) { return !isInternal(e.properties.client_domain) && okUser(e) && e.time >= A0 && e.time < A1; })
  .filter(function (e) { return e.name !== "macro_viewed" || (e.properties.surface === "viewer" && TEXT[e.properties.macro_type]); })
  .groupByUser(function (acc, events) {
      acc = acc || {pt: null, v: null, nv: 0, o: null, no: 0, c: 0};
      for (var i = 0; i < events.length; i++) { var e = events[i];
        if (e.name === "macro_viewed") { acc.nv++; if (acc.v === null || e.time < acc.v) acc.v = e.time; if (!acc.pt) acc.pt = e.properties.product_type || "none"; }
        else if (e.name === "viewer_source_opened") { acc.no++; if (acc.o === null || e.time < acc.o) acc.o = e.time; }
        else acc.c++; }
      return acc; })
  .filter(function (r) { return r.value.v !== null || r.value.o !== null; })
  .map(function (r) { return [r.key[0], r.value.pt, r.value.v, r.value.nv, r.value.o, r.value.no, r.value.c]; });
}
