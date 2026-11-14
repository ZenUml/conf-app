# PR #1171 Evidence Bundle (#1163)

- **Baseline SHA (`BEFORE`)**: `6736f3649ccb0db1f51279c17bfbb3b696714a16` (`origin/main`)
- **Candidate SHA (`AFTER`)**: `81cb6d518848026cecc14e81876853369404e761` (`refactor/issue-1163-state-globals`)

## Verification Summary

1. **Unit & Component Tests (`pnpm test:unit`)**:
   - `Test Files: 488 passed | 1 skipped (489)`
   - `Tests: 6826 passed | 3 skipped (6829)`
   - Added explicit assertions in `src/model/store2/store.spec.ts` verifying `ExtendedStore.actions === undefined`, `globals.apWrapper` is defined on `window.globals`, and `'isEmbedded' in globals === false`.
2. **Typecheck comparison (`npx tsc --noEmit`)**:
   - Baseline: 659 errors
   - Candidate (`81cb6d51`): 658 errors (0 new errors)
3. **Variant Builds**:
   - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build:full` — PASS
   - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build:diagramly` — PASS
   - `NODE_OPTIONS=--max-old-space-size=8192 PRODUCT_TYPE=lite npx vite build` — PASS
   - `NODE_OPTIONS=--max-old-space-size=8192 PRODUCT_TYPE=asyncapi npx vite build` — PASS
4. **UI Validation**:
   - N/A / SKIPPED: Pure internal state-commit wiring and dead-field removal with no visual or DOM change.
