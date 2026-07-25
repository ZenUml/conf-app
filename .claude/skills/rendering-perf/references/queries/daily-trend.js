function main() {
  var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "dia-stg",
                  "asyncapi-stg", "diagramly", "danshuitaihejie"];
  return Events({
    from_date: "2026-07-11",
    to_date: "2026-07-25",
    event_selectors: [{ event: "macro_viewed" }]
  })
  .filter(function (e) {
    var p = e.properties;
    if (p.surface !== "viewer") return false;
    if (p.tab_hidden === true) return false;
    if (typeof p.duration_ms !== "number" || p.duration_ms <= 0) return false;
    var dom = p.client_domain;
    if (!dom) return false;
    dom = String(dom).toLowerCase();
    for (var i = 0; i < INTERNAL.length; i++) {
      if (dom.indexOf(INTERNAL[i]) !== -1) return false;
    }
    return true;
  })
  .groupBy([function (e) {
    return new Date(e.time).toISOString().slice(0, 10);
  }], [
    mixpanel.reducer.count(),
    mixpanel.reducer.numeric_percentiles("properties.duration_ms", [50, 90])
  ]);
}
