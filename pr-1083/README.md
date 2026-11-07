# PR #1083 review evidence

## Comparison

- BEFORE: `6c1ed1795c6b0d2159be8f7db748bf5481705d99`
- AFTER: `3f9c62ac8d06a712f2c85fce4cb905f936ad679c`
- Scope: browser-side analytics sampling for AI Chat and AI Repair.
- Environment: local Vitest under Node.js; no customer or staging data.
- UI/viewport: not applicable because this change has no visible UI.

## Reproduction

1. Add the regression test from `src/utils/analytics/eventSampling.spec.ts` to the baseline.
2. Run `pnpm exec vitest --run src/utils/analytics/eventSampling.spec.ts`.
3. Observe the baseline failure at the first explicit-retention assertion.
4. Run the same test at the candidate commit and observe all 21 tests pass.
5. Run the complete unit suite and focused lint/diff checks.

## Observed result

The baseline configuration places 22 of the 26 event names in the ongoing reduced list. The candidate explicitly protects all 26 names at rate 1, removes the 22 reduced names, and bypasses RNG for every event in the two families.

- [Red/green transcript](./red-green.txt)
- [Validation summary](./validation.txt)

## Limits

This evidence proves the local sampling decision and sender-path regression coverage. It does not recover historically dropped events or prove production Mixpanel arrival after deployment. CI status is linked separately from the PR description because it changes after this immutable bundle is published.
