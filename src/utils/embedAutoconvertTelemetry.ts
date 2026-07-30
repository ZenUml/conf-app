import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import { parseEmbedDeeplink } from "@/utils/embedDeeplink";
import type { EmbedAutoconvertResolution } from "@/utils/analytics/catalog";

const PROPERTIES = {
  feature_area: "macro" as const,
  surface: "viewer" as const,
  macro_type: "embed" as const,
};

export type EmbedAutoconvertTarget = {
  contentId: string;
  resolution: EmbedAutoconvertResolution;
};

export function resolveEmbedAutoconvertTarget(
  autoConvertLink: string,
  currentCloudId?: string,
): EmbedAutoconvertTarget | undefined {
  const deeplink = parseEmbedDeeplink(autoConvertLink);
  if (!deeplink) {
    trackAnalyticsEvent("embed_autoconvert_failed", {
      ...PROPERTIES,
      failure_reason: "invalid_url",
    });
    return undefined;
  }

  if (currentCloudId && deeplink.cloudId !== currentCloudId.toLowerCase()) {
    trackAnalyticsEvent("embed_autoconvert_cross_tenant_rejected", PROPERTIES);
    return undefined;
  }

  return {
    contentId: deeplink.contentId,
    resolution: "autoconvert_link",
  };
}

// This records only whether the referenced custom-content document resolved.
// It intentionally does not claim the viewer painted successfully.
export function trackEmbedAutoconvertTargetResult(found: boolean): void {
  if (found) {
    trackAnalyticsEvent("embed_autoconvert_target_resolved", {
      ...PROPERTIES,
      resolution: "autoconvert_link",
    });
    return;
  }

  trackAnalyticsEvent("embed_autoconvert_failed", {
    ...PROPERTIES,
    failure_reason: "target_missing",
  });
}
