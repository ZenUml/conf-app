import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sampleRateFor,
  decideSample,
  EVENT_SAMPLE_RATES,
  OCTOBER_REDUCED_EVENTS,
  OCTOBER_RETAINED_EVENTS,
  OCTOBER_STOP_EVENTS,
} from "./eventSampling";

describe("eventSampling", () => {
  beforeEach(() => vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-01T00:00:00Z")));
  afterEach(() => vi.mocked(Date.now).mockRestore());

  describe("October 2026 event budget", () => {
    const october = Date.parse("2026-10-12T00:00:00Z");
    const before = Date.parse("2026-09-30T23:59:59.999Z");
    const after = Date.parse("2026-11-01T00:00:00Z");

    it("keeps macro_viewed at full rate across September, October, and November", () => {
      for (const time of [before, october, after]) {
        expect(sampleRateFor("macro_viewed", time)).toBe(1);
        expect(decideSample("macro_viewed", () => { throw new Error("RNG must not run"); }, time))
          .toEqual({ keep: true, rate: 1 });
      }
    });

    it("stops the seven named diagnostics only during the UTC budget window", () => {
      for (const name of [
        "cohorts_refreshed", "copy_for_ai_impression", "editor_global_replace_observed",
        "report_macro_metrics", "snapshot_backfill_skipped", "viewport_control_used",
        "whats_new_banner_evaluated",
      ]) {
        expect(sampleRateFor(name, october)).toBe(0);
        expect(sampleRateFor(name, before)).toBe(name === "copy_for_ai_impression" || name === "report_macro_metrics" ? 0.1 : 1);
        expect(sampleRateFor(name, after)).toBe(name === "copy_for_ai_impression" || name === "report_macro_metrics" ? 0.1 : 1);
      }
    });

    it("retains core funnels, failures, and feedback/survey events", () => {
      for (const name of [
        "macro_viewed", "macro_create_started", "macro_save_succeeded", "paywall_gate_evaluated",
        "snapshot_created", "ai_chat_prompt_failed", "attachment_upload_failed",
        "feedback_report_opened", "targeted_survey_shown", "csat_displayed",
        "magic_writeback_completed", "agent_link_mcp_tool_called",
      ]) expect(sampleRateFor(name, october)).toBe(sampleRateFor(name, after));
    });

    it("keeps the complete paid conversion and Request Full funnel at current rates", () => {
      const names = [
        "paywall_banner_dismissed", "paywall_banner_shown", "paywall_bundle_cta_clicked",
        "paywall_gate_evaluated", "paywall_triggered", "paywall_continue_used",
        "paywall_continued_editing", "paywall_blocked_create", "paywall_blocked_edit",
        "paywall_attempts_exhausted",
        "paywall_marketplace_cta_clicked", "paywall_learn_more_clicked",
        "upgrade_modal_shown", "upgrade_modal_dismissed",
        "plan_usage_viewed", "plan_usage_purchase_clicked", "plan_usage_request_full_clicked",
        "request_full_reason_copied", "request_full_atlassian_clicked", "request_full_guide_shown",
      ];
      for (const name of names) {
        expect(OCTOBER_RETAINED_EVENTS.has(name)).toBe(true);
        expect(OCTOBER_REDUCED_EVENTS.has(name)).toBe(false);
        expect(sampleRateFor(name, october)).toBe(sampleRateFor(name, after));
      }
    });

    it("reduces only listed success/info events to one tenth of their existing arrival rate", () => {
      expect(sampleRateFor("copy_for_ai_clicked", october)).toBe(1);
      expect(sampleRateFor("copy_for_ai_menu_opened", october)).toBe(0.1);
      expect(sampleRateFor("diagram_attribution_shown", october)).toBe(0.005);
      expect(sampleRateFor("space_admin_active", october)).toBe(0.01);
      expect(sampleRateFor("convert_to_png", october)).toBe(0.01);
      expect(sampleRateFor("analytics_dashboard_export", october)).toBe(0.1);
      expect(sampleRateFor("create_attachmentmermaid", october)).toBe(0.01);
      expect(sampleRateFor("create_attachmentmermaid", after)).toBe(0.1);
      expect(sampleRateFor("new_unregistered_product_event", october)).toBe(1);
    });

    it("draws once against the final absolute rate", () => {
      expect(decideSample("diagram_attribution_shown", () => 0.004, october)).toEqual({ keep: true, rate: 0.005 });
      expect(decideSample("diagram_attribution_shown", () => 0.005, october)).toEqual({ keep: false, rate: 0.005 });
      expect(decideSample("report_macro_metrics", () => 0, october)).toEqual({ keep: false, rate: 0 });
    });

    it("keeps the reviewed classes disjoint and paired success signals together", () => {
      for (const name of OCTOBER_RETAINED_EVENTS) {
        expect(OCTOBER_REDUCED_EVENTS.has(name)).toBe(false);
        expect(OCTOBER_STOP_EVENTS.has(name)).toBe(false);
      }
      for (const name of OCTOBER_REDUCED_EVENTS) {
        expect(OCTOBER_STOP_EVENTS.has(name)).toBe(false);
        expect(name).not.toMatch(/fail|error|reject|unavailable|blocked|invalid|missing|unresolved|refused|feedback|survey|csat/);
      }
      for (const name of [
        "diagram_attribution_shown", "diagram_audience_registration_succeeded",
        "related_diagrams_lookup_succeeded", "related_token_indicators_shown",
        "whats_new_banner_shown",
      ]) {
        expect(OCTOBER_REDUCED_EVENTS.has(name)).toBe(true);
        expect(sampleRateFor(name, october)).toBeCloseTo(sampleRateFor(name, after) / 10);
      }
    });
  });
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

    // copy_for_ai_impression is an instance-level event: 80,912 occurrences from
    // 4,414 users in the 30 days to 2026-09-07, 19.4% of all billable volume.
    // Its only consumer is a rate (clicks / impressions), so a sample answers it.
    it("samples the Copy for AI impression to 10%", () => {
      expect(sampleRateFor("copy_for_ai_impression")).toBe(0.1);
    });

    // The click side of the same rate must stay whole — it is ~166 users a
    // month, contributes nothing to the bill, and sampling both sides would
    // multiply the estimator's error for no saving.
    it("leaves the Copy for AI click and menu events at full fidelity", () => {
      expect(sampleRateFor("copy_for_ai_clicked")).toBe(1);
      expect(sampleRateFor("copy_for_ai_menu_opened")).toBe(1);
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
