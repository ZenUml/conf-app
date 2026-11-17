// Splits related_diagrams_lookup_failed (error_kind: stale_index) by case and by the writer
// of the stale index rows. Mixpanel project 3373228. Rows with null stale_reason or null
// index_source are events from a frontend or backend older than these properties.
function main() {
  return Events({
    from_date: '2026-11-10',
    to_date: '2026-11-17',
    event_selectors: [{
      event: 'related_diagrams_lookup_failed',
      selector: 'properties["error_kind"] == "stale_index"',
    }],
  }).groupBy(
    ['properties.stale_reason', 'properties.index_source', 'properties.product_type'],
    mixpanel.reducer.count(),
  );
}
