// src/utils/analytics/trackRenderTime.spec.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { measureCacheState, trackRenderTime } from "./trackRenderTime";
import { trackAnalyticsEvent } from "./trackAnalyticsEvent";

vi.mock("./trackAnalyticsEvent", () => ({
  trackAnalyticsEvent: vi.fn(),
}));

vi.mock("./renderPerf", () => ({
  getTimings: vi.fn(() => ({
    bootstrap_ms: 300,
    context_ms: 250,
    fetch_ms: 450,
    render_ms: 40,
    measured_sum_ms: 1040,
    tab_hidden: false,
  })),
}));

const ORIGIN = location.origin;

function entry(
  name: string,
  initiatorType: string,
  transferSize: number,
): PerformanceResourceTiming {
  return { name, initiatorType, transferSize } as unknown as PerformanceResourceTiming;
}

function mockResources(entries: PerformanceResourceTiming[]): void {
  vi.spyOn(performance, "getEntriesByType").mockReturnValue(
    entries as unknown as PerformanceEntryList,
  );
}

describe("measureCacheState", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports cold when a same-origin script downloaded over the wire", () => {
    mockResources([entry(`${ORIGIN}/assets/index-abc.js`, "script", 780000)]);
    expect(measureCacheState()).toEqual({
      cacheState: "cold",
      transferBytes: 780000,
    });
  });

  it("reports warm when same-origin scripts are served from cache (transferSize 0)", () => {
    mockResources([
      entry(`${ORIGIN}/assets/index-abc.js`, "script", 0),
      entry(`${ORIGIN}/assets/vendor-def.js`, "script", 0),
    ]);
    expect(measureCacheState()).toEqual({ cacheState: "warm", transferBytes: 0 });
  });

  it("treats a small 304-revalidation byte count as warm", () => {
    mockResources([entry(`${ORIGIN}/assets/index-abc.js`, "script", 320)]);
    expect(measureCacheState()).toEqual({ cacheState: "warm", transferBytes: 320 });
  });

  it("sums multiple same-origin scripts and crosses the threshold", () => {
    mockResources([
      entry(`${ORIGIN}/a.js`, "script", 6000),
      entry(`${ORIGIN}/b.js`, "script", 6000),
    ]);
    expect(measureCacheState()).toEqual({
      cacheState: "cold",
      transferBytes: 12000,
    });
  });

  it("matches .js by name even when initiatorType is not 'script'", () => {
    mockResources([entry(`${ORIGIN}/assets/chunk-xyz.js?v=1`, "link", 200000)]);
    expect(measureCacheState()).toEqual({
      cacheState: "cold",
      transferBytes: 200000,
    });
  });

  it("ignores cross-origin scripts (transferSize unreliable) → unknown when none same-origin", () => {
    mockResources([entry("https://cdn.example.com/x.js", "script", 500000)]);
    expect(measureCacheState()).toEqual({ cacheState: "unknown" });
  });

  it("returns unknown when there are no resource entries", () => {
    mockResources([]);
    expect(measureCacheState()).toEqual({ cacheState: "unknown" });
  });

  it("returns unknown when only non-script resources are present", () => {
    mockResources([entry(`${ORIGIN}/img/logo.png`, "img", 5000)]);
    expect(measureCacheState()).toEqual({ cacheState: "unknown" });
  });

  it("returns unknown when Resource Timing throws", () => {
    vi.spyOn(performance, "getEntriesByType").mockImplementation(() => {
      throw new Error("nope");
    });
    expect(measureCacheState()).toEqual({ cacheState: "unknown" });
  });
});

describe("trackRenderTime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set the start marker the function reads; index.html sets this in prod.
    window.__macroLoadStart = performance.now();
  });

  afterEach(() => {
    delete (window as { __macroLoadStart?: number }).__macroLoadStart;
    vi.restoreAllMocks();
  });

  it("defaults render_mode='live_render' and cache_source='none' for the 2-arg callers", () => {
    trackRenderTime("mermaid", true);

    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({
        macro_type: "mermaid",
        surface: "viewer",
        render_mode: "live_render",
        cache_source: "none",
      })
    );
  });

  it("emits render_mode='cached_svg' and cache_source='cc_body' for a cached render", () => {
    trackRenderTime("mermaid", true, "cached_svg", "cc_body");

    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({
        render_mode: "cached_svg",
        cache_source: "cc_body",
      })
    );
  });

  it("maps isDisplayMode=false to the editor surface", () => {
    trackRenderTime("mermaid", false);

    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({ surface: "editor" })
    );
  });

  it("includes a numeric duration_ms", () => {
    trackRenderTime("mermaid", true);

    const [, props] = vi.mocked(trackAnalyticsEvent).mock.calls[0];
    expect(typeof props.duration_ms).toBe("number");
  });

  it("no-ops when window.__macroLoadStart is not set (test/headless mounts)", () => {
    delete (window as { __macroLoadStart?: number }).__macroLoadStart;

    trackRenderTime("mermaid", true);

    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
  });

  it("merges renderPerf phase timings into the macro_viewed payload", () => {
    trackRenderTime("mermaid", true);

    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({
        bootstrap_ms: 300,
        context_ms: 250,
        fetch_ms: 450,
        render_ms: 40,
        measured_sum_ms: 1040,
        tab_hidden: false,
      })
    );
  });
});
