import { describe, it, expect } from "vitest";
import {
  sampleRateFor,
  decideSample,
  EVENT_SAMPLE_RATES,
} from "./eventSampling";

describe("eventSampling", () => {
  describe("sampleRateFor", () => {
    it("defaults unknown events to 1 (always emit)", () => {
      expect(sampleRateFor("macro_viewed")).toBe(1);
      expect(sampleRateFor("macro_save_succeeded")).toBe(1);
      expect(sampleRateFor("paywall_triggered")).toBe(1);
      expect(sampleRateFor("something_brand_new")).toBe(1);
    });

    it("returns 0 for an event explicitly configured to never emit", () => {
      // No production event is currently rate-0 (the last two — renderer
      // prefetch's telemetry — were deleted 2026-09-02 along with their
      // emit call sites), but the mechanism itself (rate 0 = never emit,
      // documented above EVENT_SAMPLE_RATES) must still work for whichever
      // event needs it next. A synthetic key exercises the branch without
      // depending on today's config.
      const key = "__test_zero_rate_event__";
      EVENT_SAMPLE_RATES[key] = 0;
      try {
        expect(sampleRateFor(key)).toBe(0);
      } finally {
        delete EVENT_SAMPLE_RATES[key];
      }
    });

    it("samples the high-volume diagnostics to 10%", () => {
      expect(sampleRateFor("convert_to_png")).toBe(0.1);
      expect(sampleRateFor("upload_attachment")).toBe(0.1);
      expect(sampleRateFor("duplication_detect")).toBe(0.1);
      expect(sampleRateFor("space_admin_active")).toBe(0.1);
      expect(sampleRateFor("click")).toBe(0.1);
    });

    it("matches create_attachment<diagramType> variants by prefix", () => {
      expect(sampleRateFor("create_attachment")).toBe(0.1);
      expect(sampleRateFor("create_attachmentmermaid")).toBe(0.1);
      expect(sampleRateFor("create_attachmentplantuml")).toBe(0.1);
      expect(sampleRateFor("create_attachmentsequence")).toBe(0.1);
    });

    it("leaves error / funnel events at full fidelity", () => {
      // not in the map → full rate, so incident detection & funnels stay intact
      expect(sampleRateFor("attachment_upload_failed")).toBe(1);
      expect(sampleRateFor("viewer_load_failed")).toBe(1);
      expect(sampleRateFor("save_failed")).toBe(1);
      expect(sampleRateFor("csat_displayed")).toBe(1);
      expect(sampleRateFor("macro_create_succeeded")).toBe(1);
    });
  });

  describe("decideSample", () => {
    it("always keeps rate-1 events with rate 1", () => {
      const d = decideSample("macro_viewed", () => 0.999999);
      expect(d).toEqual({ keep: true, rate: 1 });
    });

    it("never keeps rate-0 events", () => {
      const key = "__test_zero_rate_event__";
      EVENT_SAMPLE_RATES[key] = 0;
      try {
        const d = decideSample(key, () => 0);
        expect(d).toEqual({ keep: false, rate: 0 });
      } finally {
        delete EVENT_SAMPLE_RATES[key];
      }
    });

    it("keeps a fractional event only when rng falls under the rate", () => {
      // rate 0.1 — rng 0.05 < 0.1 → keep; rng 0.5 ≥ 0.1 → drop
      expect(decideSample("convert_to_png", () => 0.05)).toEqual({
        keep: true,
        rate: 0.1,
      });
      expect(decideSample("convert_to_png", () => 0.5)).toEqual({
        keep: false,
        rate: 0.1,
      });
    });

    it("keeps roughly the configured fraction over many trials", () => {
      // deterministic cycling rng across [0,1) — ~10% should land under 0.1
      let i = 0;
      const rng = () => (i++ % 100) / 100;
      let kept = 0;
      for (let n = 0; n < 100; n++) {
        if (decideSample("upload_attachment", rng).keep) kept++;
      }
      expect(kept).toBe(10); // values 0.00..0.09 → keep
    });
  });

  it("every configured rate is within [0, 1]", () => {
    for (const rate of Object.values(EVENT_SAMPLE_RATES)) {
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    }
  });
});
