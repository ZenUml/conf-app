import React from "react";
import ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AIChatPanel from "./AIChatPanel";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";

vi.mock("@/utils/analytics/trackAnalyticsEvent", () => ({
  trackAnalyticsEvent: vi.fn(),
}));

describe("React AIChatPanel", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.mocked(trackAnalyticsEvent).mockClear();
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
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "ai_chat_change_applied",
      expect.objectContaining({ change_kind: "request", version_id: 2 }),
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
      expect.objectContaining({ change_kind: "undo", version_id: 1 }),
    );
  });

  it("opens version history and restores an earlier version", () => {
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
      (button) => button.textContent === "Restore",
    );
    expect(restore).toBeDefined();
    act(() => {
      Simulate.click(restore!);
    });

    expect(container.querySelector('[data-testid="react-ai-chat-history-panel"]')).toBeNull();
    expect(container.textContent).toContain("Version restored");
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "ai_chat_version_restored",
      expect.objectContaining({ change_kind: "rollback", version_id: 1 }),
    );
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
});
