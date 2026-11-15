# Plan and usage per-space purchase evidence

PR1192: https://github.com/ZenUml/conf-app/pull/1192
Base597cc5633. Runtime UI-tested commit a87551e9. Final PR head0ce0578c adds IMPACT-MAP.md only. Synthetic CI candidate308542f9 and actual merge6ecceaed have identical tree21212a4af895a9544415d385e69deceaff3414aa.

## Comparable UI

Baseline main and candidate Storybook use the same fictional example-tenant ENG118/100 fixture, Chromium1280×1000, fullscreen preview with manager toolbar retained. Before has Space/count columns; after adds the one-space price/checkout and preserves site-wide Full actions. Other final-* images/snapshots cover mixed space/user licenses, exact100, personal key, unknown, pending, empty and Fullscreen-source states. capture-storybook.py records the capture steps and DOM assertions. All layout/text is the implementation, not Figma.

## Ordered live validation

Storybook six-state assertions passed at runtime a87551e9, then Forge Tunnel used the same source via localhost:8000 with Vite modules, then candidate CI deployment was verified on Lite staging. See tunnel-ui-evidence.md and staging-ui-evidence.md. Live staging rendered two confirmed unpaid rows, including exactly100; separate clicks produced distinct lite-stg__SD and lite-stg__ATSEED01 native external-link confirmation targets. Confirmations were cancelled. No payment or Stripe fulfillment validation was performed. Live snapshots/source observations were emitted in the Codex chat and retained as durable text excerpts here.

## Automated validation

Final lint0 errors(138 existing warnings), focused5 files/72 tests passed, Lite build passed including Studio and MCP view. Initial full unit invocation passed492 files and skipped1;2 discovery files failed because the separate E2E workspace dependencies were absent. Both passed(10 tests) after pnpm --ignore-workspace install --frozen-lockfile. Final affected suites were rerun for final runtime source.

Owner explicitly authorized manual full PR test triage. Current-head unit/build, preview, latest export, Render MCP and authoritative PR pipeline succeeded. Full E2E:120 passed,8 explicit environment-guard skips,0 failed;one Edit-gate UI assertion passed on Playwright retry1. Lite evidence complete=false, render complete=true. See full-e2e-results.md/json for scope, counts, skip reasons and the retry limitation, and full-ci-provenance.json for exact run identities. No workflow retry or code fix was used to obtain PR results.

## Post-merge

Merged to main as6ecceaedc641515b070e1dee6afe27b42302fd04. Main CI43774744430 completed success for this exact merge. All four variant builds/staging/auth/E2E passed; selected main E2E22 passed/1 explicit Embed guard skip, no retries. All four draft releases target the merge. See main-ci-results.md; this result is separately observed, not inferred from PR CI. No production release was started.

## Remaining limits

Repository vue-tsc1.8/TypeScript5.9 fails at startup(supportedTSExtensions); no typecheck pass claimed. Optional guarded E2E journeys are not counted as passes. The one retried UI assertion has no proved cause and is not described as fixed. Personal/paid/unknown/pending and Fullscreen purchase states were observed in Storybook and unit tests, without manufacturing paid/live tenant states.
