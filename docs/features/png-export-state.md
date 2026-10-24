# PNG export lifecycle state

The Confluence PNG attachment is authoritative during PDF and Word export. The exporter queries it first. Only when it is absent, it reads a page content property keyed by page and custom content ID, then returns a short ADF text placeholder explaining a fresh state. Missing, invalid, stale, or inaccessible properties preserve the existing unknown-missing error path. Property writes are best effort and cannot block a diagram save or turn a working attachment into a placeholder.

| Event | Trigger | Key properties |
| --- | --- | --- |
| `png_export_state_changed` | A lifecycle transition is persisted by browser or async upload worker | `page_id`, `custom_content_id`, `png_export_state`, `surface`, `macro_type` when known |
| `png_export_state_persistence_failed` | A best-effort page property read or write fails | `page_id`, `custom_content_id`, `png_export_property_operation`, `failure_reason`, `surface` |
| `macro_export_placeholder_shown` | An attachment is missing and a fresh known state produces text ADF | Export join keys, `png_export_placeholder_reason`, `format`; sampled separately from failures |
| `macro_export_failed` (existing) | Attachment lookup fails, or the first unexplained missing attachment | Existing join keys and `failure_reason`; subsequent fresh `missing` state uses the placeholder event |

The property carries a bounded state vocabulary, attempt identity, content hash or revision, timestamp, page ID, custom content ID, and optional attachment ID. In-progress states have a short expiry; terminal failures have a longer bounded expiry. A new generation attempt replaces prior failure state. A terminal result updates only its matching attempt, so an old async result cannot overwrite a newer ready attachment. Exports never use state if attachment lookup itself fails.
