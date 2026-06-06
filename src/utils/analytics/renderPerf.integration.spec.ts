// src/utils/analytics/renderPerf.integration.spec.ts
//
// Integration check for the instrumentation that the unit specs mock away:
// exercises the REAL renderPerf together with the REAL forgeGlobal.getContext
// memoization, in the order forgeIndex drives them. The load-bearing risk is
// that getContext only times its UNCACHED branch — so if context resolves more
// than once (it always does: forgeIndex calls getContext at :62, :65, :123…),
// context_ms must be recorded exactly once and survive the cache hits.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as renderPerf from "./renderPerf";
import { getContext } from "@/model/globals/forgeGlobal";
import forgeGlobalDefault from "@/model/globals/forgeGlobal";

// Real getView() dynamically imports @forge/bridge; mock it so the non-standalone
// path runs and sets global.forgeContext exactly like production.
vi.mock("@forge/bridge", () => ({
  view: {
    getContext: vi.fn(async () => ({
      extension: { type: "macro" },
      environmentType: "DEVELOPMENT",
      localId: "macro-int-test",
    })),
  },
}));

describe("renderPerf × getContext (integration)", () => {
  beforeEach(() => {
    renderPerf._resetForTesting();
    // Reset the memoized Forge context between cases.
    (forgeGlobalDefault as { forgeContext?: unknown }).forgeContext = undefined;
    (forgeGlobalDefault as { view?: unknown }).view = undefined;
    window.__macroLoadStart = performance.now() - 200; // pretend 200ms of bootstrap elapsed
  });

  afterEach(() => {
    delete (window as { __macroLoadStart?: number }).__macroLoadStart;
    renderPerf._resetForTesting();
  });

  it("records context_ms once and it survives repeated (memoized) getContext calls", async () => {
    // forgeIndex calls getContext multiple times; only the first does real work.
    const c1 = await getContext();
    const firstContextMs = renderPerf.getTimings().context_ms;
    expect(typeof firstContextMs).toBe("number"); // it actually fired — the core risk

    const c2 = await getContext(); // cache hit — must not re-time or clobber
    const c3 = await getContext();
    expect(c2).toBe(c1);
    expect(c3).toBe(c1);
    expect(renderPerf.getTimings().context_ms).toBe(firstContextMs);
  });

  it("populates all four phase timers through the real call order", async () => {
    renderPerf.markAppEntry();                                   // bootstrap_ms
    await getContext();                                          // context_ms (real getContext)
    await renderPerf.time("fetch", async () => ({ ok: true }));  // fetch_ms
    await renderPerf.time("render", async () => "<svg/>");       // render_ms

    const t = renderPerf.getTimings();
    expect(t.bootstrap_ms).toBeGreaterThanOrEqual(0);
    expect(typeof t.context_ms).toBe("number");
    expect(typeof t.fetch_ms).toBe("number");
    expect(typeof t.render_ms).toBe("number");
    expect(t.measured_sum_ms).toBe(
      (t.bootstrap_ms ?? 0) + (t.context_ms ?? 0) + (t.fetch_ms ?? 0) + (t.render_ms ?? 0),
    );
    expect(typeof t.tab_hidden).toBe("boolean");
  });
});
