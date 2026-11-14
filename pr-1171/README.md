# PR #1171 Evidence Bundle (#1163)

- **Baseline SHA (`BEFORE`)**: `2b05c511be1da43f1a1db40dff1c9433969c0bb7` (`origin/main`)
- **Candidate SHA (`AFTER`)**: `d680b1ea9a8a858311c0087faf83d490e8477b1f` (`refactor/issue-1163-state-globals`)

## Verification Summary

1. **Unit & Component Tests (`pnpm test:unit`)**:
   - `Test Files: 488 passed | 1 skipped (489)`
   - `Tests: 6826 passed | 3 skipped (6829)`
   - Added explicit assertions in `src/model/store2/store.spec.ts` verifying `ExtendedStore.actions === undefined`, `globals.apWrapper` is defined on `window.globals`, and `'isEmbedded' in globals === false`.
2. **Typecheck comparison (`npx tsc --noEmit`)**:
   - Baseline (`2b05c511`): 659 errors
   - Candidate (`d680b1ea`): 658 errors (0 new errors)
3. **Variant Builds**:
   - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build:full` — PASS
   - `NODE_OPTIONS=--max-old-space-size=8192 pnpm build:diagramly` — PASS
   - `NODE_OPTIONS=--max-old-space-size=8192 PRODUCT_TYPE=lite npx vite build` — PASS
   - `NODE_OPTIONS=--max-old-space-size=8192 PRODUCT_TYPE=asyncapi npx vite build` — PASS
4. **UI Validation**:
   - N/A / SKIPPED: Pure internal state-commit wiring and dead-field removal with no visual or DOM change.
