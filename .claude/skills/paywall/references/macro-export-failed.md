# macro_export_failed — Investigation Reference

Findings from the 2026-05-15 investigation into export failure patterns.
Join-key tracking (PR #84, merged 2026-05-14) enabled this analysis.

---

## Event pipeline

```
macro_export_requested
  → macro_export_succeeded
  → macro_export_failed  (with failure_reason)
```

The export handler (`src/export.js`) fires these backend events. The join keys `(cloud_id, custom_content_id, page_id)` link them to frontend `attachment_upload_*` events from `src/model/Attachment.ts`.

---

## How the export works

1. A Confluence user exports a page to Word or PDF.
2. Forge triggers the export handler with the page + macro context.
3. The handler looks up `zenuml-<customContentId>.png` via the Confluence attachments API.
4. If found → returns the PNG → `macro_export_succeeded`.
5. If not found → `macro_export_failed`.

**The PNG is created by the viewer**, not the export handler. When a user views a page containing a ZenUML macro in their browser, the viewer renders the diagram and uploads the PNG as a Confluence attachment. If nobody has ever viewed a diagram in the browser, the PNG does not exist and every export will fail.

---

## Failure breakdown (30-day window, as of 2026-05-15)

| failure_reason | count | % | meaning |
|---|---|---|---|
| `attachment_not_found` | 442 | 65% | PNG attachment never uploaded, or attachment API returned empty |
| `unexpected_error` | 184 | 27% | Unhandled exception in export handler |
| `attachments_api_404` | 50 | 7% | Page not accessible (restricted, deleted) |
| `missing_custom_content_id` | 6 | 1% | Macro config missing `customContentId` |
| `attachments_api_429` | 1 | 0% | Rate-limited |

Overall: **683 failures vs 2,228 successes** across ~130 tenants = 23% failure rate.

---

## Transient vs persistent failures

**1-hour funnel (same session):** 24% of failures self-resolve within ~9 min (avg 549s).
**7-day funnel:** 46% of failures eventually lead to a success within 7 days.

This means **~54% of failures are persistent** — the user never successfully exports after failing.

### Recovery time distribution

| Speed | Range | Pattern |
|---|---|---|
| Near-instant (< 10s) | werosoft (6s), katalon (1s), zeptonow (1s) | Classic race condition — export triggered before PNG upload finished; upload completes seconds later |
| Short (10s–10min) | cerby (111s), vin3s (453s), mariadbcorp (489s) | User saves diagram, waits, re-exports |
| Long (> 10min) | airwallex (2,209s), jira-adiq (2,966s), buckaroonl (3,312s) | User returned later and retried |

---

## The race condition (fast-recovery cases)

Sequence of events causing a near-instant transient failure:

1. User opens a page → Forge loads the ZenUML viewer iframe.
2. Confluence triggers a page export (Word/PDF) in parallel.
3. Export handler runs → calls attachments API → PNG not yet uploaded → `attachment_not_found`.
4. Viewer finishes rendering and uploads PNG (seconds later).
5. User retries export → `macro_export_succeeded`.

**Fix:** Add retry-with-backoff in `export.js` before emitting `macro_export_failed`. Three retries × 2s = 6s max wait eliminates most race-condition failures without user action.

---

## The structural missing-attachment case (buildout pattern)

**buildout.atlassian.net** is the clearest example:
- 54 failures, 0 successes, 0 `macro_viewed` events in 30 days.
- All failures started 2026-05-12 (a batch page export was triggered).
- 37 `attachment_not_found` + 17 `unexpected_error`.
- Metrics-inspect returns 0 — no macros ever saved.

**Root cause:** buildout users exported pages to Word/PDF without anyone ever having viewed the ZenUML macros in a browser first. The PNG was never created.

**Immediate workaround for affected tenants:** Open each page containing a ZenUML macro in a browser. The viewer uploads the PNG; subsequent exports succeed.

**Long-term fix:** Server-side PNG rendering during export (no dependency on the client viewer having run first), or embed the DSL as a code block fallback when no PNG exists.

---

## The unhandled format bug (`unexpected_error` for email/other)

buildout's 17 `unexpected_error` failures break down as:

| format | count |
|---|---|
| `email` | 8 |
| `other` | 8 |
| `word` | 1 |

`email` = Confluence "Send page by email" feature. `other` = third-party integrations.

The export handler in `export.js` only accounts for `word` and `pdf`. When `payload.exportType` is `email` or `other`, the handler crashes with an unhandled exception instead of returning gracefully.

**Fix:** Check `format` early in the handler and return a no-op (empty document or unsupported-format notice) for any format that isn't `word` or `pdf`.

---

## Tenants with persistent 0% recovery (worth proactive outreach)

| Tenant | failures (30d) | dominant reason | notes |
|---|---|---|---|
| buildout | 54 | attachment_not_found + unexpected_error | All started 2026-05-12; 0 macro views ever |
| kempower | 16 | (check) | Has 15 successes on different exports — failure sessions don't recover |
| moonactive | 14 | (check) | 39 total successes — failure sessions don't recover |
| gip-onshore | 11 | (check) | 5 total successes |
| impact | 9 | (check) | 25 total successes |

---

## Queries for follow-up

```bash
# Per-tenant failure reasons
python3 .claude/skills/paywall/scripts/paywall_queries.py daily

# Mixpanel: upload events for a specific tenant (requires join keys — only reliable for events after 2026-05-14)
# Filter attachment_upload_failed / attachment_upload_skipped by client_domain

# Check if tenant has any macro_viewed events
# mcp__claude_ai_Mixpanel__Run-Query: event=macro_viewed, filter client_domain equals <domain>

# Forge install status
pnpm forge install list 2>&1 | grep <domain>

# Macro counts (proves whether diagrams exist and have been saved)
curl -s "https://conf-lite.zenuml.com/admin/metrics-inspect?domain=<subdomain>"
```

---

## Key dates

| Date | Event |
|---|---|
| 2026-05-14 | PR #84 merged — added join keys `(cloud_id, custom_content_id, page_id)` to all export + upload events |
| 2026-05-12 | buildout batch export started (all failures begin here) |
| 2026-05-15 | Investigation completed; transient vs persistent pattern identified |
