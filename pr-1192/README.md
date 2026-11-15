# Plan and usage: per-space purchase

Baseline: `597cc5633` (main). Candidate: `a87551e9` (`codex/plan-usage-space-purchase`).
Design: https://www.figma.com/design/xyLOTL0IvXNszqFCKCdAp0/Conf-App?node-id=614-3183
Requirement: ZenUml/conf-app-private#19 (no customer data in this evidence).

## Comparable UI
Storybook, Lite, fixture tenant `example-tenant`, Chromium viewport1280x1000, fullscreen preview with manager toolbar retained. Baseline server source: primary main checkout; candidate source: isolated feature worktree. Open manager story `plan-and-usage-planusage--default` for both captures. Same ENG118/100 usage fixture. Before has only Space/count columns; after adds price and one-space checkout while preserving Full actions.

Other candidate stories: `space-purchases`, `paid-status-unavailable`, `paid-status-pending`, `no-spaces-over-limit`, `fullscreen-ordinary-space`. These use fictional fixture rows, including paid space/user licenses, unknown status, exactly100, and personal space.

## Tests
Initial full suite at631a07ad:492 files passed,1 file skipped;2 discovery files failed because E2E subproject dependencies were missing. Installed the separately managed E2E workspace with `pnpm --ignore-workspace install --frozen-lockfile`. Both failed files then passed (10 tests). No source fix was needed for those failures.
Final affected tests ata87551e9:5 files/72 tests passed. Final lint:0 errors,138 repository warnings. Lite build includes AsyncAPI Studio and MCP view.
Typecheck limitation: existing vue-tsc1.8/TypeScript5.9 tooling crashes on `supportedTSExtensions` before checking code; no typecheck pass claimed.

## Limits
Storybook stubs backend/Forge responses and is not live integration evidence. Native Stripe payment completion is out of scope and must never be performed.
Forge Tunnel, CI staging and E2E outcomes will be recorded separately once observed. The trusted default-branch scenario registry has no PR E2E coverage for `paywall × plan-usage` or `site-usage × plan-usage`; subset authorization cannot be inferred from the page-banner navigation test.
