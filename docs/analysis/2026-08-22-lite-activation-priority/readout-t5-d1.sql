-- Intentionally non-analytical. Do not replace this guard with the originally
-- proposed per-space author query.
--
-- Forge CustomContent / CustomContentVersion rows identify the Lite app but do
-- not carry tenant domain or cloudId. Confluence spaceId is scoped to a tenant,
-- so grouping Lite rows by spaceId can merge unrelated customer spaces. The
-- valid 90-day author readout is readout-t5-authors.js, which uses Mixpanel's
-- client_domain + confluence_space identity and distinct_id (account id).
SELECT
  'unsupported_identity' AS status,
  'Use readout-t5-authors.js; Forge D1 cannot identify a tenant space.' AS next_step;
