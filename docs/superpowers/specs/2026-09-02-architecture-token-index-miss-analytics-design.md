# Architecture Tokens — index-miss analytics design

**Date:** 2026-09-02  
**Status:** Approved in conversation; awaiting document review before implementation  
**Scope:** Analytics observability only; no UI or lookup-result behavior change

## 1. Problem

`relatedDiagrams()` deliberately fails open when the current custom content has no rows in
`ArchitectureTokenOccurrence`: it returns an empty successful response with `indexedAt: null`.
The viewer currently records every response without `error_kind` as
`related_diagrams_lookup_succeeded`. Consequently, an unindexed diagram is indistinguishable in
analytics from an indexed diagram that legitimately has no accessible related pages.

This ambiguity occurred in a tenant investigation on 2026-09-02: the current Lite build
recorded successful lookups with zero participants and no `index_age_days`, while the same custom
content IDs were absent from the latest local index corpus. No lookup failure was recorded. The
immediate runtime state is therefore an index miss, but the existing event contract cannot state
that directly.

## 2. Decision

Keep the existing `related_diagrams_lookup_succeeded` event and add one required outcome property
for newly deployed clients:

| Property | Values | Meaning |
|---|---|---|
| `lookup_outcome` | `indexed` | The current custom content had index rows and the lookup completed without `error_kind`. |
| `lookup_outcome` | `index_miss` | The current custom content had no index rows; the endpoint returned its intentional empty fail-open response. |

This is a successful transport/application response, so `index_miss` must not be sent as
`related_diagrams_lookup_failed`. That event remains reserved for timeout, network/HTTP errors,
`confluence_unavailable`, `stale_index`, and other response `error_kind` values.

Historical `related_diagrams_lookup_succeeded` records will have `lookup_outcome` unset. Reports
must treat unset as pre-deployment data rather than infer an outcome.

### Alternatives rejected

1. **Add `related_diagrams_lookup_index_missed`.** This is explicit, but fragments one lookup
   population across event names and makes success-rate and rollout comparisons harder.
2. **Record index misses as `related_diagrams_lookup_failed`.** This would pollute the reliability
   signal even though the endpoint intentionally returns a safe empty result.
3. **Infer the outcome only in Mixpanel from missing `index_age_days`.** This relies on an indirect
   property absence and preserves the ambiguity in the event contract.

## 3. Backend contract

`RelatedResponse` gains `lookup_outcome: 'indexed' | 'index_miss'` on non-error responses.

- `occurrencesForContent(...)` returns no rows: return `lookup_outcome: 'index_miss'` with the
  existing `indexedAt: null`, `contentVersion: null`, and empty `participants` values.
- Index rows exist and the lookup completes: return `lookup_outcome: 'indexed'` with the existing
  payload.
- Responses carrying `error_kind` do not need an outcome; they continue down the failure telemetry
  path and never emit `related_diagrams_lookup_succeeded`.

The frontend response type will accept the property as optional during rolling deployment. For an
older backend response, the viewer derives the same value from the existing invariant:
`indexedAt === null` means `index_miss`; otherwise `indexed`. This prevents a transient unlabelled
window when frontend and backend versions overlap.

## 4. Analytics contract

No new event is introduced.

| Event | Trigger | New property |
|---|---|---|
| `related_diagrams_lookup_succeeded` | A lookup response without `error_kind`, after the diagram has rendered | `lookup_outcome: 'indexed' | 'index_miss'` |

Existing count properties remain unchanged. An `index_miss` naturally reports zero participants
and no `index_age_days`; dashboards should use `lookup_outcome`, not those secondary symptoms, for
classification. The property contains no tenant, diagram, participant, or user vocabulary.

Repository policy requires the feature branch's first commit to register this contract in
`src/utils/analytics/catalog.ts` and `src/utils/analytics/types.ts`. The event catalog documentation
will describe the new property in the same commit.

## 5. Frontend behavior

`RelatedDiagramsFooter.load()` includes `lookup_outcome` on
`related_diagrams_lookup_succeeded`. Indicator rendering, footer copy, popover behavior, and link
opening are unchanged. In particular, index misses remain silent to the reader.

## 6. Verification

Implementation follows a focused red-green sequence:

1. Service test: an unindexed diagram returns `lookup_outcome: 'index_miss'` and still performs no
   resolver call.
2. Service test: an indexed successful lookup returns `lookup_outcome: 'indexed'`.
3. Viewer test: `related_diagrams_lookup_succeeded` includes the backend outcome.
4. Viewer compatibility test: a response without the new field derives the outcome from
   `indexedAt`.
5. Existing failure tests prove responses/errors still emit only
   `related_diagrams_lookup_failed`.
6. Run focused service, frontend, analytics-catalog tests and TypeScript validation. No UI spot
   check is required because the design intentionally changes no UI behavior.

## 7. Rollout monitoring

After deployment, query the target tenant every 30 minutes for:

- `related_diagrams_lookup_succeeded`, split by `lookup_outcome` and app version;
- `related_diagrams_lookup_failed`, split by `error_kind`;
- `related_token_indicators_shown`;
- `related_diagram_popover_opened`;
- `related_diagram_link_clicked`.

Popover opens and link clicks are the primary engagement outcomes. `index_miss` is diagnostic
context, not proof that the customer attempted to open a related diagram.
