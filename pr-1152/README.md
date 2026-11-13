# PR 1152 bootstrap foundation evidence

Baseline: `5fc739dd3e7a449e4052ac7d3bacceffb21e1bae` (main). Candidate: `8d429113625457099b0ef672eebb2612404477e0`.

The existing PR checks, staging PR validation, generated-label publisher, Jev resolver and planner are byte-for-byte unchanged. `results.json` records their SHA-256 comparisons. New E2E runner guard inputs default to false, preserving existing calls. The separate guarded child is inert until PR 1006 activates it.

Local validation on candidate contents:

- `pnpm lint`: 0 errors, 140 existing product-source warnings.
- `pnpm test:unit`: 6744 passed, 3 skipped.
- `node --test scripts/ci/*.node-test.mjs scripts/test-selection/tests/*.node-test.mjs`: 304 passed; raw output in `policy-node-results.txt`.
- `pnpm build:lite`: running at evidence capture; GitHub CI and final PR body provide final status.

Independent review found no P1/P2 in additive controller security and legacy compatibility. The runtime candidate planner must consume the optional authorization inputs when activation occurs.

No user-facing product code changes; Storybook, tunnel and manual Confluence UI validation are N/A. This bundle does not claim the new decision flow has been activated or that browser E2E has passed. Those are separate GitHub runs linked in the PR body.
