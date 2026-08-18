import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

// forgeIndex.ts's `main()` always runs BOTH phases:
//   1. initializeCriticalPath() — dispatches on context.extension?.type and
//      mounts a dedicated Vue tree (get-started, byline, page banner,
//      homepage feed, ...) for "non-macro" surfaces, returning
//      { macroData: null } early.
//   2. loadHeavyComponents(criticalData) — ALWAYS called by main(), even
//      when phase 1 already fully handled and returned early. It re-derives
//      its own `context` and independently decides whether to skip, via a
//      hardcoded extension.type allow-list.
//
// Regression (PR #509, found live on lite-dev 2026-08-19): confluence:
// homepageFeed was added to phase 1's dispatch (it correctly mounts
// HomepageFeedCard.vue) but NOT to phase 2's skip-list. loadHeavyComponents
// therefore ran anyway, treated the load as a normal macro viewer, and
// remounted #app with GenericViewer's "diagram data is no longer available"
// state — clobbering the card that phase 1 had just mounted. No existing
// unit test exercises this file's real two-phase flow (forgeIndex.ts has no
// spec of its own — it's Forge-bridge- and DOM-bootstrap-heavy), so the gap
// went uncaught. This test does not exercise the runtime — it's a static
// invariant check that the two phases' extension-type sets stay in sync,
// which is exactly the check that would have caught this bug and will catch
// the next module type someone adds to only one of the two phases.
describe('forgeIndex.ts — phase 1 / phase 2 routing stay in sync', () => {
  const source = fs.readFileSync('src/forgeIndex.ts', 'utf8');

  it('every extension.type that phase 1 (initializeCriticalPath) mounts its own Vue tree for is also in phase 2 (loadHeavyComponents)\'s skip-list', () => {
    // Phase 1 boundary: from `async function initializeCriticalPath()` to
    // the next top-level `async function`.
    const phase1Match = source.match(
      /async function initializeCriticalPath\(\)[\s\S]*?\n(?=async function )/,
    );
    expect(phase1Match).not.toBeNull();
    const phase1Body = phase1Match![0];

    // Every `context.extension?.type === 'confluence:X'` check in phase 1
    // that is followed (within a few lines) by `return { macroData: null }`
    // — i.e. it fully owns the render and phase 2 must not also run.
    const earlyReturnTypes = new Set<string>();
    const typeCheckRe = /context\.extension\?\.type === '(confluence:[a-zA-Z]+)'/g;
    let m: RegExpExecArray | null;
    while ((m = typeCheckRe.exec(phase1Body))) {
      earlyReturnTypes.add(m[1]);
    }
    // Sanity: this test is only meaningful if it actually found the known
    // early-return branches — guards against the regex silently matching
    // nothing after a future refactor.
    expect(earlyReturnTypes.size).toBeGreaterThanOrEqual(4);

    // Phase 2's skip-list: the array literal passed to `.includes(
    // context.extension?.type)` inside loadHeavyComponents.
    const phase2Match = source.match(
      /\[\s*((?:'confluence:[a-zA-Z]+'\s*,?\s*)+)\]\.includes\(context\.extension\?\.type\)/,
    );
    expect(phase2Match).not.toBeNull();
    const phase2Types = new Set(
      Array.from(phase2Match![1].matchAll(/'(confluence:[a-zA-Z]+)'/g)).map(x => x[1]),
    );

    for (const type of earlyReturnTypes) {
      expect(phase2Types.has(type)).toBe(true);
    }
  });

  it('confluence:homepageFeed is in both phases (regression guard, PR #509)', () => {
    const homepageFeedOccurrences = source.match(/'confluence:homepageFeed'/g) || [];
    // At least once in phase 1 (the dispatch `if`) and once in phase 2 (the
    // skip-list array).
    expect(homepageFeedOccurrences.length).toBeGreaterThanOrEqual(2);
  });
});
