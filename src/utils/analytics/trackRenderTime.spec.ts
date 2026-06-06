// src/utils/analytics/trackRenderTime.spec.ts

import { describe, it, expect, vi, afterEach } from "vitest";
import { measureCacheState } from "./trackRenderTime";

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

afterEach(() => vi.restoreAllMocks());

describe("measureCacheState", () => {
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
