// Mixpanel JQL: first Lite authors per template-created space, 90 days before
// versus 90 days after release. This replaces the proposed D1 query because
// Forge D1 rows have no tenant id and Confluence spaceId is site-scoped.
//
// Before running, replace RELEASE_DATE and append the private exclusions from
// private/operations/internal-analytics-domain-exclusions.md to INTERNAL.

var RELEASE_DATE = "<RELEASE>";
var TRACKING_START = "2026-04-18";
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

function usableUser(event) {
  var id = event.distinct_id;
  return (
    !!id &&
    id !== "unknown_user_account_id" &&
    id.indexOf("$device:") !== 0
  );
}

function spaceKey(event) {
  return (
    event.properties.client_domain +
    "/" +
    event.properties.confluence_space
  );
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function main() {
  var release = new Date(RELEASE_DATE + "T00:00:00Z");
  if (!isFinite(release.getTime())) {
    throw new Error("Replace <RELEASE> with the production release date");
  }
  var beforeStart = release.getTime() - 90 * 86400000;
  var afterEnd = release.getTime() + 90 * 86400000;
  var templateWindowEnd = release.getTime() + 30 * 86400000;

  return Events({
    from_date: TRACKING_START,
    to_date: ymd(new Date(afterEnd)),
    event_selectors: [
      { event: "template_created" },
      { event: "macro_create_succeeded" },
      // Tracking begins in April 2026 and the create event was renamed during
      // that month. Include the legacy name so an April author is not falsely
      // counted as new in the 90-day pre-period.
      { event: "create_macro_end" },
    ],
  })
    .filter(function (event) {
      return (
        event.properties.product_type === "lite" &&
        !isInternal(event.properties.client_domain) &&
        event.properties.confluence_space &&
        event.properties.confluence_space !== "unknown_space"
      );
    })
    .groupBy(
      [spaceKey],
      function (accumulator, events) {
        accumulator = accumulator || {
          templateCreatedIn30d: false,
          firstCreateByUser: {},
        };
        for (var i = 0; i < events.length; i++) {
          var event = events[i];
          if (
            event.name === "template_created" &&
            event.time >= release.getTime() &&
            event.time < templateWindowEnd
          ) {
            accumulator.templateCreatedIn30d = true;
          }
          if (
            (event.name === "macro_create_succeeded" ||
              event.name === "create_macro_end") &&
            usableUser(event)
          ) {
            var user = String(event.distinct_id);
            var first = accumulator.firstCreateByUser[user];
            if (first === undefined || event.time < first) {
              accumulator.firstCreateByUser[user] = event.time;
            }
          }
        }
        return accumulator;
      },
    )
    .filter(function (row) {
      return row.value.templateCreatedIn30d;
    })
    .map(function (row) {
      var before = 0;
      var after = 0;
      var firstCreates = row.value.firstCreateByUser;
      for (var user in firstCreates) {
        if (!Object.prototype.hasOwnProperty.call(firstCreates, user)) continue;
        var firstAt = firstCreates[user];
        if (firstAt >= beforeStart && firstAt < release.getTime()) before++;
        if (firstAt >= release.getTime() && firstAt < afterEnd) after++;
      }
      return {
        space: row.key[0],
        new_authors_before_90d: before,
        new_authors_after_90d: after,
        leverage_ratio: before === 0 ? null : after / before,
      };
    });
}
