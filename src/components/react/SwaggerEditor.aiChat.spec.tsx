import React from "react";
import ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/react/Header", async () => {
  const ReactModule = await import("react");
  return {
    default: (props: any) => ReactModule.createElement(
      "button",
      {
        type: "button",
        "data-testid": "header-ai-chat-toggle",
        onClick: props.onToggleAiChat,
      },
      props.aiChatOpen ? "Close AI Chat" : "Open AI Chat",
    ),
  };
});

vi.mock("@/components/react/AIChatPanel", async () => {
  const ReactModule = await import("react");
  return {
    default: (props: any) => ReactModule.createElement(
      "aside",
      { "data-testid": "react-ai-chat-panel-stub" },
      [
        ReactModule.createElement("span", { key: "code", "data-testid": "chat-code" }, props.currentCode),
        ReactModule.createElement("span", { key: "id", "data-testid": "chat-diagram-id" }, props.diagramlyDiagramId),
        ReactModule.createElement("button", {
          key: "apply",
          type: "button",
          "data-testid": "chat-apply",
          onClick: () => props.onApplyCode("openapi: 3.0.0\ninfo:\n  title: AI updated"),
        }),
        ReactModule.createElement("button", {
          key: "bind",
          type: "button",
          "data-testid": "chat-bind",
          onClick: () => void props.onDiagramlyDiagramBound("diagramly-1"),
        }),
        ReactModule.createElement("button", {
          key: "toggle",
          type: "button",
          "data-testid": "chat-toggle-code",
          onClick: props.onToggleCode,
        }),
        ReactModule.createElement("button", {
          key: "close",
          type: "button",
          "data-testid": "chat-close",
          onClick: props.onClose,
        }),
      ],
    ),
  };
});

import SwaggerEditor from "./SwaggerEditor";
import store from "@/model/store2";
import { DiagramType } from "@/model/Diagram/Diagram";

describe("SwaggerEditor AI Chat integration", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    store.state.diagram = {
      id: "macro-1",
      diagramType: DiagramType.OpenApi,
      code: "openapi: 3.0.0\ninfo:\n  title: Original",
      title: "Original",
      metadata: {
        keep: "existing",
        aiChat: { keepNested: "existing" },
      },
    } as any;
    store.state.error = null;
    act(() => {
      ReactDOM.render(
        <SwaggerEditor saveAndExit={vi.fn()} exit={vi.fn()} />,
        container,
      );
    });
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });

  function openChat(): void {
    act(() => {
      Simulate.click(container.querySelector('[data-testid="header-ai-chat-toggle"]')!);
    });
  }

  it("mounts Chat while retaining Swagger state and supports code visibility", () => {
    openChat();

    expect(container.querySelector('[data-testid="react-ai-chat-panel-stub"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="chat-code"]')?.textContent).toContain("Original");
    expect(container.querySelector(".swagger-editor-workspace")?.className)
      .toContain("code-editor-hidden");
    expect((container.querySelector("#syntax-error-box") as HTMLElement).style.display).toBe("none");

    act(() => {
      Simulate.click(container.querySelector('[data-testid="chat-toggle-code"]')!);
    });
    expect(container.querySelector(".swagger-editor-workspace")?.className)
      .not.toContain("code-editor-hidden");
    expect(container.querySelector("#swagger-editor")).not.toBeNull();
  });

  it("captures document hydration that happens before the first store mutation", () => {
    act(() => {
      store.state.diagram = {
        ...store.state.diagram,
        code: "openapi: 3.0.0\ninfo:\n  title: Hydrated",
        metadata: { aiChat: { diagramlyDiagramId: "hydrated-diagram" } },
      } as any;
      store.commit("updateError", null);
    });
    openChat();

    expect(container.querySelector('[data-testid="chat-code"]')?.textContent)
      .toContain("Hydrated");
    expect(container.querySelector('[data-testid="chat-diagram-id"]')?.textContent)
      .toBe("hydrated-diagram");
  });

  it("applies AI code through the store and merges Diagramly metadata", async () => {
    openChat();
    act(() => {
      Simulate.click(container.querySelector('[data-testid="chat-apply"]')!);
    });
    await act(async () => {
      Simulate.click(container.querySelector('[data-testid="chat-bind"]')!);
      await Promise.resolve();
    });

    expect(store.state.diagram.code).toContain("AI updated");
    expect(container.querySelector('[data-testid="chat-code"]')?.textContent).toContain("AI updated");
    expect(store.state.diagram.metadata).toEqual({
      keep: "existing",
      aiChat: {
        keepNested: "existing",
        diagramlyDiagramId: "diagramly-1",
      },
    });
    expect(container.querySelector('[data-testid="chat-diagram-id"]')?.textContent)
      .toBe("diagramly-1");
  });

  it("restores the Swagger workspace when Chat closes", () => {
    openChat();
    act(() => {
      Simulate.click(container.querySelector('[data-testid="chat-close"]')!);
    });

    expect(container.querySelector('[data-testid="react-ai-chat-panel-stub"]')).toBeNull();
    expect(container.querySelector(".swagger-editor-workspace")?.className)
      .not.toContain("code-editor-hidden");
    expect((container.querySelector("#syntax-error-box") as HTMLElement).style.display).toBe("block");
  });
});
