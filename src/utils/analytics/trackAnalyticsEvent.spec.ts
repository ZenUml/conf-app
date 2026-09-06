// src/utils/analytics/trackAnalyticsEvent.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import mixpanel from "mixpanel-browser";
import { getClientDomain, getSpaceKey } from "@/utils/ContextParameters/ContextParameters";
import forgeGlobal from "@/model/globals/forgeGlobal";
import {
  _awaitableTrackAnalyticsEvent,
  _resetForTesting,
  trackAnalyticsEvent,
  trackAnalyticsEventBeforeUnload,
} from "./trackAnalyticsEvent";
import { getSessionReplayConfig } from "./sessionReplayFlags";
import { normalizeProductType } from "./productType";
import { isCurrentPageDemoPage } from "./demoPageStatus";
import { EVENT_SAMPLE_RATES } from "./eventSampling";

vi.mock("mixpanel-browser", () => ({
  default: {
    init: vi.fn(),
    identify: vi.fn(),
    track: vi.fn(),
    register: vi.fn(),
    start_session_recording: vi.fn(),
  },
}));

vi.mock("./sessionReplayFlags", () => ({
  getSessionReplayConfig: vi.fn(),
}));

vi.mock("./demoPageStatus", () => ({
  isCurrentPageDemoPage: vi.fn(),
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

// Identity resolution (2026-07-26). Measured: 4 event names lose 17-100% of
// their user attribution because they fire before the Forge context resolves
// (ai_aide_route_accessed 100%, renderer_prefetch_* 35-37%,
// legacy_content_property_load_failed 30%). The old code called
// mixpanel.identify("unknown_user_account_id") — a constant SHARED BY EVERY
// USER — which permanently pins those events to one bogus profile. Staying on
// Mixpanel's own per-device anonymous id instead lets the later identify()
// merge them into the right user, with no delay and no dropped events.
describe("trackAnalyticsEvent — identity resolution", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    _resetForTesting();
    // @ts-ignore
    window.globals = mockGlobals;
    vi.mocked(forgeGlobal).isForge = true;
    vi.mocked(forgeGlobal).forgeContext = { localId: "macro-abc" } as any;
    vi.mocked(getSessionReplayConfig).mockResolvedValue({
      percent: 0,
      source: "off",
    } as any);
  });

  it("does NOT identify with the shared placeholder when the account id is unresolved", async () => {
    // @ts-ignore — the context has not resolved yet
    window.globals = { apWrapper: { getMacroData: vi.fn().mockResolvedValue({}) } };

    await _awaitableTrackAnalyticsEvent("viewer_source_opened", {});

    expect(mixpanel.identify).not.toHaveBeenCalled();
    // ...and the event is still sent — never delayed, never dropped.
    expect(mixpanel.track).toHaveBeenCalledWith(
      "viewer_source_opened",
      expect.any(Object)
    );
  });

  it("labels the event with this build's product type, not a hard-coded default", async () => {
    // @ts-ignore
    window.globals = mockGlobals;

    await _awaitableTrackAnalyticsEvent("viewer_source_opened", {
      feature_area: "macro",
      surface: "viewer",
    });

    // Derived from the shared resolver rather than asserted as a literal, so an
    // asyncapi build (PRODUCT_TYPE=asyncapi) is required to report 'asyncapi'
    // instead of falling through to the 'full' default — issues #367, #416.
    expect(mixpanel.track).toHaveBeenCalledWith(
      "viewer_source_opened",
      expect.objectContaining({
        product_type: normalizeProductType(import.meta.env.PRODUCT_TYPE),
      })
    );
  });

  it("identifies once the account id resolves on a later event", async () => {
    // @ts-ignore
    window.globals = { apWrapper: { getMacroData: vi.fn().mockResolvedValue({}) } };
    await _awaitableTrackAnalyticsEvent("viewer_source_opened", {});
    expect(mixpanel.identify).not.toHaveBeenCalled();

    // @ts-ignore — context resolves between events
    window.globals = mockGlobals;
    await _awaitableTrackAnalyticsEvent("viewer_source_copied", {});

    expect(mixpanel.identify).toHaveBeenCalledTimes(1);
    expect(mixpanel.identify).toHaveBeenCalledWith("user-123");
  });

  it("SWR: reuses the cached account id so the FIRST event of a later iframe is attributed", async () => {
    // Iframe 1: context resolves, so the id is cached for this domain.
    await _awaitableTrackAnalyticsEvent("viewer_source_opened", {});
    expect(mixpanel.identify).toHaveBeenCalledWith("user-123");

    // Iframe 2 (fresh module state, context not resolved yet) — the cache
    // makes its very first event correctly attributed instead of anonymous.
    _resetForTesting();
    vi.clearAllMocks();
    // @ts-ignore
    window.globals = { apWrapper: { getMacroData: vi.fn().mockResolvedValue({}) } };

    await _awaitableTrackAnalyticsEvent("viewer_source_opened", {});

    expect(mixpanel.identify).toHaveBeenCalledWith("user-123");
  });

  it("SWR cache is domain-scoped — another tenant does not inherit the id", async () => {
    await _awaitableTrackAnalyticsEvent("viewer_source_opened", {});
    expect(mixpanel.identify).toHaveBeenCalledWith("user-123");

    _resetForTesting();
    vi.clearAllMocks();
    vi.mocked(getClientDomain).mockReturnValue("other.atlassian.net");
    // @ts-ignore
    window.globals = { apWrapper: { getMacroData: vi.fn().mockResolvedValue({}) } };

    await _awaitableTrackAnalyticsEvent("viewer_source_opened", {});

    expect(mixpanel.identify).not.toHaveBeenCalled();
  });

  it("identifies exactly once across many events", async () => {
    await _awaitableTrackAnalyticsEvent("viewer_source_opened", {});
    await _awaitableTrackAnalyticsEvent("viewer_source_copied", {});
    await _awaitableTrackAnalyticsEvent("fullscreen_opened", {});

    expect(mixpanel.identify).toHaveBeenCalledTimes(1);
    expect(mixpanel.identify).toHaveBeenCalledWith("user-123");
  });
});

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
    vi.mocked(isCurrentPageDemoPage).mockResolvedValue(false);
  });

  describe("event sampling", () => {
    it("drops a rate-0 event without initializing mixpanel", async () => {
      // No production event is currently rate-0 (the last two — renderer
      // prefetch's telemetry — were deleted 2026-09-02 along with their emit
      // call sites), but the mechanism must still work for whichever event
      // needs it next. Override a real AnalyticsEventName's rate rather than
      // depending on today's config.
      EVENT_SAMPLE_RATES.macro_viewed = 0;
      try {
        await _awaitableTrackAnalyticsEvent("macro_viewed", {
          feature_area: "system",
          surface: "viewer",
        });
        expect(mixpanel.track).not.toHaveBeenCalled();
        // Dropped before _initMixpanel, so no Forge-bridge round trip is paid.
        expect(mixpanel.init).not.toHaveBeenCalled();
      } finally {
        delete EVENT_SAMPLE_RATES.macro_viewed;
      }
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

  it("always records the plan-usage page at 100% and skips the flag fetch", async () => {
    vi.mocked(forgeGlobal).forgeContext = {
      localId: undefined,
      moduleKey: "zenuml-plan-usage-page",
      environmentType: "production",
    } as any;
    // Even if the flag would say off, the plan-usage page short-circuits to 100.
    vi.mocked(getSessionReplayConfig).mockResolvedValue({
      percent: 0,
      source: "off",
    });

    await _awaitableTrackAnalyticsEvent("plan_usage_viewed", {
      feature_area: "upgrade",
      surface: "dashboard",
    });

    expect(getSessionReplayConfig).not.toHaveBeenCalled();
    expect(mixpanel.init).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ record_sessions_percent: 100 })
    );
    expect(mixpanel.register).toHaveBeenCalledWith({
      session_replay_percent: 100,
      session_replay_source: "plan_usage_page",
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

  it("keeps viewer replay off when the flag config resolves off", async () => {
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
    expect(mixpanel.start_session_recording).not.toHaveBeenCalled();
    const [, properties] = vi.mocked(mixpanel.track).mock.calls[0];
    expect(properties).not.toHaveProperty("session_replay_source", "authoring");
    expect(properties).not.toHaveProperty("session_replay_start_call_outcome");
  });

  it("forces replay when macro creation starts", async () => {
    trackAnalyticsEvent("macro_create_started", {
      feature_area: "macro",
      surface: "editor",
      macro_type: "sequence",
      entry_point: "page_editor",
    });

    await vi.waitFor(() => {
      expect(mixpanel.track).toHaveBeenCalledWith(
        "macro_create_started",
        expect.objectContaining({
          session_replay_source: "authoring",
          session_replay_percent: 100,
          session_replay_start_call_outcome: "returned",
        })
      );
    });
    expect(mixpanel.start_session_recording).toHaveBeenCalledOnce();
    expect(
      vi.mocked(mixpanel.start_session_recording).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(mixpanel.track).mock.invocationCallOrder[0]);
    expect(mixpanel.register).toHaveBeenLastCalledWith({
      session_replay_percent: 100,
      session_replay_source: "authoring",
    });
  });

  it("forces replay when macro editing starts", async () => {
    trackAnalyticsEvent("macro_edit_started", {
      feature_area: "macro",
      surface: "editor",
      macro_type: "openapi",
      entry_point: "macro_toolbar",
    });

    await vi.waitFor(() => {
      expect(mixpanel.track).toHaveBeenCalledWith(
        "macro_edit_started",
        expect.objectContaining({
          session_replay_source: "authoring",
          session_replay_percent: 100,
          session_replay_start_call_outcome: "returned",
        })
      );
    });
    expect(mixpanel.start_session_recording).toHaveBeenCalledOnce();
    expect(mixpanel.register).toHaveBeenLastCalledWith({
      session_replay_percent: 100,
      session_replay_source: "authoring",
    });
  });

  it("sends an authoring start event when optional demo-page enrichment stalls", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(forgeGlobal).forgeContext = {
        localId: "macro-abc",
        environmentType: "production",
        extension: { content: { id: "page-789" } },
      } as any;
      vi.mocked(isCurrentPageDemoPage).mockImplementation(
        () => new Promise<boolean>(() => {}),
      );

      const tracking = _awaitableTrackAnalyticsEvent("macro_edit_started", {
        feature_area: "macro",
        surface: "editor",
        macro_type: "sequence",
        entry_point: "macro_toolbar",
      });

      await vi.advanceTimersByTimeAsync(750);
      await tracking;

      expect(mixpanel.track).toHaveBeenCalledWith(
        "macro_edit_started",
        expect.objectContaining({
          session_replay_source: "authoring",
          session_replay_percent: 100,
        }),
      );
      const [, properties] = vi.mocked(mixpanel.track).mock.calls.at(-1)!;
      expect(properties).not.toHaveProperty("is_demo_page");
    } finally {
      vi.useRealTimers();
    }
  });

  it("still sends the authoring event when replay startup throws", async () => {
    vi.mocked(mixpanel.start_session_recording).mockImplementationOnce(() => {
      throw new Error("recorder unavailable");
    });

    trackAnalyticsEvent("macro_create_started", {
      feature_area: "macro",
      surface: "editor",
      macro_type: "graph",
      entry_point: "page_editor",
    });

    await vi.waitFor(() => {
      expect(mixpanel.track).toHaveBeenCalledWith(
        "macro_create_started",
        expect.objectContaining({
          session_replay_start_call_outcome: "threw",
        })
      );
    });
    const [, properties] = vi.mocked(mixpanel.track).mock.calls[0];
    expect(properties).not.toHaveProperty("session_replay_source", "authoring");
    expect(properties).not.toHaveProperty("session_replay_percent", 100);
    expect(mixpanel.register).toHaveBeenLastCalledWith({
      session_replay_percent: 0,
      session_replay_source: "off",
    });
  });

  // Registered ahead of implementation (catalog.ts's "Planned ahead of
  // implementation" block, 2026-07-09) for Tracks F/G/C — no production call
  // site exists yet. These smoke-test that the catalog.ts name + types.ts
  // property additions actually compile against AnalyticsProperties and are
  // accepted by the tracker at runtime, so the contract Track F/G/C build
  // against is verified now rather than discovered broken later.
  describe("planned agent_link_* events (F/G/C — no call site yet)", () => {
    it("accepts agent_link_first_feedback with ms_since_op_received", async () => {
      await _awaitableTrackAnalyticsEvent("agent_link_first_feedback", {
        feature_area: "agent_link",
        surface: "fullscreen",
        macro_type: "sequence",
        ms_since_op_received: 120,
      });
      expect(mixpanel.track).toHaveBeenCalledWith(
        "agent_link_first_feedback",
        expect.objectContaining({ macro_type: "sequence", ms_since_op_received: 120 })
      );
    });

    it("accepts agent_link_render_completed with render_ms/total_ms/render_outcome", async () => {
      await _awaitableTrackAnalyticsEvent("agent_link_render_completed", {
        feature_area: "agent_link",
        surface: "fullscreen",
        macro_type: "mermaid",
        render_ms: 80,
        total_ms: 950,
        render_outcome: "rendered",
      });
      expect(mixpanel.track).toHaveBeenCalledWith(
        "agent_link_render_completed",
        expect.objectContaining({ render_ms: 80, total_ms: 950, render_outcome: "rendered" })
      );
    });

    it("accepts agent_link_session_suspended with reason", async () => {
      await _awaitableTrackAnalyticsEvent("agent_link_session_suspended", {
        feature_area: "agent_link",
        surface: "fullscreen",
        macro_type: "sequence",
        reason: "fullscreen_closed",
      });
      expect(mixpanel.track).toHaveBeenCalledWith(
        "agent_link_session_suspended",
        expect.objectContaining({ reason: "fullscreen_closed" })
      );
    });

    it("accepts agent_link_session_resumed with reason + resume_latency_ms", async () => {
      await _awaitableTrackAnalyticsEvent("agent_link_session_resumed", {
        feature_area: "agent_link",
        surface: "fullscreen",
        macro_type: "sequence",
        reason: "fullscreen_closed",
        resume_latency_ms: 4200,
      });
      expect(mixpanel.track).toHaveBeenCalledWith(
        "agent_link_session_resumed",
        expect.objectContaining({ reason: "fullscreen_closed", resume_latency_ms: 4200 })
      );
    });

    // #314 events-first commit: registered ahead of the FSM/composable fix so
    // the fix's trackAnalyticsEvent call site (useAgentLinkSession.ts's
    // handleExpired()) is built against a reviewed name/property contract.
    it("accepts agent_link_session_expired with had_agent_connected/session_duration_ms/edits_count", async () => {
      await _awaitableTrackAnalyticsEvent("agent_link_session_expired", {
        feature_area: "agent_link",
        surface: "fullscreen",
        macro_type: "sequence",
        had_agent_connected: true,
        session_duration_ms: 600000,
        edits_count: 3,
      });
      expect(mixpanel.track).toHaveBeenCalledWith(
        "agent_link_session_expired",
        expect.objectContaining({
          had_agent_connected: true,
          session_duration_ms: 600000,
          edits_count: 3,
        })
      );
    });
  });

  // A caller that navigates immediately after tracking (the load-failed
  // panel's "Try again" reloads the iframe) loses a plain XHR-transported
  // event: production emitted 1 load_failed_retry_resolved and 0
  // load_failed_retry_clicked on 2026-08-23, because the reload aborted the
  // in-flight request. sendBeacon is the transport that survives unload.
  describe("trackAnalyticsEventBeforeUnload", () => {
    it("sends with the sendBeacon transport", async () => {
      await trackAnalyticsEventBeforeUnload("load_failed_retry_clicked", {
        feature_area: "macro",
        surface: "viewer",
        retry_attempt: 1,
      });

      expect(mixpanel.track).toHaveBeenCalledWith(
        "load_failed_retry_clicked",
        expect.objectContaining({ retry_attempt: 1 }),
        { transport: "sendBeacon" }
      );
    });

    it("resolves only after the event has been handed to mixpanel", async () => {
      const order: string[] = [];
      vi.mocked(mixpanel.track).mockImplementation(() => {
        order.push("track");
      });

      await trackAnalyticsEventBeforeUnload("load_failed_retry_clicked", {
        feature_area: "macro",
        surface: "viewer",
      });
      order.push("await-resolved");

      expect(order).toEqual(["track", "await-resolved"]);
    });

    it("does not throw when mixpanel.track throws", async () => {
      vi.mocked(mixpanel.track).mockImplementation(() => {
        throw new Error("mixpanel down");
      });

      await expect(
        trackAnalyticsEventBeforeUnload("load_failed_retry_clicked", {
          feature_area: "macro",
          surface: "viewer",
        })
      ).resolves.not.toThrow();
    });
  });

  it("keeps the default transport for ordinary events", async () => {
    await _awaitableTrackAnalyticsEvent("upgrade_modal_shown", {
      feature_area: "upgrade",
      surface: "modal",
    });

    expect(mixpanel.track).toHaveBeenCalledWith(
      "upgrade_modal_shown",
      expect.any(Object)
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
