import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Header from "./Header";
import { isAiTitleEnabled } from "@/apis/aiTitleFeatureFlag";

vi.mock("@/apis/aiTitleFeatureFlag", () => ({
  isAiTitleEnabled: vi.fn(),
}));

vi.mock("@/utils/closeGuard", () => ({
  setupCloseGuard: vi.fn(() => vi.fn()),
}));

vi.mock("@/utils/draftStore", () => ({
  makeDebouncedDraftSaver: vi.fn(() => ({
    save: vi.fn(),
    flush: vi.fn(),
  })),
  loadDraft: vi.fn().mockResolvedValue(null),
  clearDraft: vi.fn().mockResolvedValue(undefined),
  primeCloudId: vi.fn().mockResolvedValue(undefined),
  getCachedCloudId: vi.fn(),
  saveDraftSync: vi.fn(),
}));

describe("React Header AI Chat feature flag", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    window.specListeners = [];
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    vi.clearAllMocks();
  });

  async function renderHeader(enabled: boolean) {
    vi.mocked(isAiTitleEnabled).mockResolvedValue(enabled);

    await act(async () => {
      ReactDOM.render(
        <Header
          saveAndExit={vi.fn()}
          exit={vi.fn()}
          onToggleAiChat={vi.fn()}
        />,
        container,
      );
      await Promise.resolve();
    });
  }

  it("shows AI Chat when the AI feature flag is enabled", async () => {
    await renderHeader(true);

    expect(container.querySelector('[data-testid="react-ai-chat-toggle"]')).not.toBeNull();
  });

  it("hides AI Chat when the AI feature flag is disabled", async () => {
    await renderHeader(false);

    expect(container.querySelector('[data-testid="react-ai-chat-toggle"]')).toBeNull();
  });
});
