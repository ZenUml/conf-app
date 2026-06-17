// src/utils/analytics/trackAnalyticsEvent.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import mixpanel from "mixpanel-browser";
import { getClientDomain, getSpaceKey } from "@/utils/ContextParameters/ContextParameters";
import forgeGlobal from "@/model/globals/forgeGlobal";
import { _awaitableTrackAnalyticsEvent, _resetForTesting } from "./trackAnalyticsEvent";
import { getSessionReplayConfig } from "./sessionReplayFlags";

vi.mock("mixpanel-browser", () => ({
  default: {
    init: vi.fn(),
    identify: vi.fn(),
    track: vi.fn(),
    register: vi.fn(),
  },
}));

vi.mock("./sessionReplayFlags", () => ({
  getSessionReplayConfig: vi.fn(),
}));

vi.mock("@/model/globals/forgeGlobal", () => ({
  default: {
    isForge: true,
    forgeContext: { localId: "macro-abc", environmentType: "production" },
  },
}));

vi.mock("@/utils/ContextParameters/ContextParameters", () => ({
  getClientDomain: vi.fn().mockReturnValue("example.atlassian.net"),
  getSpaceKey: vi.fn().mockReturnValue("ENG"),
}));

const mockGlobals = {
  apWrapper: {
    currentUser: { atlassianAccountId: "user-123" },
    getMacroData: vi.fn().mockResolvedValue({ uuid: "fallback-uuid" }),
    getCurrentSpaceAdmins: vi.fn().mockResolvedValue([
      { type: "user", id: "user-999", displayName: "Alice Admin" },
      { type: "user", id: "user-123", displayName: "Bob Builder" },
    ]),
  },
};

describe("trackAnalyticsEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
    // @ts-ignore
    window.globals = mockGlobals;
    vi.mocked(forgeGlobal).isForge = true;
    vi.mocked(forgeGlobal).forgeContext = {
      localId: "macro-abc",
      environmentType: "production",
    } as any;
    vi.mocked(getClientDomain).mockReturnValue("example.atlassian.net");
    vi.mocked(getSpaceKey).mockReturnValue("ENG");
    // Default: replay off. Tests that care about the rate override this.
    vi.mocked(getSessionReplayConfig).mockResolvedValue({
      percent: 0,
      source: "off",
    });
  });

  describe("event sampling", () => {
    it("drops a rate-0 event without initializing mixpanel", async () => {
      await _awaitableTrackAnalyticsEvent("renderer_prefetch_started", {
        feature_area: "system",
        surface: "viewer",
      });
      expect(mixpanel.track).not.toHaveBeenCalled();
      // Dropped before _initMixpanel, so no Forge-bridge round trip is paid.
      expect(mixpanel.init).not.toHaveBeenCalled();
    });

    it("stamps sample_rate on a down-sampled event when kept", async () => {
      const rnd = vi.spyOn(Math, "random").mockReturnValue(0.01); // < 0.1 → keep
      await _awaitableTrackAnalyticsEvent("space_admin_active", {
        feature_area: "upgrade",
        surface: "page_banner",
        is_space_admin: true,
      });
      expect(mixpanel.track).toHaveBeenCalledWith(
        "space_admin_active",
        expect.objectContaining({ sample_rate: 0.1 }),
      );
      rnd.mockRestore();
    });

    it("does not stamp sample_rate on full-rate events", async () => {
      await _awaitableTrackAnalyticsEvent("macro_save_succeeded", {
        feature_area: "macro",
        surface: "editor",
      });
      const call = vi
        .mocked(mixpanel.track)
        .mock.calls.find((c) => c[0] === "macro_save_succeeded");
      expect(call).toBeTruthy();
      expect(call![1]).not.toHaveProperty("sample_rate");
    });
  });

  it("sends macro_viewed with correct event name to Mixpanel", async () => {
    await _awaitableTrackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
      macro_type: "sequence",
      entry_point: "page_view",
    });

    expect(mixpanel.track).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({
        feature_area: "macro",
        surface: "viewer",
        macro_type: "sequence",
        entry_point: "page_view",
      })
    );
  });

  it("auto-enriches user_account_id from window.globals", async () => {
    await _awaitableTrackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
    });

    expect(mixpanel.track).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({ user_account_id: "user-123" })
    );
  });

  it("auto-enriches client_domain from ContextParameters", async () => {
    await _awaitableTrackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
    });

    expect(mixpanel.track).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({ client_domain: "example.atlassian.net" })
    );
  });

  it("auto-enriches macro_uuid from Forge localId", async () => {
    await _awaitableTrackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
    });

    expect(mixpanel.track).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({ macro_uuid: "macro-abc" })
    );
  });

  it("adds the space admin count for macro_viewed", async () => {
    await _awaitableTrackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
    });

    expect(mockGlobals.apWrapper.getCurrentSpaceAdmins).toHaveBeenCalled();
    expect(mixpanel.track).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({ space_admin_count: 2 })
    );
  });

  it("auto-enriches page_id, content_id, custom_content_id, attachment_name from forgeContext", async () => {
    vi.mocked(forgeGlobal).forgeContext = {
      localId: "macro-abc",
      environmentType: "production",
      extension: {
        content: { id: "page-789" },
        config: { customContentId: "cc-456" },
      },
    } as any;

    await _awaitableTrackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
    });

    expect(mixpanel.track).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({
        page_id: "page-789",
        content_id: "cc-456",
        custom_content_id: "cc-456",
        attachment_name: "zenuml-cc-456.png",
      })
    );
  });

  // content_id has a legacy meaning across the codebase: customContentId, not pageId
  // (see forgeIndex.ts, forge-swagger-editor.ts, ForgeGraphEditor.vue). Auto-enrichment
  // must not alias content_id to page_id, or the dimension's meaning diverges by call path.
  it("does NOT populate content_id with page_id when only page context is available", async () => {
    vi.mocked(forgeGlobal).forgeContext = {
      localId: "macro-abc",
      environmentType: "production",
      extension: {
        content: { id: "page-789" },
      },
    } as any;

    await _awaitableTrackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
    });

    expect(mixpanel.track).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({
        page_id: "page-789",
        content_id: null,
        custom_content_id: null,
      })
    );
  });

  it("falls back to extension.modal.customContentId when extension.config is missing", async () => {
    vi.mocked(forgeGlobal).forgeContext = {
      localId: "macro-abc",
      environmentType: "production",
      extension: {
        content: { id: "page-789" },
        modal: { customContentId: "cc-from-modal" },
      },
    } as any;

    await _awaitableTrackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
    });

    expect(mixpanel.track).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({
        custom_content_id: "cc-from-modal",
        attachment_name: "zenuml-cc-from-modal.png",
      })
    );
  });

  it("sets page_id, custom_content_id, attachment_name to null when forgeContext fields are missing", async () => {
    vi.mocked(forgeGlobal).forgeContext = {
      localId: "macro-abc",
      environmentType: "production",
    } as any;

    await _awaitableTrackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
    });

    expect(mixpanel.track).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({
        page_id: null,
        content_id: null,
        custom_content_id: null,
        attachment_name: null,
      })
    );
  });

  it("caller-supplied properties override auto-enriched values", async () => {
    await _awaitableTrackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
      client_domain: "override.atlassian.net",
      user_account_id: "caller-user",
    });

    expect(mixpanel.track).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({
        client_domain: "override.atlassian.net",
        user_account_id: "caller-user",
      })
    );
  });

  it("falls back to sentinel values when context is unavailable", async () => {
    // @ts-ignore
    window.globals = undefined;
    vi.mocked(getClientDomain).mockReturnValue(undefined as any);
    vi.mocked(getSpaceKey).mockReturnValue(undefined as any);
    vi.mocked(forgeGlobal).isForge = false;
    vi.mocked(forgeGlobal).forgeContext = null as any;

    await _awaitableTrackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
    });

    expect(mixpanel.track).toHaveBeenCalledWith(
      "macro_viewed",
      expect.objectContaining({
        client_domain: "unknown_atlassian_domain",
        user_account_id: "unknown_user_account_id",
        macro_uuid: "unknown_macro_uuid",
        confluence_space: "unknown_space",
      })
    );
  });

  it("never records the page-banner iframe and skips the flag fetch", async () => {
    vi.mocked(forgeGlobal).forgeContext = {
      localId: undefined,
      moduleKey: "zenuml-page-banner",
      environmentType: "production",
    } as any;
    // Even if the flag would say record, the banner short-circuits to 0.
    vi.mocked(getSessionReplayConfig).mockResolvedValue({
      percent: 100,
      source: "sampled",
    });

    await _awaitableTrackAnalyticsEvent("paywall_banner_shown", {
      feature_area: "upgrade",
      surface: "page_banner",
    });

    expect(getSessionReplayConfig).not.toHaveBeenCalled();
    expect(mixpanel.init).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ record_sessions_percent: 0 })
    );
    expect(mixpanel.register).toHaveBeenCalledWith({
      session_replay_percent: 0,
      session_replay_source: "off",
    });
  });

  it("takes record_sessions_percent from the Forge flag config in a macro context", async () => {
    vi.mocked(forgeGlobal).forgeContext = {
      localId: undefined,
      moduleKey: "zenuml-sequence-macro",
      environmentType: "production",
    } as any;
    vi.mocked(getSessionReplayConfig).mockResolvedValue({
      percent: 100,
      source: "targeted",
    });

    await _awaitableTrackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
      macro_type: "sequence",
    });

    expect(mixpanel.init).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ record_sessions_percent: 100 })
    );
    expect(mixpanel.register).toHaveBeenCalledWith({
      session_replay_percent: 100,
      session_replay_source: "targeted",
    });
  });

  it("records nothing when the flag config resolves off", async () => {
    vi.mocked(forgeGlobal).forgeContext = {
      localId: undefined,
      moduleKey: "zenuml-sequence-macro",
      environmentType: "production",
    } as any;
    vi.mocked(getSessionReplayConfig).mockResolvedValue({
      percent: 0,
      source: "off",
    });

    await _awaitableTrackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
      macro_type: "sequence",
    });

    expect(mixpanel.init).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ record_sessions_percent: 0 })
    );
  });

  it("does not throw when mixpanel.track throws", async () => {
    vi.mocked(mixpanel.track).mockImplementation(() => {
      throw new Error("mixpanel down");
    });

    await expect(
      _awaitableTrackAnalyticsEvent("upgrade_modal_shown", {
        feature_area: "upgrade",
        surface: "modal",
      })
    ).resolves.not.toThrow();
  });
});
