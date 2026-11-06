// src/utils/analytics/trackRenderTime.spec.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { measureCacheState, trackRenderTime } from "./trackRenderTime";
import { trackAnalyticsEvent } from "./trackAnalyticsEvent";
import { getRenderIdentity } from "./renderIdentity";
import forgeGlobal from "@/model/globals/forgeGlobal";
import { setDiagramFontState, _resetDiagramFontStateForTesting } from "@/utils/fonts/diagramFontState";

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

// Keep the post-render prefetch hook inert by default (jsdom would otherwise
// schedule real timers/imports); the scheduleRendererPrefetch suite below
// flips isPrefetchDue per test.
vi.mock("@/utils/prefetch/throttle", () => ({
  isPrefetchDue: vi.fn(() => false),
}));

vi.mock("@/utils/prefetch/rendererPrefetch", () => ({
  runRendererPrefetchIfDue: vi.fn(async () => undefined),
}));

import { isPrefetchDue } from "@/utils/prefetch/throttle";
import { runRendererPrefetchIfDue } from "@/utils/prefetch/rendererPrefetch";
import {
  maybeGateViewerRender,
  awaitGateBlocking,
  _resetForTesting as _resetGateForTesting,
} from "@/utils/renderGate/maybeGateViewerRender";

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

  describe("license_active", () => {
    const originalContext = forgeGlobal.forgeContext;

    function viewedProps(): Record<string, unknown> {
      trackRenderTime("mermaid", true);
      return vi.mocked(trackAnalyticsEvent).mock.calls[0][1] as unknown as Record<string, unknown>;
    }

    afterEach(() => {
      forgeGlobal.forgeContext = originalContext;
      vi.unstubAllEnvs();
    });

    it.each([true, false])("sends Forge license.active=%s on Full", (active) => {
      vi.stubEnv("PRODUCT_TYPE", "full");
      forgeGlobal.forgeContext = { ...originalContext, license: { active } };
      expect(viewedProps().license_active).toBe(active);
    });

    it("omits the property on Full when Forge supplies no boolean", () => {
      vi.stubEnv("PRODUCT_TYPE", "full");
      forgeGlobal.forgeContext = { ...originalContext, license: undefined };
      expect(viewedProps()).not.toHaveProperty("license_active");
    });

    it("omits the property on Lite, where Forge reports false for a free app", () => {
      vi.stubEnv("PRODUCT_TYPE", "lite");
      forgeGlobal.forgeContext = { ...originalContext, license: { active: false } };
      expect(viewedProps()).not.toHaveProperty("license_active");
    });
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

  it("adds diagram_font to sequence macro_viewed only once the font load was attempted", () => {
    _resetDiagramFontStateForTesting();
    trackRenderTime("sequence", true);
    expect(vi.mocked(trackAnalyticsEvent).mock.calls.at(-1)![1]).not.toHaveProperty("diagram_font");

    setDiagramFontState("fallback");
    trackRenderTime("sequence", true);
    expect(vi.mocked(trackAnalyticsEvent).mock.calls.at(-1)![1]).toMatchObject({ diagram_font: "fallback" });

    setDiagramFontState("plex");
    trackRenderTime("sequence", true);
    expect(vi.mocked(trackAnalyticsEvent).mock.calls.at(-1)![1]).toMatchObject({ diagram_font: "plex" });

    trackRenderTime("mermaid", true);
    expect(vi.mocked(trackAnalyticsEvent).mock.calls.at(-1)![1]).not.toHaveProperty("diagram_font");
    _resetDiagramFontStateForTesting();
  });

  it("stamps instance_nonce and time_origin on macro_viewed", () => {
    trackRenderTime("mermaid", true);

    const [, props] = vi.mocked(trackAnalyticsEvent).mock.calls.at(-1)!;
    expect(props).toEqual(expect.objectContaining(getRenderIdentity()));
  });

  it("keeps instance_nonce constant across emissions from one module instance", () => {
    trackRenderTime("mermaid", true);
    trackRenderTime("mermaid", true);

    const [a, b] = vi.mocked(trackAnalyticsEvent).mock.calls.slice(-2).map((c) => c[1]);
    expect(a.instance_nonce).toBe(b.instance_nonce);
  });

  it("merges viewport-gate telemetry into macro_viewed when the gate ran (#382)", async () => {
    await maybeGateViewerRender({
      getFlag: async () => true,
      awaitTurn: async () => ({
        outcome: "background",
        deferredMs: 4321,
        visibleAtBoot: false,
      }),
    });
    // blocking is measured at the mount-site await, not from the gate's age
    await awaitGateBlocking(Promise.resolve());
    trackRenderTime("sequence", true);

    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({
        render_gate: "background",
        render_deferred_ms: expect.any(Number),
        visible_at_boot: false,
      }),
    );
    _resetGateForTesting();
  });

  it("adds no gate properties when the gate never ran", () => {
    trackRenderTime("sequence", true);

    const [, props] = vi.mocked(trackAnalyticsEvent).mock.calls.at(-1)!;
    expect(props).not.toHaveProperty("render_gate");
    expect(props).not.toHaveProperty("render_deferred_ms");
    expect(props).not.toHaveProperty("visible_at_boot");
  });
});

describe("scheduleRendererPrefetch (post-render hook)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    window.__macroLoadStart = performance.now();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as { __macroLoadStart?: number }).__macroLoadStart;
    vi.restoreAllMocks();
  });

  it("schedules the orchestrator at idle, excluding the just-rendered family", async () => {
    vi.mocked(isPrefetchDue).mockReturnValue(true);

    trackRenderTime("mermaid", true);
    expect(runRendererPrefetchIfDue).not.toHaveBeenCalled(); // idle-deferred

    await vi.advanceTimersByTimeAsync(3_000); // jsdom has no rIC → setTimeout fallback
    await vi.waitFor(() => expect(runRendererPrefetchIfDue).toHaveBeenCalledOnce());
    expect(runRendererPrefetchIfDue).toHaveBeenCalledWith({
      host: "macro",
      excludeRenderers: ["mermaid"],
    });
  });

  it("excludes nothing for embed (it can wrap any renderer)", async () => {
    vi.mocked(isPrefetchDue).mockReturnValue(true);

    trackRenderTime("embed", true);
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.waitFor(() => expect(runRendererPrefetchIfDue).toHaveBeenCalledOnce());
    expect(vi.mocked(runRendererPrefetchIfDue).mock.calls[0][0].excludeRenderers).toEqual([]);
  });

  it("does not schedule anything when the prefetch is not due", async () => {
    vi.mocked(isPrefetchDue).mockReturnValue(false);

    trackRenderTime("graph", true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(runRendererPrefetchIfDue).not.toHaveBeenCalled();
  });
});

describe("trackRenderTime content_state (#113)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.__macroLoadStart = performance.now();
  });

  afterEach(() => {
    delete (window as { __macroLoadStart?: number }).__macroLoadStart;
  });

  it("adds content_state to macro_viewed when the caller supplies one", () => {
    trackRenderTime("sequence", true, "live_render", "none", "authored");

    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({ content_state: "authored" })
    );
  });

  it("omits the key entirely when there is no verdict", () => {
    trackRenderTime("sequence", true);

    const [, props] = vi.mocked(trackAnalyticsEvent).mock.calls[0];
    expect(props).not.toHaveProperty("content_state");
  });
});

describe("trackRenderTime view_of_day", () => {
  const originalContext = forgeGlobal.forgeContext;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.__macroLoadStart = performance.now();
    forgeGlobal.forgeContext = { ...originalContext, localId: "macro-local-1" };
  });

  afterEach(() => {
    delete (window as { __macroLoadStart?: number }).__macroLoadStart;
    forgeGlobal.forgeContext = originalContext;
    vi.restoreAllMocks();
  });

  it("sends the first render of the day unsampled, marked first", () => {
    trackRenderTime("mermaid", true);

    const [, props] = vi.mocked(trackAnalyticsEvent).mock.calls[0];
    expect(props).toEqual(expect.objectContaining({ view_of_day: "first" }));
    expect(props).not.toHaveProperty("sample_rate");
  });

  it("sends a sampled-in repeat with sample_rate 0.1", () => {
    trackRenderTime("mermaid", true);
    vi.spyOn(Math, "random").mockReturnValue(0.05);
    trackRenderTime("mermaid", true);

    const [, props] = vi.mocked(trackAnalyticsEvent).mock.calls[1];
    expect(props).toEqual(expect.objectContaining({ view_of_day: "repeat", sample_rate: 0.1 }));
  });

  it("drops a sampled-out repeat", () => {
    trackRenderTime("mermaid", true);
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    trackRenderTime("mermaid", true);

    expect(trackAnalyticsEvent).toHaveBeenCalledTimes(1);
  });

  it("counts the editor surface separately from the viewer", () => {
    trackRenderTime("mermaid", true);
    trackRenderTime("mermaid", false);

    const [, props] = vi.mocked(trackAnalyticsEvent).mock.calls[1];
    expect(props).toEqual(expect.objectContaining({ surface: "editor", view_of_day: "first" }));
  });

  it("sends at full rate without view_of_day when the macro has no id", () => {
    forgeGlobal.forgeContext = { ...originalContext, localId: undefined };
    trackRenderTime("mermaid", true);
    trackRenderTime("mermaid", true);

    expect(trackAnalyticsEvent).toHaveBeenCalledTimes(2);
    expect(vi.mocked(trackAnalyticsEvent).mock.calls[1][1]).not.toHaveProperty("view_of_day");
  });
});
