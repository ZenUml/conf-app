import { beforeEach, describe, expect, it, vi } from "vitest";

const { trackAnalyticsEvent } = vi.hoisted(() => ({
  trackAnalyticsEvent: vi.fn(),
}));

vi.mock("@/utils/analytics/trackAnalyticsEvent", () => ({ trackAnalyticsEvent }));

import {
  resolveEmbedAutoconvertTarget,
  trackEmbedAutoconvertTargetResult,
} from "./embedAutoconvertTelemetry";

const CLOUD_ID = "bc8bb5b3-09d2-4932-b68c-9b56fab8e34a";
const LINK = `https://conf-lite.zenuml.com/d/${CLOUD_ID}/425987`;
const BASE_PROPERTIES = {
  feature_area: "macro",
  surface: "viewer",
  macro_type: "embed",
};

describe("embed autoconvert telemetry", () => {
  beforeEach(() => trackAnalyticsEvent.mockClear());

  it("records parser/matcher drift without returning a target", () => {
    expect(resolveEmbedAutoconvertTarget("https://example.com/not-a-deeplink", CLOUD_ID)).toBeUndefined();
    expect(trackAnalyticsEvent).toHaveBeenCalledWith("embed_autoconvert_failed", {
      ...BASE_PROPERTIES,
      failure_reason: "invalid_url",
    });
  });

  it("rejects a cross-tenant target with the existing dedicated signal", () => {
    expect(resolveEmbedAutoconvertTarget(LINK, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).toBeUndefined();
    expect(trackAnalyticsEvent).toHaveBeenCalledWith("embed_autoconvert_cross_tenant_rejected", BASE_PROPERTIES);
  });

  it("returns a same-tenant target without claiming it resolved yet", () => {
    expect(resolveEmbedAutoconvertTarget(LINK, CLOUD_ID.toUpperCase())).toEqual({
      contentId: "425987",
      resolution: "autoconvert_link",
    });
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
  });

  it("records custom-content resolution separately from visual rendering", () => {
    trackEmbedAutoconvertTargetResult(true);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith("embed_autoconvert_target_resolved", {
      ...BASE_PROPERTIES,
      resolution: "autoconvert_link",
    });
  });

  it("records a missing target as a resolution failure", () => {
    trackEmbedAutoconvertTargetResult(false);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith("embed_autoconvert_failed", {
      ...BASE_PROPERTIES,
      failure_reason: "target_missing",
    });
  });
});
