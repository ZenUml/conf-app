function main() {
  return Events({
    from_date: '2026-11-10',
    to_date: '2026-11-17',
    event_selectors: [{
      event: 'related_diagrams_lookup_failed',
      selector: 'properties["error_kind"] == "stale_index"',
    }],
  }).groupBy(
    ['properties.stale_reason', 'properties.product_type'],
    mixpanel.reducer.count(),
  );
}
