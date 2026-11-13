# PR 1006 activation evidence

Baseline (trusted foundation): `f85f3867d1747098241ab94fa96514ca3931e2f0`.
Candidate: `21182f6f2f6aa9e310f341527253620bafdd0468`.

## Comparable behavior

Run `node <symlinked-checkout>/scripts/test-selection/pr-decision.mjs inspect --pr` with the same invalid missing-value input. Baseline exits zero without output because the symlinked entry path does not match import.meta.url. Candidate resolves the real entry path, executes argument validation, and exits one with `Expected --name value`. `cli-before-after.json` contains actual outputs. Invalid input is rejected before any GitHub API call.

The new workflow uses an immutable current-commit collaborator decision rather than legacy Jev labels. `validation.json` pins the exact head, trusted baseline, decision and local results; `policy-node-results.txt` contains raw local policy test output. Actual GitHub results are linked in the PR body and must be checked independently; they were pending at this evidence capture.

Product build inputs are unchanged from the validated foundation. Confluence UI stages are N/A. Local unit suite: 6748 passed, 3 skipped; final policy/CI Node suite: 351 passed. Independent final review found no P1/P2 in trusted checkout, provenance, API inventory, catalog parity or concurrency.
