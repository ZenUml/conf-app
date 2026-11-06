# Mixpanel Export Insert ID Repair

## Problem

`trackExportEvent` builds `$insert_id` by concatenating the event name, cloud ID,
page ID, custom-content ID, and timestamp. The resulting value is longer than
Mixpanel's 36-byte limit and contains underscores. In staging, Mixpanel stores
only the first 36 characters, which end before the page and macro identity.
Exports of multiple macros therefore collide and Mixpanel keeps only a subset
of the emitted events.

## Design

Generate `$insert_id` with `crypto.randomUUID()` for every export event. A UUID
is 36 characters, uses only hexadecimal characters and hyphens, and provides a
distinct key even when two macro export handlers run in the same millisecond.
The event's existing join properties (`cloud_id`, `page_id`, and
`custom_content_id`) remain unchanged and continue to provide semantic identity
for analysis.

This is a correction to existing analytics transport behavior. It adds no new
events or properties, so the analytics catalog and property types do not change.

## Error Handling

No new failure path is introduced. The Forge Node.js runtime provides
`crypto.randomUUID()`. Existing Mixpanel request handling, timeout behavior, and
non-blocking analytics failure behavior remain unchanged.

## Testing

Extend the existing same-page, same-millisecond, two-macro test through the
public `handler` interface. For each emitted `$insert_id`, assert:

- the two macros receive distinct identifiers;
- each identifier is at most 36 UTF-8 bytes;
- each identifier contains only ASCII alphanumeric characters and hyphens.

Use a red-green cycle: first demonstrate the deployed concatenated IDs fail the
constraints, then make the smallest production change and rerun the focused
export-handler tests.
