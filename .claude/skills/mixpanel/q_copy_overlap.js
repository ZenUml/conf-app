// Overlap between the two copy actions on the same viewer toolbar, since the
// Copy for AI Lite release. If the same people use both, the two funnels are
// not independent populations and the comparison is contaminated.
function main() {
  var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"];
  return Events({
    from_date: "2026-07-30",
    to_date: "2026-08-11",
    event_selectors: [{ event: "copy_for_ai_clicked" }, { event: "viewer_source_copied" }],
  })
    .filter(function (e) {
      var d = e.properties["client_domain"];
      if (!d) return false;
      for (var i = 0; i < INTERNAL.length; i++) {
        if (d.indexOf(INTERNAL[i]) !== -1) return false;
      }
      return true;
    })
    .groupBy([function (e) { return e.distinct_id; }, function (e) { return e.name; }], mixpanel.reducer.count());
}
