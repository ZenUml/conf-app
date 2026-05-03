import { trackEvent, serializeError } from "@/utils/window";
import { getClientDomain } from "@/utils/ContextParameters/ContextParameters";
import forgeGlobal from "@/model/globals/forgeGlobal";

export default async function (features: string[]) {
  const client = getClientDomain();
  const featuresParam = features.join(",");

  trackEvent(`${client || 'empty'}|${featuresParam}`, 'get_feature_flags_attempt', 'info');

  if (!client) {
    trackEvent('empty_client_domain', 'get_feature_flags', 'error');
    return {};
  }

  try {
    const baseUrl = forgeGlobal.zenumlRemoteBaseUrl;
    const response = await fetch(
      `${baseUrl}/feature-flags?client=${client}&features=${featuresParam}`
    );

    if (!response.ok) {
      console.error("HTTP Error:", response.status, response.statusText);
      trackEvent(response.statusText, 'get_feature_flags', 'error');
      return {};
    }

    const data = await response.json();
    console.debug("featureFlags", client, features, data);
    return data;
  } catch (error) {
    console.error("Fetching feature flags failed:", error);
    trackEvent(serializeError(error), 'get_feature_flags', 'error');
    return {};
  }
}
