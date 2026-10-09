// bets_authors_first_success.js — per external user: first-ever macro_create_succeeded time and first-ever create-or-save success time since tracking start 2026-04-18 (legacy names included), through 2026-10-05; per-user rows, joined offline (raw output stays in scratchpad)
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"]; // re-add private/operations/internal-analytics-domain-exclusions.md before rerun
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== "unknown_user_account_id" && String(id).indexOf("$device:") !== 0; }
var CUR = new Date("2026-09-06T00:00:00Z").getTime();   // current 30d = 2026-09-06..2026-10-05
var PRI = new Date("2026-08-07T00:00:00Z").getTime();   // prior 30d   = 2026-08-07..2026-09-05
function win(t) { return t >= CUR ? "cur" : (t >= PRI ? "prior" : "pre"); }
function w(e) { return 1 / (Number(e.properties.sample_rate) || 1); }
function main() {
  return Events({from_date: "2026-04-18", to_date: "2026-10-05",
    event_selectors: [{event: "macro_create_succeeded"}, {event: "create_macro_end"}, {event: "macro_save_succeeded"}, {event: "edit_macro_end"}]})
  .filter(function (e) { return !isInternal(e.properties.client_domain) && okUser(e); })
  .groupByUser(function (acc, events) {
      acc = acc || {fc: null, fa: null};
      for (var i = 0; i < events.length; i++) { var e = events[i];
        var isCreate = (e.name === "macro_create_succeeded" || e.name === "create_macro_end");
        if (acc.fa === null || e.time < acc.fa) acc.fa = e.time;
        if (isCreate && (acc.fc === null || e.time < acc.fc)) acc.fc = e.time; }
      return acc; });
}
