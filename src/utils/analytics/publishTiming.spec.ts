import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  markPublishClicked,
  trackPublishCompleted,
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
});
