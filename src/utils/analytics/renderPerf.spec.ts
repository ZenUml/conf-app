// src/utils/analytics/renderPerf.spec.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { markAppEntry, time, getTimings, markAdfDeferred, _resetForTesting } from "./renderPerf";

describe("renderPerf", () => {
  let nowSpy: ReturnType<typeof vi.spyOn>;
  let clock = 0;

  beforeEach(() => {
    _resetForTesting();
    clock = 1000;
    // Deterministic clock: each performance.now() call advances by 50ms.
    nowSpy = vi.spyOn(performance, "now").mockImplementation(() => {
      const v = clock;
      clock += 50;
      return v;
    });
    window.__macroLoadStart = 900;
  });

  afterEach(() => {
    nowSpy.mockRestore();
    delete (window as { __macroLoadStart?: number }).__macroLoadStart;
    _resetForTesting();
  });

  it("markAppEntry records bootstrap_ms = now − __macroLoadStart, once", () => {
    markAppEntry(); // now=1000, start=900 → 100
    expect(getTimings().bootstrap_ms).toBe(100);

    markAppEntry(); // second call is a no-op even though the clock advanced
    expect(getTimings().bootstrap_ms).toBe(100);
  });

  it("markAppEntry no-ops when __macroLoadStart is unset", () => {
    delete (window as { __macroLoadStart?: number }).__macroLoadStart;
    markAppEntry();
    expect(getTimings().bootstrap_ms).toBeUndefined();
  });

  it("time() records a phase duration once (first resolution wins)", async () => {
    await time("fetch", async () => "a"); // start=1000, end=1050 → 50
    expect(getTimings().fetch_ms).toBe(50);

    // A later (memoized cache-hit) call must not overwrite the real measurement.
    await time("fetch", async () => "b");
    expect(getTimings().fetch_ms).toBe(50);
  });

  it("time() returns the wrapped function's value", async () => {
    const result = await time("render", async () => 42);
    expect(result).toBe(42);
  });

  it("time() still records when the wrapped function throws", async () => {
    await expect(time("context", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(getTimings().context_ms).toBe(50);
  });

  it("getTimings sums only the phases that ran into measured_sum_ms", async () => {
    markAppEntry();            // bootstrap = 100
    await time("fetch", async () => null);  // 50
    const t = getTimings();
    expect(t.bootstrap_ms).toBe(100);
    expect(t.fetch_ms).toBe(50);
    expect(t.context_ms).toBeUndefined();   // never ran → undefined, not 0
    expect(t.render_ms).toBeUndefined();
    expect(t.measured_sum_ms).toBe(150);    // 100 + 50, absent phases excluded
  });

  it("tab_hidden defaults to the document's current hidden state", () => {
    expect(typeof getTimings().tab_hidden).toBe("boolean");
  });
});

describe('P1.3 fetch split', () => {
  beforeEach(() => _resetForTesting());

  it('records cc_fetch and adf_scan as custom_content_fetch_ms / page_adf_fetch_ms', async () => {
    await time('cc_fetch', async () => 'cc');
    await time('adf_scan', async () => 'adf');
    const t = getTimings();
    expect(t.custom_content_fetch_ms).toBeTypeOf('number');
    expect(t.page_adf_fetch_ms).toBeTypeOf('number');
  });

  it('excludes sub-phases from measured_sum_ms', async () => {
    await time('fetch', async () => {
      await time('cc_fetch', async () => 'cc');
    });
    const t = getTimings();
    expect(t.measured_sum_ms).toBe(t.fetch_ms);
  });

  it('emits adf_deferred only when marked', async () => {
    expect(getTimings().adf_deferred).toBeUndefined();
    markAdfDeferred(true);
    expect(getTimings().adf_deferred).toBe(true);
  });
});
