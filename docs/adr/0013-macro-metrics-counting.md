# 0013 — How the frontend counts macros in a space

Date: 2026-11-21
Status: accepted (records decisions already in the code)
Related: [0005-asyncapi-macro-in-lite-full-feasibility.md](0005-asyncapi-macro-in-lite-full-feasibility.md), `src/services/MacroMetrics.ts`, `src/composables/useCustomerSuccessService.ts`, `functions/metrics-cache/`, issues #215, #302, #1132, #1136

## Context

The Lite paywall decides from the number of macros in a space. `MacroMetrics`
produces that count on two paths: the save path (`reportMacroMetrics`, fire and
forget) and the read/gate path (`getMacroMetrics`, awaited before the editor or
fullscreen viewer opens). Both write the result to the backend KV cache
(`/metrics-cache/update`), which other readers and analytics use.

These decisions were recorded as code comments in `MacroMetrics.ts` and its
spec until the comment audit of 2026-11-21 moved them here.

## Decisions

1. **Count from the V2 space custom-content endpoint.** `/api/v2/spaces/{id}/custom-content`,
   paginated per macro content type, is the system of record. The v1 CQL content
   search is backed by the search index and returns too few results for large or
   bulk-grown spaces, which made the paywall count too low (#215).
2. **Stop counting at the paywall limit on the gate path only.** The gate path passes
   a ceiling (the paywall limit, 100) and stops as soon as the total reaches it. The
   paywall decision cannot change above the limit, and a huge space must not stall
   the awaited editor or fullscreen mount while it lists thousands of items. The save
   path passes no ceiling and lists everything, so the cached and analytics count
   stays accurate.
3. **Snapshot-managed spaces have one writer.** When the KV record is in `snapshot`
   mode, the backend's scheduled snapshot is the only writer. The save path checks
   the mode and returns without listing the space, so it never races the scheduled
   whole-object commit. On the gate path any stored metrics are a hit, whether
   snapshot or legacy; only an empty snapshot record is a miss, and that miss must
   not fall through to a fresh listing.
4. **Every macro lands in exactly one bucket.** A type without a bucket counts as
   `unknown`, never as `NaN`, because the backend rejects a payload whose buckets
   do not sum to `total` (`assertCounts`; error radar 2026-11-16 saw
   `HTTP 400: Macro count invariant failed` from 9 tenants). `unknown` means corrupt
   or unreadable content.
5. **AsyncAPI has a bucket but no `DiagramTypeConfig` entry.** Lite ships the AsyncAPI
   macro under the shared sequence content type (ADR-0005 Option A), so it needs its
   own bucket to stay out of `unknown`. It renders through AsyncAPI Studio, not the
   `storeUpdateAction` plumbing that `DiagramTypeConfig` describes, so a full config
   would give it unvalidated capabilities (agent-link writes, the diagram portal, the
   template gallery). `EXTRA_METRIC_FIELDS` maps it instead, typed as
   `keyof IMacroMetrics` so a misspelled field fails to compile rather than producing
   `undefined++`.
6. **Results say where the count came from.** `getMacroMetrics` returns
   `source: 'kv'` for a cache hit (which may be too low) and `source: 'collect'` for a
   fresh listing. The paywall gate sends it as `macro_count_source` (#302).
7. **Failures are reported once and never swallowed.** A failed KV write is tracked:
   a silent failure once left counts that were too low in the cache with no signal.
   Errors inside the listing propagate to `reportMacroMetrics` / `getMacroMetrics`,
   which track them once as `report_macro_metrics`; a local catch would send the
   event twice. Errors are tracked as `name: message`, because
   `JSON.stringify(new Error())` is `{}` and lost the cause (#1132, #1136).
