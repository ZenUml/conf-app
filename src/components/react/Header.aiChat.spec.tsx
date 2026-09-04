import React from "react";
import ReactDOM from "react-dom";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Header from "./Header";
import { isAiChatEnabled } from "@/apis/aiTitleFeatureFlag";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";

vi.mock("@/apis/aiTitleFeatureFlag", () => ({
  isAiChatEnabled: vi.fn(),
}));

vi.mock("@/utils/analytics/trackAnalyticsEvent", () => ({
  trackAnalyticsEvent: vi.fn(),
}));

vi.mock("@/components/react/OpenApiTitleInput", () => ({
  default: () => null,
}));

vi.mock("@/components/react/PublishButton", () => ({
  PublishButton: () => null,
}));

vi.mock("@/utils/closeGuard", () => ({
  setupCloseGuard: vi.fn(() => vi.fn()),
}));

vi.mock("@/utils/draftStore", () => ({
  makeDebouncedDraftSaver: vi.fn(() => ({
    save: vi.fn(),
    flush: vi.fn(),
    cancel: vi.fn(),
  })),
  loadDraft: vi.fn().mockResolvedValue(null),
  clearDraft: vi.fn().mockResolvedValue(undefined),
  primeCloudId: vi.fn().mockResolvedValue(undefined),
  getCachedCloudId: vi.fn(),
  getCachedSavedVersionUpdatedAt: vi.fn(),
  saveDraftSync: vi.fn(),
  isDraftNewerThanSaved: vi.fn(() => false),
}));

describe("React Header AI Chat feature flag", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    window.specListeners = [];
    window.diagram = undefined;
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    vi.clearAllMocks();
  });

  async function renderHeader(enabled: boolean, onToggleAiChat = vi.fn()) {
    vi.mocked(isAiChatEnabled).mockResolvedValue(enabled);
    await act(async () => {
      ReactDOM.render(
        <Header
          saveAndExit={vi.fn()}
          exit={vi.fn()}
          aiChatOpen
          onToggleAiChat={onToggleAiChat}
        />,
        container,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    return onToggleAiChat;
  }

  it("shows the active AI Chat action and forwards its toggle", async () => {
    const onToggleAiChat = await renderHeader(true);
    const toggle = container.querySelector(
      '[data-testid="react-ai-chat-toggle"]',
    ) as HTMLButtonElement;

    expect(toggle).not.toBeNull();
    expect(toggle.className).toContain("bg-violet-100");
    expect(trackAnalyticsEvent).toHaveBeenCalledWith("ai_chat_button_shown", {
      feature_area: "ai",
      surface: "editor",
      macro_type: "openapi",
    });
    act(() => {
      Simulate.click(toggle);
    });
    expect(onToggleAiChat).toHaveBeenCalledOnce();
  });

  it("hides AI Chat when its independent feature flag is disabled", async () => {
    await renderHeader(false);

    expect(container.querySelector('[data-testid="react-ai-chat-toggle"]')).toBeNull();
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith(
      "ai_chat_button_shown",
      expect.anything(),
    );
  });
});
