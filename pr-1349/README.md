# PR #1349 evidence: render MCP `mcp_channel`

- BEFORE (baseline source): `3a5dd61c95e6e6e7a86905e7f13b482d97f8fe94` (merge-base with main)
- AFTER (candidate): `ce09ec475810beb60aebe77b20041ceefd6a94bd`

## How it was captured

In the PR worktree, with the candidate's new specs in place:

1. Replace `functions/agent-link/renderMcp.ts` and `workers/render-mcp/index.ts` with the baseline versions (`git show <BASE>:<file>`), then run
   `pnpm exec vitest --run functions/agent-link/renderMcp.spec.ts workers/render-mcp/index.spec.ts --sequence.seed=1 --reporter=verbose` → `before.txt`.
2. Restore the candidate files and run the same command → `after.txt`.

Output is filtered to the channel, `via` and internal tests plus the totals. The `( -> none)` empty-search case does not match the filter, but it is counted in the totals.

## Result

- BEFORE: 8 failed, 96 passed. `mcp_channel` absent; the Worker drops the query string.
- AFTER: 104 passed.

## Limits

Unit level only: Mixpanel delivery is stubbed. Whether real MCP hosts keep the query string on every POST is not verified. That needs a production deploy, because the preview Worker has no `MIXPANEL_TOKEN`.
