import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  markPublishClicked,
  trackPublishCompleted,
  recordPublishStep,
  recordPublishFlag,
  _resetPublishTimingForTesting,
} from "@/utils/analytics/publishTiming";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";

vi.mock("@/utils/analytics/trackAnalyticsEvent", () => ({
  trackAnalyticsEvent: vi.fn(),
}));

describe("publishTiming", () => {
  beforeEach(() => {
    _resetPublishTimingForTesting();
    vi.mocked(trackAnalyticsEvent).mockClear();
  });

  it("emits macro_publish_completed with a numeric publish_duration_ms after a marked click", () => {
    markPublishClicked();
    trackPublishCompleted({ macro_type: "graph", operation_mode: "create" });

    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "macro_publish_completed",
      expect.objectContaining({
        feature_area: "macro",
        surface: "editor",
        macro_type: "graph",
        operation_mode: "create",
        publish_duration_ms: expect.any(Number),
      }),
    );
    const [, props] = vi.mocked(trackAnalyticsEvent).mock.calls[0];
    expect((props as any).publish_duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("does NOT emit when there was no marked click (e.g. cancel path)", () => {
    trackPublishCompleted({ macro_type: "sequence" });
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
  });

  it("consumes the mark — a second completion without a re-mark does not emit", () => {
    markPublishClicked();
    trackPublishCompleted({ macro_type: "sequence" });
    vi.mocked(trackAnalyticsEvent).mockClear();

    trackPublishCompleted({ macro_type: "sequence" });
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
  });

  it("caller props override the macro/editor defaults are preserved", () => {
    markPublishClicked();
    trackPublishCompleted({
      macro_type: "openapi",
      operation_mode: "edit",
      content_id: "123",
      custom_content_id: "123",
    });
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "macro_publish_completed",
      expect.objectContaining({
        macro_type: "openapi",
        operation_mode: "edit",
        content_id: "123",
        custom_content_id: "123",
      }),
    );
  });

  describe("per-step timings", () => {
    // A controllable clock: performance.now() returns `now`, tests move it.
    let now = 0;
    let perfNow: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      now = 1000;
      perfNow = vi.spyOn(performance, "now").mockImplementation(() => now);
    });
    afterEach(() => {
      perfNow.mockRestore();
    });

    const emitted = () =>
      vi.mocked(trackAnalyticsEvent).mock.calls[0][1] as Record<string, unknown>;

    // A step that takes `ms`: starts now, ends `ms` later on the test clock.
    const runStep = (name: Parameters<typeof recordPublishStep>[0], ms: number) => {
      const startedAt = now;
      now += ms;
      recordPublishStep(name, startedAt);
    };

    it("adds each recorded step to macro_publish_completed", () => {
      markPublishClicked(); // click at 1000
      now = 1100;
      runStep("snapshot_ms", 250);
      runStep("mirror_sync_ms", 150);
      recordPublishFlag("attachment_timed_out", false);
      now = 1600;
      trackPublishCompleted({ macro_type: "mermaid" });

      expect(emitted()).toMatchObject({
        publish_duration_ms: 600,
        snapshot_ms: 250,
        mirror_sync_ms: 150,
        attachment_timed_out: false,
      });
    });

    it("omits a step that never ran instead of reporting 0", () => {
      markPublishClicked();
      now = 1200;
      trackPublishCompleted({ macro_type: "mermaid" });

      const props = emitted();
      for (const key of [
        "snapshot_ms",
        "mirror_sync_ms",
        "attachment_capture_ms",
        "attachment_ack_ms",
        "attachment_timed_out",
        "writeback_context_ms",
      ]) {
        expect(props).not.toHaveProperty(key);
      }
    });

    it("keeps a step that ran instantly as 0 (ran) rather than dropping it (skipped)", () => {
      markPublishClicked();
      recordPublishStep("writeback_context_ms", now);
      trackPublishCompleted({ macro_type: "sequence" });

      expect(emitted()).toHaveProperty("writeback_context_ms", 0);
    });

    it("clears the steps once emitted, so the next publish starts clean", () => {
      markPublishClicked();
      runStep("snapshot_ms", 80);
      trackPublishCompleted({ macro_type: "sequence" });
      expect(emitted()).toHaveProperty("snapshot_ms", 80);
      vi.mocked(trackAnalyticsEvent).mockClear();

      markPublishClicked();
      trackPublishCompleted({ macro_type: "sequence" });
      expect(emitted()).not.toHaveProperty("snapshot_ms");
    });

    it("drops steps left over from a failed attempt when the user clicks Publish again", () => {
      markPublishClicked();
      runStep("snapshot_ms", 80);
      recordPublishFlag("attachment_timed_out", true);
      // save failed, nothing emitted; the user retries
      markPublishClicked();
      trackPublishCompleted({ macro_type: "sequence" });

      expect(emitted()).not.toHaveProperty("snapshot_ms");
      expect(emitted()).not.toHaveProperty("attachment_timed_out");
    });

    it("accepts a step with no publish in flight (autosave, viewer-side save) without emitting or leaking", () => {
      runStep("snapshot_ms", 300);
      recordPublishFlag("attachment_timed_out", true);
      expect(trackAnalyticsEvent).not.toHaveBeenCalled();

      markPublishClicked();
      trackPublishCompleted({ macro_type: "sequence" });
      expect(emitted()).not.toHaveProperty("snapshot_ms");
      expect(emitted()).not.toHaveProperty("attachment_timed_out");
    });

    it("ignores a step that started before the Publish click (an autosave still in flight)", () => {
      const autosaveStartedAt = now; // 1000
      now = 1100;
      markPublishClicked();
      now = 1400;
      recordPublishStep("snapshot_ms", autosaveStartedAt);
      trackPublishCompleted({ macro_type: "sequence" });

      expect(emitted()).not.toHaveProperty("snapshot_ms");
    });

    it("lets caller props win over recorded steps", () => {
      markPublishClicked();
      runStep("snapshot_ms", 50);
      trackPublishCompleted({ macro_type: "sequence", snapshot_ms: 7 });

      expect(emitted()).toHaveProperty("snapshot_ms", 7);
    });
  });
});
