# PR #1205 evidence: which case a `stale_index` lookup failure was

- BEFORE: `c029a687` (`main`, the PR's merge base).
- AFTER: `661db0eb` (PR head when captured).
- No UI change. All fixtures are fictional (diagram `1`, index rows at version 3).

## How it was captured

Both probes run the base branch's file and the candidate's file in one vitest process, on the
same input, so the only difference is the code.

| Probe | BEFORE code | AFTER code | Faked |
|---|---|---|---|
| `backend.probe.spec.ts` | `git show c029a687:functions/architecture-tokens/service.ts`, saved as `service.base.ts` beside the real file | `functions/architecture-tokens/service.ts` | D1 rows; Confluence `GET /api/v2/custom-content` answer |
| `footer.probe.spec.ts` | `git show c029a687:src/components/Viewer/RelatedDiagramsFooter.vue`, saved as `RelatedDiagramsFooter.base.vue` | `src/components/Viewer/RelatedDiagramsFooter.vue` | the lookup response; `trackAnalyticsEvent` |

To repeat: copy each probe next to the file it imports (`functions/architecture-tokens/` and
`src/components/Viewer/`), create the two `.base` files with the `git show` commands above, run
`npx vitest --run <probe>`, then delete the four temporary files.

## Results

- `backend-response.before-after.json`: the lookup response for four Confluence answers.
  `participants` is shortened to its length.
- `footer-event.before-after.json`: for five response bodies, the events fired, the properties
  of `related_diagrams_lookup_failed` (without `duration_ms`, which is a timing), and the
  rendered HTML. The HTML is the same string before and after in every case: two `v-if`
  placeholders, nothing visible.

## Mixpanel query

`stale_reason_split.jql.js` is the query that splits `stale_index` by `stale_reason`. Run on
2026-11-17 for 2026-11-10..17 (before release, internal sites not excluded) it returned one row:
`stale_reason: null`, `product_type: lite`, 1,828 events. After release the same query returns
one row per reason; `null` rows are events from a frontend or backend older than this PR.

## Limits

- Unit-level only. Not run on Forge tunnel or staging: there is nothing visible to check, and
  the properties cannot be seen in Mixpanel until both the backend and the frontend are deployed.
- The probes fake Confluence. They do not show how often each case happens in production; that
  is what the new properties are for.
