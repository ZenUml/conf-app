import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Header from "./Header";
import EventBus from "@/EventBus";
import { setupCloseGuard } from "@/utils/closeGuard";
import { clearDraftSync, makeDebouncedDraftSaver, saveDraftSync } from "@/utils/draftStore";

// forge-swagger-editor.ts emits publish-committing before view.submit /
// view.close. Those calls can destroy the iframe before 'saved' is emitted,
// so the OpenAPI header must clear its draft at commit and must not let the
// close guard or the per-keystroke saver re-create it during teardown.

vi.mock("@/apis/aiTitleFeatureFlag", () => ({ isAiChatEnabled: vi.fn().mockResolvedValue(false) }));
vi.mock("@/utils/analytics/trackAnalyticsEvent", () => ({ trackAnalyticsEvent: vi.fn() }));
vi.mock("@/components/react/OpenApiTitleInput", () => ({ default: () => null }));
vi.mock("@/components/react/PublishButton", () => ({ PublishButton: () => null }));
vi.mock("@/utils/closeGuard", () => ({ setupCloseGuard: vi.fn(() => vi.fn()) }));
vi.mock("@/utils/draftStore", () => ({
  makeDebouncedDraftSaver: vi.fn(() => ({ save: vi.fn(), flush: vi.fn(), cancel: vi.fn() })),
  loadDraft: vi.fn().mockResolvedValue(null),
  clearDraft: vi.fn().mockResolvedValue(undefined),
  clearDraftSync: vi.fn(),
  primeCloudId: vi.fn().mockResolvedValue(undefined),
  getCachedCloudId: vi.fn(() => "cloud"),
  getCachedSavedVersionUpdatedAt: vi.fn(),
  saveDraftSync: vi.fn(),
  isDraftNewerThanSaved: vi.fn(() => false),
}));

const ORIGINAL = "openapi: 3.0.0\ninfo: { title: A }";
const EDITED = "openapi: 3.0.0\ninfo: { title: B }";

describe("React Header — draft at Publish commit", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.specListeners = [];
    (window as any).specContent = ORIGINAL;
    (window as any).diagram = { code: ORIGINAL, title: "API" };
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
    (window as any).specContent = undefined;
    (window as any).diagram = undefined;
  });

  async function renderHeader() {
    await act(async () => {
      root.render(<Header saveAndExit={vi.fn()} exit={vi.fn()} />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const saver = vi.mocked(makeDebouncedDraftSaver).mock.results.at(-1)!.value;
    const closeHandler = vi.mocked(setupCloseGuard).mock.calls.at(-1)![0] as () => void;
    const typeSpec = (spec: string) => {
      (window as any).specContent = spec;
      for (const listener of window.specListeners!) listener(spec);
    };
    return { saver, closeHandler, typeSpec };
  }

  it("clears the draft synchronously when Publish commits", async () => {
    const { saver, typeSpec } = await renderHeader();
    typeSpec(EDITED);

    EventBus.$emit("publish-committing", "42");

    expect(saver.cancel).toHaveBeenCalled();
    expect(clearDraftSync).toHaveBeenCalledWith("new:openapi");
  });

  it("does not re-create the draft from the saver or the close guard after commit", async () => {
    const { saver, closeHandler, typeSpec } = await renderHeader();
    typeSpec(EDITED);
    saver.save.mockClear();

    EventBus.$emit("publish-committing", "42");
    typeSpec(EDITED + "\n# late");
    closeHandler();

    expect(saver.save).not.toHaveBeenCalled();
    expect(saveDraftSync).not.toHaveBeenCalled();
  });

  it("writes the draft back when view.submit fails after commit", async () => {
    const { typeSpec } = await renderHeader();
    typeSpec(EDITED);

    EventBus.$emit("publish-commit-failed", new Error("before commit"));
    expect(saveDraftSync).not.toHaveBeenCalled();

    EventBus.$emit("publish-committing", "42");
    EventBus.$emit("publish-commit-failed", new Error("MACRO_NOT_FOUND"));

    expect(saveDraftSync).toHaveBeenCalledWith("new:openapi", "cloud", expect.objectContaining({ code: EDITED }));
  });

  it("does not re-save published content when the editor closes after a successful save", async () => {
    const { closeHandler, typeSpec } = await renderHeader();
    typeSpec(EDITED);

    EventBus.$emit("saved", "42");
    closeHandler();

    expect(saveDraftSync).not.toHaveBeenCalled();
  });
});
