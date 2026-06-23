import React from "react";
import ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AIChatPanel from "./AIChatPanel";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import {
  ensureDiagramlyDiagram,
  getDiagramlyJobStatus,
  getDiagramlyVersions,
  restoreDiagramlyVersion,
  startDiagramChatModification,
} from "@/services/GenerateService";

vi.mock("@/utils/analytics/trackAnalyticsEvent", () => ({
  trackAnalyticsEvent: vi.fn(),
}));

vi.mock("@/services/GenerateService", () => ({
  ensureDiagramlyDiagram: vi.fn(),
  startDiagramChatModification: vi.fn(),
  getDiagramlyJobStatus: vi.fn(),
  getDiagramlyVersions: vi.fn(),
  restoreDiagramlyVersion: vi.fn(),
}));

describe("React AIChatPanel", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.mocked(trackAnalyticsEvent).mockClear();
    vi.mocked(ensureDiagramlyDiagram).mockReset();
    vi.mocked(startDiagramChatModification).mockReset();
    vi.mocked(getDiagramlyJobStatus).mockReset();
    vi.mocked(getDiagramlyVersions).mockReset();
    vi.mocked(restoreDiagramlyVersion).mockReset();
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    vi.useRealTimers();
  });

  function renderPanel(
    overrides: Partial<React.ComponentProps<typeof AIChatPanel>> = {},
  ) {
    const props = {
      open: true,
      codeVisible: false,
      diagramType: "openapi",
      prototypeMode: true,
      onClose: vi.fn(),
      onToggleCode: vi.fn(),
      ...overrides,
    };
    act(() => {
      ReactDOM.render(<AIChatPanel {...props} />, container);
    });
    return props;
  }

  function setInput(value: string) {
    const input = container.querySelector(
      '[data-testid="react-ai-chat-input"]',
    ) as HTMLTextAreaElement;
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, value);
      Simulate.change(input);
    });
    return input;
  }

  function submitPrompt(value: string) {
    setInput(value);
    act(() => {
      Simulate.submit(container.querySelector("form")!);
    });
  }

  async function flushAsyncWork() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("fills the input from a suggestion and tracks the selection", () => {
    renderPanel();
    const suggestion = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Add an error handling path"),
    );
    expect(suggestion).toBeDefined();

    act(() => {
      Simulate.click(suggestion!);
    });

    const input = container.querySelector(
      '[data-testid="react-ai-chat-input"]',
    ) as HTMLTextAreaElement;
    expect(input.value).toBe("Add an error handling path");
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "ai_chat_suggestion_selected",
      expect.objectContaining({ suggestion_id: "add-error-path", macro_type: "openapi" }),
    );
  });

  it("runs the staged update, auto-applies it, and exposes the diff", () => {
    vi.useFakeTimers();
    const props = renderPanel({ onApply: vi.fn() });
    submitPrompt("Add a retry response");

    expect(container.querySelector('[data-testid="react-ai-chat-thinking"]')).not.toBeNull();
    expect(container.textContent).toContain("Understanding request");

    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(container.querySelector('[data-testid="react-ai-change-preview"]')).not.toBeNull();
    expect(container.textContent).toContain("Changes applied");
    expect(container.textContent).toContain("documented failure response");
    expect(props.onApply).toHaveBeenCalledOnce();

    const diffToggle = container.querySelector(".ai-chat-diff-toggle")!;
    act(() => {
      Simulate.click(diffToggle);
    });
    expect(container.querySelector('[data-testid="react-ai-chat-diff"]')?.textContent).toContain(
      "responses:",
    );
    act(() => {
      Simulate.click(container.querySelector('[data-testid="react-ai-chat-diff-expand"]')!);
    });
    expect(
      container.querySelector('[data-testid="react-ai-chat-diff-fullscreen"]')?.textContent,
    ).toContain("responses:");
    act(() => {
      Simulate.click(container.querySelector('[data-testid="react-ai-chat-diff-fullscreen-close"]')!);
    });
    expect(container.querySelector('[data-testid="react-ai-chat-diff-fullscreen"]')).toBeNull();
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "ai_chat_change_applied",
      expect.objectContaining({ change_kind: "request", version_id: expect.any(String) }),
    );
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "ai_chat_diff_toggled",
      expect.objectContaining({ interaction_state: "shown", ui_component: "code_diff_fullscreen" }),
    );
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "ai_chat_diff_toggled",
      expect.objectContaining({ interaction_state: "hidden", ui_component: "code_diff_fullscreen" }),
    );
  });

  it("undoes an applied change and records a new version", () => {
    vi.useFakeTimers();
    renderPanel();
    submitPrompt("Simplify the operation");
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    act(() => {
      Simulate.click(container.querySelector('[data-testid="react-ai-chat-undo"]')!);
    });

    expect(container.textContent).toContain("Changes undone");
    expect(
      container.querySelector('[data-testid="react-ai-chat-history-trigger"]')?.textContent,
    ).toContain("3");
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "ai_chat_change_undone",
      expect.objectContaining({ change_kind: "undo", version_id: "local-initial" }),
    );
  });

  it("opens diagram versions and restores an earlier version", () => {
    vi.useFakeTimers();
    renderPanel();
    submitPrompt("Add an error response");
    act(() => {
      vi.advanceTimersByTime(1100);
      Simulate.click(
        container.querySelector('[data-testid="react-ai-chat-history-trigger"]')!,
      );
    });

    expect(
      container.querySelector('[data-testid="react-ai-chat-history-panel"]')?.textContent,
    ).toContain("Initial version");
    const restore = Array.from(container.querySelectorAll(".ai-chat-rollback")).find(
      (button) => button.textContent === "Restore version",
    );
    expect(restore).toBeDefined();
    act(() => {
      Simulate.click(restore!);
    });

    expect(container.querySelector('[data-testid="react-ai-chat-history-panel"]')).toBeNull();
    expect(container.textContent).toContain("Version restored");
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "ai_chat_version_restored",
      expect.objectContaining({ change_kind: "rollback", version_id: "local-initial" }),
    );
  });

  it("shows saved versions as loading instead of the local initial count while they load", async () => {
    let resolveVersions!: (value: Awaited<ReturnType<typeof getDiagramlyVersions>>) => void;
    vi.mocked(getDiagramlyVersions).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveVersions = resolve;
      }),
    );

    renderPanel({ diagramlyDiagramId: "diagram-1" });

    expect(
      container.querySelector('[data-testid="react-ai-chat-history-trigger"]')?.textContent,
    ).toContain("...");
    expect(container.textContent).toContain("Syncing");

    act(() => {
      Simulate.click(container.querySelector('[data-testid="react-ai-chat-history-trigger"]')!);
    });

    expect(
      container.querySelector('[data-testid="react-ai-chat-history-loading"]')?.textContent,
    ).toContain("Loading saved versions");
    expect(container.querySelector(".ai-chat-history-item")).toBeNull();

    await act(async () => {
      resolveVersions({
        versions: [
          {
            id: "version-1",
            diagramId: "diagram-1",
            versionNumber: 1,
            createdAt: "2026-06-23T08:00:00.000Z",
            content: { code: "openapi: 3.0.0\ninfo:\n  title: First" },
          },
          {
            id: "version-2",
            diagramId: "diagram-1",
            versionNumber: 2,
            createdAt: "2026-06-23T08:01:00.000Z",
            instruction: "Updated title",
            content: { code: "openapi: 3.0.0\ninfo:\n  title: Second" },
          },
        ],
      });
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="react-ai-chat-history-trigger"]')?.textContent,
    ).toContain("2");
    expect(
      container.querySelector('[data-testid="react-ai-chat-history-panel"]')?.textContent,
    ).toContain("Updated title");
  });

  it("shows progress while restoring a persisted Diagramly version", async () => {
    vi.mocked(getDiagramlyVersions).mockResolvedValue({
      versions: [
        {
          id: "version-1",
          diagramId: "diagram-1",
          versionNumber: 1,
          createdAt: "2026-06-23T08:00:00.000Z",
          content: { code: "openapi: 3.0.0\ninfo:\n  title: First" },
        },
        {
          id: "version-2",
          diagramId: "diagram-1",
          versionNumber: 2,
          createdAt: "2026-06-23T08:01:00.000Z",
          instruction: "Updated title",
          content: { code: "openapi: 3.0.0\ninfo:\n  title: Second" },
        },
      ],
    });
    let resolveRestore!: (value: Awaited<ReturnType<typeof restoreDiagramlyVersion>>) => void;
    vi.mocked(restoreDiagramlyVersion).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveRestore = resolve;
      }),
    );
    const onApplyCode = vi.fn();
    renderPanel({
      diagramlyDiagramId: "diagram-1",
      onApplyCode,
    });
    await flushAsyncWork();

    act(() => {
      Simulate.click(container.querySelector('[data-testid="react-ai-chat-history-trigger"]')!);
    });
    await flushAsyncWork();
    const restore = Array.from(container.querySelectorAll(".ai-chat-rollback")).find(
      (button) => button.textContent === "Restore version",
    );
    expect(restore).toBeDefined();

    await act(async () => {
      Simulate.click(restore!);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Restoring version");
    expect(container.textContent).toContain("Restoring...");
    expect(
      (container.querySelector('[data-testid="react-ai-chat-input"]') as HTMLTextAreaElement).disabled,
    ).toBe(true);

    await act(async () => {
      resolveRestore({
        diagramId: "diagram-1",
        diagramCode: "openapi: 3.0.0\ninfo:\n  title: First",
        version: {
          id: "version-3",
          diagramId: "diagram-1",
          versionNumber: 3,
          createdAt: "2026-06-23T08:02:00.000Z",
          instruction: "Restored from version 1",
          content: { code: "openapi: 3.0.0\ninfo:\n  title: First" },
        },
      });
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Version restored");
    expect(onApplyCode).toHaveBeenCalledWith("openapi: 3.0.0\ninfo:\n  title: First");
  });

  it("keeps syntax visible across code states and supports automatic repair", () => {
    vi.useFakeTimers();
    renderPanel({
      syntaxError: "OpenAPI syntax error at line 8\nUnexpected token",
    });

    expect(container.querySelector('[data-testid="react-ai-chat-syntax-indicator"]')).not.toBeNull();
    act(() => {
      Simulate.click(
        container.querySelector('[data-testid="react-ai-chat-syntax-indicator"]')!,
      );
    });
    expect(container.querySelector('[data-testid="react-ai-chat-syntax-details"]')?.textContent).toContain(
      "line 8",
    );

    act(() => {
      Simulate.click(container.querySelector('[data-testid="react-ai-chat-auto-fix"]')!);
      vi.runAllTimers();
    });

    expect(container.querySelector('[data-testid="react-ai-chat-syntax-indicator"]')).toBeNull();
    expect(container.textContent).toContain("Syntax fixed");
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "ai_chat_syntax_repair_requested",
      expect.objectContaining({ change_kind: "syntax_repair" }),
    );
  });

  it("runs syntax repair when the parent requests it", () => {
    vi.useFakeTimers();
    renderPanel({
      syntaxError: "OpenAPI syntax error at line 8\nUnexpected token",
      syntaxRepairRequestId: 1,
    });

    expect(container.querySelector('[data-testid="react-ai-chat-thinking"]')).not.toBeNull();

    act(() => {
      vi.runAllTimers();
    });

    expect(container.querySelector('[data-testid="react-ai-chat-syntax-indicator"]')).toBeNull();
    expect(container.textContent).toContain("Syntax fixed");
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "ai_chat_syntax_repair_requested",
      expect.objectContaining({ change_kind: "syntax_repair" }),
    );
  });

  it("closes and toggles code visibility from the header", () => {
    const props = renderPanel();
    act(() => {
      Simulate.click(container.querySelector('[data-testid="react-ai-chat-code-toggle"]')!);
      Simulate.click(container.querySelector('[data-testid="react-ai-chat-close"]')!);
    });

    expect(props.onToggleCode).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "ai_chat_code_visibility_toggled",
      expect.objectContaining({ interaction_state: "shown" }),
    );
  });

  it("runs a real async Diagramly job and applies returned code", async () => {
    vi.mocked(ensureDiagramlyDiagram).mockResolvedValueOnce({
      diagramId: "diagram-1",
      versionId: "version-1",
      versionNumber: 1,
      createdAt: "2026-06-23T08:00:00.000Z",
    });
    vi.mocked(startDiagramChatModification).mockResolvedValueOnce({ jobId: "job-1" });
    vi.mocked(getDiagramlyJobStatus).mockResolvedValueOnce({
      id: "job-1",
      status: "COMPLETED",
      progress: 100,
      message: "Complete",
      output: {
        diagramId: "diagram-1",
        diagramCode: "openapi: 3.0.0\ninfo:\n  title: Updated",
        versionId: "version-2",
        versionNumber: 2,
        createdAt: "2026-06-23T08:01:00.000Z",
      },
    });
    const onApplyCode = vi.fn();
    renderPanel({
      prototypeMode: false,
      currentCode: "openapi: 3.0.0\ninfo:\n  title: Original",
      onApplyCode,
    });

    submitPrompt("Update the API title");
    await flushAsyncWork();

    expect(startDiagramChatModification).toHaveBeenCalledWith({
      diagramId: "diagram-1",
      diagramCode: "openapi: 3.0.0\ninfo:\n  title: Original",
      prompt: "Update the API title",
      diagramType: "openapi",
      errorMessage: undefined,
    });
    expect(onApplyCode).toHaveBeenCalledWith("openapi: 3.0.0\ninfo:\n  title: Updated");
    expect(container.querySelector('[data-testid="react-ai-change-preview"]')).not.toBeNull();
    expect(container.textContent).toContain("Changes applied");
  });
});
