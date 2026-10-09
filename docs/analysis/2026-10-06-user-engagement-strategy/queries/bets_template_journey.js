// bets_template_journey.js — create journeys (gallery/template events up to 60s before started are merged in; (macro_create_started -> next started / succeeded / cancelled / 2h timeout) per product_type x window: gallery trigger, template applied (+template_id), success; external tenants; 2026-08-07..10-05
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"]; // re-add private/operations/internal-analytics-domain-exclusions.md before rerun
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function okUser(e) { var id = e.distinct_id; return !!id && id !== "unknown_user_account_id" && String(id).indexOf("$device:") !== 0; }
var CUR = new Date("2026-09-06T00:00:00Z").getTime();   // current 30d = 2026-09-06..2026-10-05
var PRI = new Date("2026-08-07T00:00:00Z").getTime();   // prior 30d   = 2026-08-07..2026-09-05
function win(t) { return t >= CUR ? "cur" : (t >= PRI ? "prior" : "pre"); }
function w(e) { return 1 / (Number(e.properties.sample_rate) || 1); }
var TEXT = {sequence: 1, mermaid: 1, plantuml: 1, markdown: 1};
var TIMEOUT = 2 * 60 * 60 * 1000;
var PRE = 60 * 1000;
function main() {
  return Events({from_date: "2026-08-07", to_date: "2026-10-05",
    event_selectors: [{event: "macro_create_started"}, {event: "editor_template_gallery_opened"}, {event: "editor_template_applied"}, {event: "macro_create_succeeded"}, {event: "macro_create_cancelled"}]})
  .filter(function (e) { return !isInternal(e.properties.client_domain) && okUser(e); })
  .groupByUser(function (acc, events) {
      // macro_create_started fires after the editor mounts (forgeIndex.ts trackPageEditorAuthoringStarted), and the
      // gallery auto-opens on mount, so gallery/template events of a new macro can land just BEFORE its started event.
      // They are held as `pending` and merged into the next started event within PRE ms.
      acc = acc || {j: [], cur: null, pend: null, orphanSucc: []};
      function close(outcome) { if (acc.cur) { acc.cur.outcome = outcome; acc.j.push(acc.cur); acc.cur = null; } }
      function target(e) { if (acc.cur && e.time - acc.cur.t <= PRE) return acc.cur;
        if (!acc.pend || e.time - acc.pend.t > PRE) acc.pend = {t: e.time, gallery: "none", applied: 0, tid: "-"}; return acc.pend; }
      for (var i = 0; i < events.length; i++) { var e = events[i], p = e.properties;
        if (acc.cur && e.time - acc.cur.t > TIMEOUT) close("timeout");
        if (e.name === "macro_create_started") {
          close("restarted");
          acc.cur = {t: e.time, pt: p.product_type || "none", win: win(e.time), text: TEXT[p.macro_type] ? "text" : "other", entry: p.entry_point || "?", gallery: "none", applied: 0, tid: "-"};
          if (acc.pend && e.time - acc.pend.t <= PRE) { acc.cur.gallery = acc.pend.gallery; acc.cur.applied = acc.pend.applied; acc.cur.tid = acc.pend.tid; }
          acc.pend = null;
        } else if (e.name === "editor_template_gallery_opened") {
          if (p.is_new_macro === false) continue;
          var g = (p.template_gallery_trigger === "auto_first_open") ? target(e) : (acc.cur || target(e));
          if (g.gallery === "none" || p.template_gallery_trigger === "manual") g.gallery = String(p.template_gallery_trigger);
        } else if (e.name === "editor_template_applied") {
          if (p.is_new_macro === false) continue;
          var a = acc.cur || target(e); a.applied = 1; a.tid = String(p.template_id);
        } else if (e.name === "macro_create_succeeded") {
          if (acc.cur) close("success"); else acc.orphanSucc.push({pt: p.product_type || "none", win: win(e.time), outcome: "orphan_success", text: "-", entry: "-", gallery: "-", applied: 0, tid: "-"});
        } else if (e.name === "macro_create_cancelled") { close("cancelled"); }
      }
      return acc; })
  .map(function (r) { var a = r.value; var out = a.j.concat(a.orphanSucc); if (a.cur) { var c = a.cur; c.outcome = "open_at_end"; out.push(c); } return out; })
  .flatten()
  .groupBy(["pt", "win", "text", "gallery", "applied", "tid", "outcome"], mixpanel.reducer.count());
}
