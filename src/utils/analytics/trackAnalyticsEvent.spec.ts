// src/utils/analytics/trackAnalyticsEvent.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import mixpanel from "mixpanel-browser";
import { getClientDomain, getSpaceKey } from "@/utils/ContextParameters/ContextParameters";
import forgeGlobal from "@/model/globals/forgeGlobal";
import { _awaitableTrackAnalyticsEvent, _resetForTesting } from "./trackAnalyticsEvent";

vi.mock("mixpanel-browser", () => ({
  default: {
    init: vi.fn(),
    identify: vi.fn(),
    track: vi.fn(),
  },
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
        content_id: "page-789",
        custom_content_id: "cc-456",
        attachment_name: "zenuml-cc-456.png",
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
