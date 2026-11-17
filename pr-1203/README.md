# PR 1203 evidence: stale index rebuild

- BEFORE: commit `e61d9830` (main `f7957630` plus the new test file only). AFTER: commit `a50b16dd`.
- Probe: `functions/api/architecture-tokens/related.heal.spec.ts` drives the real route, lookup and
  save-time index writer against migration `0021` in in-memory SQLite (`node:sqlite`). Only Confluence
  is faked. All ids are fictional fixtures.
- Command: `npx vitest --run functions/architecture-tokens functions/api/architecture-tokens` (green);
  `npx vitest --run functions/api/architecture-tokens/related.heal.spec.ts` (red, at `e61d9830`).
- `red.txt`: 7 of 7 fail at BEFORE; the first failure is `expected 'stale_index' to be undefined`.
- `green.txt`: 51 of 51 pass at AFTER.
- Mutation checks at AFTER (not committed): removing the user-token gate in `related.ts` fails the 403
  test; writing under a cloudId parsed from `apiBaseUrl` fails 3 heal tests.
- Limits: no live Confluence, no real D1 latency, no staging run. Local paths were removed from the logs.
