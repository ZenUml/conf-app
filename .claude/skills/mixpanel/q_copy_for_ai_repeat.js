// Copy for AI repeat cohort: distinct active DAYS per copier since the Lite
// release (2026-07-30). The decision rule's override is "repeat cohort
// (>=2 distinct days)" — one-shot curiosity clicks do not count as demand.
// Returns one row per (user, day) so the caller counts distinct days.
function main() {
  var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"];
  return Events({
    from_date: "2026-07-30",
    to_date: "2026-08-11",
    event_selectors: [{ event: "copy_for_ai_clicked" }],
  })
    .filter(function (e) {
      var d = e.properties["client_domain"];
      if (!d) return false;
      for (var i = 0; i < INTERNAL.length; i++) {
        if (d.indexOf(INTERNAL[i]) !== -1) return false;
      }
      return true;
    })
    .groupBy(
      [
        function (e) { return e.distinct_id; },
        function (e) { return e.properties["client_domain"]; },
        function (e) { return new Date(e.time).toISOString().slice(0, 10); },
      ],
      mixpanel.reducer.count(),
    );
}
