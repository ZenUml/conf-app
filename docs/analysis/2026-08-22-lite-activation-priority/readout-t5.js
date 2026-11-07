// Mixpanel JQL: 30-day template-offer funnel, counted as distinct spaces.
// Before running, replace RELEASE_DATE and append the private exclusions from
// private/operations/internal-analytics-domain-exclusions.md to INTERNAL.

var RELEASE_DATE = "<RELEASE>";
var INTERNAL = [
  "zenuml",
  "whimet",
  "full-stg",
  "lite-stg",
  "lite-dev",
  "dia-stg",
  "asyncapi-stg",
  "diagramly",
];

function isInternal(domain) {
  if (!domain) return true;
  for (var i = 0; i < INTERNAL.length; i++) {
    if (domain.indexOf(INTERNAL[i]) !== -1) return true;
  }
  return false;
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function main() {
  var release = new Date(RELEASE_DATE + "T00:00:00Z");
  if (!isFinite(release.getTime())) {
    throw new Error("Replace <RELEASE> with the production release date");
  }
  var end = new Date(release.getTime() + 30 * 86400000);

  return Events({
    from_date: ymd(release),
    to_date: ymd(end),
    event_selectors: [
      { event: "template_offer_shown" },
      { event: "template_offer_clicked" },
      { event: "template_created" },
      { event: "template_create_failed" },
      { event: "template_offer_dismissed" },
    ],
  })
    .filter(function (event) {
      return (
        event.properties.product_type === "lite" &&
        !isInternal(event.properties.client_domain)
      );
    })
    .groupBy(
      [
        "name",
        function (event) {
          return (
            event.properties.client_domain +
            "/" +
            event.properties.confluence_space
          );
        },
        function (event) {
          return String(event.properties.failure_reason || "");
        },
      ],
      mixpanel.reducer.count(),
    )
    .groupBy(
      [
        function (row) {
          return row.key[0] + "|" + row.key[2];
        },
      ],
      mixpanel.reducer.count(),
    );
}
