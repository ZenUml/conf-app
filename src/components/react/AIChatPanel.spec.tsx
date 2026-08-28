import React from "react";
import ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AIChatPanel from "./AIChatPanel";
import { runAIChatSession } from "@/services/AIChatSessionService";
import {
  getDiagramlyVersions,
  restoreDiagramlyVersion,
} from "@/services/GenerateService";

vi.mock("@/services/AIChatSessionService", () => ({
  runAIChatSession: vi.fn(),
}));

vi.mock("@/services/GenerateService", () => ({
  getDiagramlyVersions: vi.fn(),
  restoreDiagramlyVersion: vi.fn(),
}));

const initialVersion = {
  id: "version-1",
  diagramId: "diagram-1",
  versionNumber: 1,
  createdAt: "2026-08-29T01:00:00.000Z",
  content: { code: "openapi: 3.0.0\ninfo:\n  title: Original" },
};

describe("React AIChatPanel core flow", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.mocked(runAIChatSession).mockReset();
    vi.mocked(getDiagramlyVersions).mockReset();
    vi.mocked(restoreDiagramlyVersion).mockReset();
    vi.mocked(getDiagramlyVersions).mockResolvedValue({
      versions: [initialVersion],
      diagram: { id: "diagram-1", currentVersionId: "version-1" },
    });
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });

  function renderPanel(
    overrides: Partial<React.ComponentProps<typeof AIChatPanel>> = {},
  ) {
    const props = {
      open: true,
      codeVisible: false,
      diagramType: "openapi",
      onClose: vi.fn(),
      onToggleCode: vi.fn(),
      ...overrides,
    };
    act(() => {
      ReactDOM.render(<AIChatPanel {...props} />, container);
    });
    return props;
  }

  function setInput(value: string): HTMLTextAreaElement {
    const input = container.querySelector(
      '[data-testid="react-ai-chat-input"]',
    ) as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      Simulate.change(input);
    });
    return input;
  }

  function submit(value: string): void {
    setInput(value);
    act(() => {
      Simulate.submit(container.querySelector("form")!);
    });
  }

  async function flushAsyncWork(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("only renders while open", () => {
    renderPanel({ open: false });
    expect(container.querySelector('[data-testid="react-ai-chat-panel"]')).toBeNull();
  });

  it("fills and focuses the composer from a quick suggestion", async () => {
    renderPanel();
    act(() => {
      Simulate.click(container.querySelector(
        '[data-testid="react-ai-chat-suggestion-add-error-path"]',
      )!);
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const input = container.querySelector(
      '[data-testid="react-ai-chat-input"]',
    ) as HTMLTextAreaElement;
    expect(input.value).toBe("Add an error handling path");
    expect(document.activeElement).toBe(input);
  });

  it("runs the OpenAPI session, binds the diagram, applies code, and exposes line diff", async () => {
    vi.mocked(runAIChatSession).mockImplementationOnce(async (options) => {
      options.onStage?.("processing", {
        id: "job-1",
        status: "PROCESSING",
        progress: 50,
        message: "Updating",
      });
      await options.onDiagramBound?.("diagram-1");
      options.onStage?.("syncing");
      return {
        diagramId: "diagram-1",
        diagramCreated: true,
        updatedCode: "openapi: 3.0.0\ninfo:\n  title: Updated",
        versionId: "version-2",
        versionNumber: 2,
        jobId: "job-1",
      };
    });
    const onDiagramlyDiagramBound = vi.fn();
    const onApplyCode = vi.fn();
    const onApply = vi.fn();
    const originalCode = "openapi: 3.0.0\ninfo:\n  title: Original";
    renderPanel({
      currentCode: originalCode,
      onDiagramlyDiagramBound,
      onApplyCode,
      onApply,
    });

    submit("Update the API title");
    await flushAsyncWork();

    expect(runAIChatSession).toHaveBeenCalledWith(expect.objectContaining({
      diagramId: "",
      diagramCode: originalCode,
      diagramType: "openapi",
      prompt: "Update the API title",
      signal: expect.any(AbortSignal),
    }));
    expect(onDiagramlyDiagramBound).toHaveBeenCalledWith("diagram-1");
    expect(onApplyCode).toHaveBeenCalledWith("openapi: 3.0.0\ninfo:\n  title: Updated");
    expect(onApply).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="react-ai-change-preview"]')?.textContent)
      .toContain("Changes applied");
    expect(container.querySelector('[data-testid="react-ai-chat-undo"]')).not.toBeNull();

    act(() => {
      Simulate.click(container.querySelector(".ai-chat-diff-toggle")!);
    });
    const diff = container.querySelector('[data-testid="react-ai-chat-diff"]');
    expect(diff?.textContent).toContain("title: Original");
    expect(diff?.textContent).toContain("title: Updated");
  });

  it("keeps the composer editable but prevents a second send while work is active", () => {
    vi.mocked(runAIChatSession).mockImplementationOnce(() => new Promise(() => {}));
    renderPanel({ currentCode: "openapi: 3.0.0" });

    submit("First request");
    const input = setInput("Queue this next");

    expect(container.querySelector('[data-testid="react-ai-chat-thinking"]')?.textContent)
      .toContain("Preparing diagram");
    expect(input.disabled).toBe(false);
    expect((container.querySelector(
      '[data-testid="react-ai-chat-send"]',
    ) as HTMLButtonElement).disabled).toBe(true);
  });

  it("uses the same session with syntax context for an automatic repair request", async () => {
    vi.mocked(runAIChatSession).mockResolvedValueOnce({
      diagramId: "diagram-1",
      diagramCreated: false,
      updatedCode: "openapi: 3.0.0\ninfo:\n  title: Fixed",
      versionId: "version-2",
      jobId: "job-1",
    });
    const syntaxError = "YAML syntax error at line 3\nUnexpected token";
    const onApplyCode = vi.fn();
    renderPanel({
      diagramlyDiagramId: "diagram-1",
      currentCode: "openapi: 3.0.0\ninfo: [",
      syntaxError,
      syntaxRepairRequestId: 1,
      onApplyCode,
    });
    await flushAsyncWork();

    expect(runAIChatSession).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "Fix the current syntax issue without changing the rest of the API definition.",
      errorMessage: syntaxError,
    }));
    expect(container.textContent).toContain("Syntax fixed");
    expect(container.querySelector('[data-testid="react-ai-chat-syntax-issue"]')).toBeNull();
    expect(onApplyCode).toHaveBeenCalledOnce();
  });

  it("loads the complete saved history once and marks the current version", async () => {
    vi.mocked(getDiagramlyVersions).mockResolvedValueOnce({
      versions: [
        initialVersion,
        {
          id: "version-2",
          diagramId: "diagram-1",
          versionNumber: 2,
          instruction: "Add an error response",
          createdAt: "2026-08-29T01:01:00.000Z",
          content: { code: "openapi: 3.0.0\ninfo:\n  title: Current" },
        },
      ],
      diagram: { id: "diagram-1", currentVersionId: "version-2" },
    });
    renderPanel({
      diagramlyDiagramId: "diagram-1",
      currentCode: "openapi: 3.0.0\ninfo:\n  title: Current",
    });
    await flushAsyncWork();

    act(() => {
      Simulate.click(container.querySelector('[data-testid="react-ai-chat-history-trigger"]')!);
    });
    const history = container.querySelector('[data-testid="react-ai-chat-history-panel"]')!;
    expect(history.textContent).toContain("Initial version");
    expect(history.textContent).toContain("Add an error response");
    expect(history.querySelector(".is-current")?.textContent).toContain("v2");
    expect(history.querySelector(".is-current")?.textContent).toContain("Current");

    act(() => {
      Simulate.click(history.querySelector('[aria-label="Close diagram versions"]')!);
      Simulate.click(container.querySelector('[data-testid="react-ai-chat-history-trigger"]')!);
    });
    expect(getDiagramlyVersions).toHaveBeenCalledTimes(1);
  });

  it("restores a historical version as a new audited version and applies its code", async () => {
    vi.mocked(getDiagramlyVersions).mockResolvedValueOnce({
      versions: [
        initialVersion,
        {
          id: "version-2",
          diagramId: "diagram-1",
          versionNumber: 2,
          instruction: "Current update",
          createdAt: "2026-08-29T01:01:00.000Z",
          content: { code: "openapi: 3.0.0\ninfo:\n  title: Current" },
        },
      ],
      diagram: { id: "diagram-1", currentVersionId: "version-2" },
    });
    vi.mocked(restoreDiagramlyVersion).mockResolvedValueOnce({
      diagramId: "diagram-1",
      diagramCode: initialVersion.content.code,
      version: {
        ...initialVersion,
        id: "version-3",
        versionNumber: 3,
        instruction: "Restored from version 1",
        createdAt: "2026-08-29T01:02:00.000Z",
      },
    });
    const onApplyCode = vi.fn();
    renderPanel({
      diagramlyDiagramId: "diagram-1",
      currentCode: "openapi: 3.0.0\ninfo:\n  title: Current",
      onApplyCode,
    });
    await flushAsyncWork();

    act(() => {
      Simulate.click(container.querySelector('[data-testid="react-ai-chat-history-trigger"]')!);
    });
    const restore = Array.from(container.querySelectorAll(".ai-chat-rollback")).find(
      (button) => button.textContent === "Restore version",
    );
    expect(restore).toBeDefined();
    act(() => {
      Simulate.click(restore!);
    });
    await flushAsyncWork();

    expect(restoreDiagramlyVersion).toHaveBeenCalledWith("diagram-1", "version-1");
    expect(onApplyCode).toHaveBeenCalledWith(initialVersion.content.code);
    expect(container.textContent).toContain("Version restored");
    expect(container.textContent).toContain("saved it as v3");
    expect(container.querySelector('[data-testid="react-ai-chat-history-panel"]')).toBeNull();

    act(() => {
      Simulate.click(container.querySelector('[data-testid="react-ai-chat-history-trigger"]')!);
    });
    const history = container.querySelector('[data-testid="react-ai-chat-history-panel"]')!;
    expect(history.textContent).toContain("v3");
    expect(history.querySelector(".is-current")?.textContent).toContain("v3");
  });

  it("undoes an AI change through restore-version and disables repeated undo", async () => {
    vi.mocked(runAIChatSession).mockResolvedValueOnce({
      diagramId: "diagram-1",
      diagramCreated: false,
      updatedCode: "openapi: 3.0.0\ninfo:\n  title: Changed",
      versionId: "version-2",
      versionNumber: 2,
      jobId: "job-1",
    });
    vi.mocked(restoreDiagramlyVersion).mockResolvedValueOnce({
      diagramId: "diagram-1",
      diagramCode: initialVersion.content.code,
      version: {
        ...initialVersion,
        id: "version-3",
        versionNumber: 3,
        instruction: "Restored from version 1",
        createdAt: "2026-08-29T01:02:00.000Z",
      },
    });
    const onApplyCode = vi.fn();
    renderPanel({
      diagramlyDiagramId: "diagram-1",
      currentCode: initialVersion.content.code,
      onApplyCode,
    });
    await flushAsyncWork();

    submit("Change the API title");
    await flushAsyncWork();
    act(() => {
      Simulate.click(container.querySelector('[data-testid="react-ai-chat-undo"]')!);
    });
    await flushAsyncWork();

    expect(restoreDiagramlyVersion).toHaveBeenCalledWith("diagram-1", "version-1");
    expect(container.textContent).toContain("Changes undone");
    expect(onApplyCode).toHaveBeenNthCalledWith(
      1,
      "openapi: 3.0.0\ninfo:\n  title: Changed",
    );
    expect(onApplyCode).toHaveBeenNthCalledWith(2, initialVersion.content.code);
    expect(container.querySelector('[data-testid="react-ai-chat-undo"]')).toBeNull();
  });

  it("opens and closes the selected line diff in a full-screen dialog", async () => {
    vi.mocked(runAIChatSession).mockResolvedValueOnce({
      diagramId: "diagram-1",
      diagramCreated: false,
      updatedCode: "openapi: 3.0.0\ninfo:\n  title: Changed",
      versionId: "version-2",
      versionNumber: 2,
      jobId: "job-1",
    });
    renderPanel({
      diagramlyDiagramId: "diagram-1",
      currentCode: initialVersion.content.code,
    });
    await flushAsyncWork();
    submit("Change the API title");
    await flushAsyncWork();
    act(() => {
      Simulate.click(container.querySelector(".ai-chat-diff-toggle")!);
    });
    act(() => {
      Simulate.click(container.querySelector('[data-testid="react-ai-chat-diff-expand"]')!);
    });

    const fullscreen = container.querySelector(
      '[data-testid="react-ai-chat-diff-fullscreen"]',
    )!;
    expect(fullscreen.getAttribute("aria-modal")).toBe("true");
    expect(fullscreen.textContent).toContain("title: Original");
    expect(fullscreen.textContent).toContain("title: Changed");

    act(() => {
      Simulate.click(fullscreen.querySelector(
        '[data-testid="react-ai-chat-diff-fullscreen-close"]',
      )!);
    });
    expect(container.querySelector('[data-testid="react-ai-chat-diff-fullscreen"]')).toBeNull();
  });

  it("shows a retryable version-history error", async () => {
    vi.mocked(getDiagramlyVersions)
      .mockRejectedValueOnce(new Error("History unavailable"))
      .mockResolvedValueOnce({
        versions: [initialVersion],
        diagram: { id: "diagram-1", currentVersionId: "version-1" },
      });
    renderPanel({ diagramlyDiagramId: "diagram-1" });
    await flushAsyncWork();

    act(() => {
      Simulate.click(container.querySelector('[data-testid="react-ai-chat-history-trigger"]')!);
    });
    expect(container.querySelector('[data-testid="react-ai-chat-history-error"]')?.textContent)
      .toContain("Saved versions could not be loaded");
    act(() => {
      Simulate.click(container.querySelector('[data-testid="react-ai-chat-history-retry"]')!);
    });
    await flushAsyncWork();

    expect(container.querySelector('[data-testid="react-ai-chat-history-error"]')).toBeNull();
    expect(container.querySelector('[data-testid="react-ai-chat-history-panel"]')?.textContent)
      .toContain("Initial version");
    expect(getDiagramlyVersions).toHaveBeenCalledTimes(2);
  });

  it("aborts active work when closing or unmounting", () => {
    const signals: AbortSignal[] = [];
    vi.mocked(runAIChatSession).mockImplementation((options) => {
      signals.push(options.signal!);
      return new Promise(() => {});
    });
    const props = renderPanel({ currentCode: "openapi: 3.0.0" });

    submit("Update once");
    act(() => {
      Simulate.click(container.querySelector('[data-testid="react-ai-chat-close"]')!);
    });
    expect(signals[0].aborted).toBe(true);
    expect(props.onClose).toHaveBeenCalledOnce();

    submit("Update twice");
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    expect(signals[1].aborted).toBe(true);
  });

  it("renders a recoverable assistant error and unlocks the composer", async () => {
    vi.mocked(runAIChatSession).mockRejectedValueOnce(new Error("Diagramly unavailable"));
    renderPanel({ currentCode: "openapi: 3.0.0" });

    submit("Update");
    await flushAsyncWork();

    expect(container.textContent).toContain(
      "AI Chat could not apply the change: Diagramly unavailable",
    );
    const input = setInput("Retry");
    expect(input.disabled).toBe(false);
    expect((container.querySelector(
      '[data-testid="react-ai-chat-send"]',
    ) as HTMLButtonElement).disabled).toBe(false);
  });
});
