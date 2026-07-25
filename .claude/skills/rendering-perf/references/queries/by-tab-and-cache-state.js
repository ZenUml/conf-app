function main() {
  var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "dia-stg",
                  "asyncapi-stg", "diagramly", "danshuitaihejie"];
  var P = [50, 75, 90, 95, 99];
  return Events({
    from_date: "2026-07-18",
    to_date: "2026-07-25",
    event_selectors: [{ event: "macro_viewed" }]
  })
  .filter(function (e) {
    var p = e.properties;
    if (p.surface !== "viewer") return false;
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
    return e.properties.tab_hidden === true ? "hidden" : "visible";
  }, function (e) {
    return e.properties.cache_state || "unset";
  }], [
    mixpanel.reducer.count(),
    mixpanel.reducer.numeric_percentiles("properties.duration_ms", P),
    mixpanel.reducer.numeric_percentiles("properties.custom_content_fetch_ms", [50, 90]),
    mixpanel.reducer.numeric_percentiles("properties.page_adf_fetch_ms", [50, 90]),
    mixpanel.reducer.numeric_percentiles("properties.fetch_ms", [50, 90])
  ]);
}
