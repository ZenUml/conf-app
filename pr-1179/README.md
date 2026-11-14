# PR #1179 Evidence Bundle (#1164)

- **Baseline SHA (`BEFORE`)**: `a4da5fdb709629d45b7efb2e1342ec12c8722b35` (`origin/main`)
- **Candidate SHA (`AFTER`)**: `81177e1332d449d513dca0a9ed91fe4190adea2d` (`refactor/issue-1164-paywall-policy`)

## Verification Summary

1. **Unit & Integration Tests (`pnpm test:unit`)**:
   - `Test Files: 491 passed | 1 skipped (492)`
   - `Tests: 6852 passed | 3 skipped (6855)`
   - Targeted specs (`space-status.spec.ts`, `fullscreenRecoveryEligibility.spec.ts`, `feature-flags.spec.ts`, `useCustomerSuccessService.spec.ts`, `useCustomerSuccessService.failopen.spec.ts`, `tests/unit/useCustomerSuccessService.spec.ts`, `warningBanner.staleSpace.spec.ts`): 7/7 files, 76/76 tests passed.
2. **Typecheck comparison (`npx tsc --noEmit`)**:
   - Baseline (`a4da5fdb`): 670 errors
   - Candidate (`81177e13`): 669 errors (0 new errors)
3. **Variant Builds**:
   - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build:full` — PASS
   - `NODE_OPTIONS=--max-old-space-size=8192 PRODUCT_TYPE=diagramly npx vite build` — PASS
   - `NODE_OPTIONS=--max-old-space-size=8192 PRODUCT_TYPE=lite npx vite build` — PASS
   - `NODE_OPTIONS=--max-old-space-size=8192 PRODUCT_TYPE=asyncapi npx vite build` — PASS
4. **UI Validation / Post-Rollout Verification**:
   - Storybook / Forge Tunnel / Staging UI: N/A (SKIPPED — backend/composable transport consolidation with no visual UI change).
   - Mixpanel `get_feature_flags` error streams (#1128 and #1131): verify event count reduction after production rollout.
