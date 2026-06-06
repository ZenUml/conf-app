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

  function renderPanel(onClose = vi.fn()) {
    act(() => {
      ReactDOM.render(
        <AIChatPanel
          open
          diagramType="openapi"
          prototypeMode
          onClose={onClose}
        />,
        container,
      );
    });
    return onClose;
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

    const input = container.querySelector('[data-testid="react-ai-chat-input"]') as HTMLTextAreaElement;
    expect(input.value).toBe("Add an error handling path");
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "ai_chat_suggestion_selected",
      expect.objectContaining({ suggestion_id: "add-error-path", macro_type: "openapi" }),
    );
  });

  it("renders the prototype preview after submitting", () => {
    vi.useFakeTimers();
    renderPanel();
    const input = container.querySelector('[data-testid="react-ai-chat-input"]') as HTMLTextAreaElement;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "Add a retry response");
      Simulate.change(input);
    });
    expect(input.value).toBe("Add a retry response");
    const form = container.querySelector("form")!;
    act(() => {
      Simulate.submit(form);
    });

    expect(container.querySelector('[data-testid="react-ai-chat-thinking"]')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(700);
    });

    expect(container.querySelector('[data-testid="react-ai-change-preview"]')).not.toBeNull();
    expect(container.textContent).toContain("Preserve the existing API operations and schemas");
  });

  it("closes from the header button", () => {
    const onClose = renderPanel();
    const close = container.querySelector('[data-testid="react-ai-chat-close"]')!;

    act(() => {
      Simulate.click(close);
    });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
