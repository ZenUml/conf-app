import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  startEditJourney,
  endEditJourney,
  continueEditJourney,
  setEditJourneyMeta,
  getEditJourneyId,
} from "@/utils/journeyTracking";
import {
  trackAnalyticsEvent,
  trackAnalyticsEventBeforeUnload,
} from "@/utils/analytics/trackAnalyticsEvent";
import { getEditorInputSummary } from "@/utils/analytics/editorMutationTelemetry";

vi.mock("@/utils/analytics/trackAnalyticsEvent", () => ({
  trackAnalyticsEvent: vi.fn(),
  trackAnalyticsEventBeforeUnload: vi.fn(),
}));
vi.mock("@/utils/analytics/editorMutationTelemetry", () => ({
  getEditorInputSummary: vi.fn(() => ({})),
}));

describe("macro_authoring_ended", () => {
  beforeEach(() => {
    vi.mocked(trackAnalyticsEvent).mockClear();
    vi.mocked(trackAnalyticsEventBeforeUnload).mockClear();
    vi.mocked(getEditorInputSummary).mockReturnValue({});
    // Leave no journey open between cases.
    endEditJourney("cancelled");
    vi.mocked(trackAnalyticsEvent).mockClear();
  });

  it("emits exactly one terminal event carrying outcome, journey id and duration", () => {
    const journeyId = startEditJourney("macro-1", "macro", {
      macroType: "sequence",
      operationMode: "create",
    });

    endEditJourney("saved");

    expect(trackAnalyticsEvent).toHaveBeenCalledTimes(1);
    const [name, props] = vi.mocked(trackAnalyticsEvent).mock.calls[0];
    expect(name).toBe("macro_authoring_ended");
    expect(props).toMatchObject({
      feature_area: "macro",
      surface: "editor",
      authoring_outcome: "saved",
      journey_id: journeyId,
      macro_type: "sequence",
      operation_mode: "create",
    });
    expect(typeof props.authoring_duration_ms).toBe("number");
  });

  it("is idempotent per journey — a second end call reports nothing", () => {
    startEditJourney("macro-2", "macro", { macroType: "mermaid" });
    endEditJourney("saved");
    endEditJourney("cancelled");

    expect(trackAnalyticsEvent).toHaveBeenCalledTimes(1);
  });

  it("reports nothing when no journey is open", () => {
    endEditJourney("cancelled");
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
  });

  it("picks up meta resolved after the journey started", () => {
    startEditJourney("macro-3", "dialog", { macroType: "graph" });
    setEditJourneyMeta({ operationMode: "edit", paywallBlocked: true });
    endEditJourney("cancelled");

    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "macro_authoring_ended",
      expect.objectContaining({
        macro_type: "graph",
        operation_mode: "edit",
        paywall_blocked: true,
      }),
    );
  });

  it("omits paywall_blocked when the gate never fired", () => {
    startEditJourney("macro-4", "macro", { macroType: "sequence" });
    endEditJourney("saved");

    const [, props] = vi.mocked(trackAnalyticsEvent).mock.calls[0];
    expect(props).not.toHaveProperty("paywall_blocked");
  });

  it("carries the authoring-intent summary when the editor provides one", () => {
    vi.mocked(getEditorInputSummary).mockReturnValue({
      had_input: true,
      input_event_count: 4,
      time_to_first_input_ms: 1_200,
    });
    startEditJourney("macro-5", "macro", { macroType: "sequence" });
    endEditJourney("cancelled");

    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "macro_authoring_ended",
      expect.objectContaining({ had_input: true, input_event_count: 4 }),
    );
  });

  it("keeps a continued journey (viewer -> dialog handoff) as one session", () => {
    continueEditJourney("journey-from-parent", "macro-6", Date.now() - 5_000, {
      macroType: "openapi",
      operationMode: "edit",
    });
    expect(getEditJourneyId()).toBe("journey-from-parent");

    endEditJourney("saved");

    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "macro_authoring_ended",
      expect.objectContaining({
        journey_id: "journey-from-parent",
        macro_type: "openapi",
      }),
    );
  });

  it("falls back to window_close on pagehide for editors with no cancel hook", async () => {
    startEditJourney("macro-7", "macro", { macroType: "graph" });

    window.dispatchEvent(new Event("pagehide"));

    expect(trackAnalyticsEventBeforeUnload).toHaveBeenCalledWith(
      "macro_authoring_ended",
      expect.objectContaining({ authoring_outcome: "window_close" }),
    );
    // The fallback consumed the journey — an explicit end must not double-report.
    endEditJourney("cancelled");
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
  });
});
