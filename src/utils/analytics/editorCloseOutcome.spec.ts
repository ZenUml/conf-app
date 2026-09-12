import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  trackAnalyticsEventBeforeUnload: vi.fn(async () => {}),
  getEditorMutationSummary: vi.fn(() => ({})),
  closeHandlers: [] as Array<() => void | Promise<void>>,
  closeGuardOff: vi.fn(),
}));

vi.mock("./trackAnalyticsEvent", () => ({
  trackAnalyticsEventBeforeUnload: h.trackAnalyticsEventBeforeUnload,
}));

vi.mock("./editorMutationTelemetry", () => ({
  getEditorMutationSummary: h.getEditorMutationSummary,
}));

vi.mock("@/utils/closeGuard", () => ({
  setupCloseGuard: vi.fn((handler: () => void | Promise<void>) => {
    h.closeHandlers.push(handler);
    return h.closeGuardOff;
  }),
}));

import {
  _resetEditorCloseOutcomeForTesting,
  markEditorAuthoringStarted,
  markEditorSaved,
  registerEditorCloseTracking,
  trackEditorClosedWithoutSave,
} from "./editorCloseOutcome";

const fireHostClose = async () => {
  for (const handler of h.closeHandlers) await handler();
};

describe("editorCloseOutcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.closeHandlers.length = 0;
    h.getEditorMutationSummary.mockReturnValue({});
    _resetEditorCloseOutcomeForTesting();
    // Every case below models a session whose start event fired; the
    // paywall-blocked (never armed) case is tested explicitly.
    markEditorAuthoringStarted();
  });

  it("stays silent for a session that never started authoring (paywall-blocked mount)", async () => {
    _resetEditorCloseOutcomeForTesting();
    registerEditorCloseTracking({
      getMacroType: () => "mermaid",
      operationMode: "edit",
      hadChanges: () => false,
    });

    await fireHostClose();

    expect(h.trackAnalyticsEventBeforeUnload).not.toHaveBeenCalled();
  });

  it("arms a session whose start event fires after the component registered", async () => {
    _resetEditorCloseOutcomeForTesting();
    registerEditorCloseTracking({
      getMacroType: () => "mermaid",
      operationMode: "edit",
    });
    markEditorAuthoringStarted();

    await fireHostClose();

    expect(h.trackAnalyticsEventBeforeUnload).toHaveBeenCalledTimes(1);
  });

  it("emits macro_edit_cancelled with host_close when the host closes an unsaved edit", async () => {
    registerEditorCloseTracking({
      getMacroType: () => "mermaid",
      operationMode: "edit",
      hadChanges: () => true,
    });

    await fireHostClose();

    expect(h.trackAnalyticsEventBeforeUnload).toHaveBeenCalledTimes(1);
    const [eventName, props] = h.trackAnalyticsEventBeforeUnload.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(eventName).toBe("macro_edit_cancelled");
    expect(props).toMatchObject({
      feature_area: "macro",
      surface: "editor",
      macro_type: "mermaid",
      operation_mode: "edit",
      close_source: "host_close",
      had_changes: true,
    });
    expect(typeof props.editor_open_duration_ms).toBe("number");
  });

  it("emits macro_create_cancelled for a create session", async () => {
    registerEditorCloseTracking({
      getMacroType: () => "graph",
      operationMode: "create",
      hadChanges: () => false,
    });

    await fireHostClose();

    expect(h.trackAnalyticsEventBeforeUnload).toHaveBeenCalledWith(
      "macro_create_cancelled",
      expect.objectContaining({
        macro_type: "graph",
        operation_mode: "create",
        had_changes: false,
      }),
    );
  });

  it("stays silent when a save was marked before the host close", async () => {
    registerEditorCloseTracking({
      getMacroType: () => "openapi",
      operationMode: "edit",
    });
    markEditorSaved();

    await fireHostClose();

    expect(h.trackAnalyticsEventBeforeUnload).not.toHaveBeenCalled();
  });

  it("sends at most one outcome per iframe: discard dialog then host close", async () => {
    registerEditorCloseTracking({
      getMacroType: () => "sequence",
      operationMode: "edit",
      hadChanges: () => true,
    });

    await trackEditorClosedWithoutSave("discard_dialog");
    await fireHostClose();

    expect(h.trackAnalyticsEventBeforeUnload).toHaveBeenCalledTimes(1);
    expect(h.trackAnalyticsEventBeforeUnload).toHaveBeenCalledWith(
      "macro_edit_cancelled",
      expect.objectContaining({ close_source: "discard_dialog" }),
    );
  });

  it("omits had_changes when the editor cannot tell", async () => {
    registerEditorCloseTracking({
      getMacroType: () => "asyncapi",
      operationMode: "edit",
    });

    await fireHostClose();

    const props = h.trackAnalyticsEventBeforeUnload.mock.calls[0][1] as Record<string, unknown>;
    expect("had_changes" in props).toBe(false);
  });

  it("reads the macro type at close time, not at registration", async () => {
    let type: "mermaid" | "plantuml" = "mermaid";
    registerEditorCloseTracking({
      getMacroType: () => type,
      operationMode: "edit",
    });
    type = "plantuml";

    await fireHostClose();

    expect(h.trackAnalyticsEventBeforeUnload).toHaveBeenCalledWith(
      "macro_edit_cancelled",
      expect.objectContaining({ macro_type: "plantuml" }),
    );
  });

  it("carries the text-editor mutation summary when one exists", async () => {
    h.getEditorMutationSummary.mockReturnValue({ had_global_replace: true, global_replace_count: 2 });
    registerEditorCloseTracking({
      getMacroType: () => "mermaid",
      operationMode: "edit",
    });

    await fireHostClose();

    expect(h.trackAnalyticsEventBeforeUnload).toHaveBeenCalledWith(
      "macro_edit_cancelled",
      expect.objectContaining({ had_global_replace: true, global_replace_count: 2 }),
    );
  });

  it("is a no-op when nothing is registered", async () => {
    await trackEditorClosedWithoutSave("host_close");
    expect(h.trackAnalyticsEventBeforeUnload).not.toHaveBeenCalled();
  });

  it("teardown unhooks the host close listener", async () => {
    const off = registerEditorCloseTracking({
      getMacroType: () => "mermaid",
      operationMode: "edit",
    });
    off();
    expect(h.closeGuardOff).toHaveBeenCalledTimes(1);
  });
});
