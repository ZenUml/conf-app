import {
  getClientDomain,
  getSpaceKey,
} from "@/utils/ContextParameters/ContextParameters";
import mixpanel from "mixpanel-browser";
import {DiagramType} from "@/model/Diagram/Diagram";
import forgeGlobal from "@/model/globals/forgeGlobal";

let initialized = false;
let identified = false;
const unknownUserAccountId  = "unknown_user_account_id";

const initMixpanel = () => {
  if(!initialized) {
    mixpanel.init(import.meta.env.VITE_MIXPANEL_TOKEN, {
      debug: true,
      track_pageview: false,
      autocapture: false,
      persistence: "localStorage",
      ignore_dnt: true
    });
    initialized = true;
  }
};

const mixpanelIdentify = () => {
  if(!identified) {
    const userAccountId = getCurrentUserAccountId();
    try {
      mixpanel.identify(userAccountId);

      identified = userAccountId !== unknownUserAccountId;
    } catch(e) {
      console.error("Error in calling mixpanel.identify", e);
    }
  }
};

export function getUrlParam(param: string): string | undefined {
  try {
    const matches = new RegExp(param + "=([^&]*)").exec(window.location.search);
    return (
      (matches && matches[1] && decodeURIComponent(matches[1])) || undefined
    );
  } catch (e) {
    return undefined;
  }
}

interface EventDetails {
  // user
  user_account_id: string;
  // confluence and macro
  client_domain: string;
  confluence_space: string;
  macro_uuid?: string;
  product_type?: string;
  // event
  event_category: string;
  event_label: string;
  [key: string]: string | boolean | undefined;
}

export type EventCategory = DiagramType
  | 'error' | 'warning' | 'info'
  | 'macro' | 'ai' | 'analytics'
  | 'user' | 'system' | 'performance';

/**
 * trackEvent is an async function but not awaitable on purpose.
 * 1. Main process will not wait for the tracking to finish.
 * 2. If there is an error in tracking, it will not affect the main process.
 * @param label
 * @param action
 * @param category
 * @param resetEventDetails
 */
export function trackEvent(
  label: string,
  action: string,
  category: EventCategory | string,
  resetEventDetails: Record<string, any> = {}
) {
  void _awaitableTrackEvent(label, action, category, resetEventDetails);
}

const MIGRATED_ACTIONS = new Set([
  'view_macro',
  'create_macro_begin',
  'edit_macro_begin',
  'create_macro_end',
  'edit_macro_end',
]);

// awaitable function for testing
export async function _awaitableTrackEvent(
  label: string,
  action: string,
  category: EventCategory | string,
  resetEventDetails: Record<string, any> = {}
) {
  if (MIGRATED_ACTIONS.has(action)) {
    console.warn(`[analytics] Legacy action "${action}" was migrated to trackAnalyticsEvent — use that instead.`);
  }
  try {
    initMixpanel();
    mixpanelIdentify();

    let eventDetails = {
      event_category: category || "unknown",
      event_label: label || "",
      ...resetEventDetails,
    } as EventDetails;
    // make sure event is still sent out even if there are errors in setting up the event details
    try {
      eventDetails = {
        ...eventDetails,
        user_account_id: getCurrentUserAccountId(),
        client_domain: getClientDomain() || "unknown_atlassian_domain",
        confluence_space: getSpaceKey() || "unknown_space",
        macro_uuid: await getMacroUuid(),
        product_type: _getProductType(),
      };
    } catch (e) {
      console.error(e);
    }

    try {
      mixpanel.track(action, Object.assign({}, eventDetails));
    } catch (e) {
      console.error("Error in calling mixpanel.track", e);
    }
  } catch (e) {
    console.error(
      "Error in trackingEvent. Please report to our helpdesk: https://zenuml.atlassian.net/servicedesk/customer/portals",
      e
    );
  }
}

function getCurrentUserAccountId(): string {
  return (
    // @ts-ignore
    window.globals?.apWrapper?.currentUser?.atlassianAccountId ||
    unknownUserAccountId
  );
}

async function getMacroUuid(): Promise<string> {
  // For Forge, use localId from context (stable macro identifier)
  if (forgeGlobal.isForge && forgeGlobal.forgeContext?.localId) {
    return forgeGlobal.forgeContext.localId;
  }

  // Fallback for Connect or when context not ready
  // @ts-ignore
  const macroData = await window.globals?.apWrapper.getMacroData();
  return macroData?.uuid || "unknown_macro_uuid";
}

function _getProductType(): "lite" | "full" | "diagramly" {
  const t = import.meta.env.PRODUCT_TYPE;
  if (t === "lite" || t === "full" || t === "diagramly") return t;
  return "full";
}

export function addonKeyForProductType(productType: string | undefined): string {
  switch (productType) {
    case "lite":
      return "com.zenuml.confluence-addon-lite";
    case "diagramly":
      return "gptdock-confluence";
    case "full":
    default:
      return "com.zenuml.confluence-addon";
  }
}

export function addonKey() {
  return addonKeyForProductType(import.meta.env.PRODUCT_TYPE);
}

function version() {
  return getUrlParam("version") || "unknown_version";
}

async function callTrack(action: string, eventDetails: any) {
  try {
    await fetch(`${window.location.origin}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        Object.assign(
          {
            addon_key: addonKey(),
            version: version(),
            action,
          },
          eventDetails
        )
      ),
    });
  } catch (e) {
    console.log("Error in calling /track", e);
  }
}

/**
 * Synchronous event tracking for page unload scenarios
 * Uses navigator.sendBeacon to ensure events are sent even when page is closing
 * 
 * @param label - Event label
 * @param action - Event action
 * @param category - Event category
 * @param details - Additional event details
 */
export function trackEventSync(
  label: string,
  action: string,
  category: EventCategory | string,
  details: Record<string, any> = {}
) {
  try {
    const eventDetails = {
      event_category: category || "unknown",
      event_label: label || "",
      user_account_id: getCurrentUserAccountId(),
      client_domain: getClientDomain() || "unknown_atlassian_domain",
      confluence_space: getSpaceKey() || "unknown_space",
      product_type: _getProductType(),
      ...details,
    };
    
    const data = JSON.stringify({
      addon_key: addonKey(),
      version: version(),
      action,
      ...eventDetails
    });
    
    // Use sendBeacon for reliable delivery during page unload
    if (navigator.sendBeacon) {
      const blob = new Blob([data], { type: 'application/json' });
      const success = navigator.sendBeacon(`${window.location.origin}/track`, blob);
      console.log(`[Analytics] Event sent via sendBeacon (${success}):`, action);
    } else {
      // Fallback: synchronous XHR (not recommended but better than nothing)
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${window.location.origin}/track`, false); // synchronous
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(data);
      console.log('[Analytics] Event sent via sync XHR:', action);
    }
  } catch (e) {
    console.error('[Analytics] Failed to send sync event:', e);
  }
}

/**
 * Serialize any caught value into a string suitable for Mixpanel event labels.
 * Handles Error objects, DOM Events ({isTrusted:true}), and other non-serializable values.
 */
export function serializeError(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }
  if (e && typeof e === 'object') {
    if ('message' in e && typeof (e as any).message === 'string') {
      return (e as any).message;
    }
    // DOM Event objects serialize to {isTrusted:true} — extract type instead
    if ('isTrusted' in e && e instanceof Event) {
      return `DOM ${e.type} event (no error message)`;
    }
    const json = JSON.stringify(e);
    return json === '{}' ? `Non-serializable error: ${Object.prototype.toString.call(e)}` : json;
  }
  return String(e);
}

export function getLocalStorageKey(key: string) {
  return `${key}-${getClientDomain()}`;
}

export function getLocalState(key: string, DEFAULT_STATE: any) {
  try {
    const localState = window.localStorage.getItem(getLocalStorageKey(key));
    return (localState && JSON.parse(localState)) || DEFAULT_STATE;
  } catch (e) {
    return DEFAULT_STATE;
  }
}

export function setLocalState(key: string, state: any) {
  window.localStorage.setItem(getLocalStorageKey(key), JSON.stringify(state));
}
