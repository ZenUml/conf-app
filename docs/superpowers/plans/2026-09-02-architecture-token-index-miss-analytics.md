# Architecture Tokens index-miss analytics implementation plan

**Spec:** `docs/superpowers/specs/2026-09-02-architecture-token-index-miss-analytics-design.md`

## Slice 1 — backend outcome contract

1. Add failing assertions to `functions/architecture-tokens/service.spec.ts` for both successful
   outcomes: no own occurrence rows → `index_miss`; indexed success → `indexed`.
2. Run the focused service test and preserve the RED output.
3. Add the outcome to the backend `RelatedResponse` success variants in
   `functions/architecture-tokens/service.ts`.
4. Re-run the focused service test to GREEN.

## Slice 2 — frontend tracking and rolling compatibility

1. Extend `src/services/ArchitectureTokens.ts` with the optional response outcome used during a
   rolling deploy.
2. Add failing assertions to `src/components/Viewer/RelatedDiagramsFooter.spec.ts` that the success
   event carries the backend outcome and derives it from `indexedAt` when an older response omits
   the field.
3. Run the focused footer test and preserve the RED output.
4. Include `lookup_outcome` in the success tracking call, with the specified compatibility
   fallback. Do not change rendering or failure tracking.
5. Re-run the focused footer test to GREEN.

## Slice 3 — verification and handoff

1. Run both focused suites plus the analytics contract suite.
2. Run repository TypeScript validation and any directly affected build check exposed by
   `package.json`.
3. Review the final diff for privacy, event-name stability, and unchanged UI behavior.
4. Commit implementation, then report the exact tests and remaining deployment dependency.
