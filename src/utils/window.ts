import {
  getClientDomain,
  getSpaceKey,
} from "@/utils/ContextParameters/ContextParameters";
import mixpanel from "mixpanel-browser";
import {DiagramType} from "@/model/Diagram/Diagram";
import forgeGlobal from "@/model/globals/forgeGlobal";

if(forgeGlobal.isForge) {
  mixpanel.init("78617e65fdba543d752fb7f6483d55f4", {
    debug: true,
    track_pageview: true,
    persistence: "localStorage",
  });
}

let identified = false;
const unknownUserAccountId  = "unknown_user_account_id";

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
  isLite?: boolean;
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

// awaitable function for testing
export async function _awaitableTrackEvent(
  label: string,
  action: string,
  category: EventCategory | string,
  resetEventDetails: Record<string, any> = {}
) {
  try {
    const userAccountId = getCurrentUserAccountId();
    if (!identified) {
      if(forgeGlobal.isForge) {
        mixpanel.identify(userAccountId);
      }
      
      identified = userAccountId !== unknownUserAccountId;
    }
    let eventDetails = {
      event_category: category || "unknown",
      event_label: label || "",
      ...resetEventDetails,
    } as EventDetails;
    // make sure event is still sent out even if there are errors in setting up the event details
    try {
      eventDetails = {
        ...eventDetails,
        user_account_id: userAccountId,
        client_domain: getClientDomain() || "unknown_atlassian_domain",
        confluence_space: getSpaceKey() || "unknown_space",
        macro_uuid: await getMacroUuid(),
        isLite: isLite(),
      };
    } catch (e) {
      console.error(e);
    }

    if(forgeGlobal.isForge) {
        try {
        // Clone eventDetails to prevent mixpanel's pollution(will add 'token' property)
        mixpanel.track(action, Object.assign({}, eventDetails));
      } catch (e) {
        console.error("Error in calling mixpanel", e);
      }
    }

    try {
      // @ts-ignore
      window.gtag && window.gtag("event", action, eventDetails);
    } catch (e) {
      console.log("Error in calling gtag", e);
    }

    if(!forgeGlobal.isForge) {
      await r2Track(action, eventDetails);
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
  // @ts-ignore
  const macroData = await window.globals?.apWrapper.getMacroData();

  return macroData?.uuid || "unknown_macro_uuid";
}

function isLite(): boolean {
  // @ts-ignore
  return window.globals?.apWrapper?.isLite() || false;
}

export function addonKey() {
  return getUrlParam("addonKey") || "unknown_addon";
}

function version() {
  return getUrlParam("version") || "unknown_version";
}

async function r2Track(action: string, eventDetails: any) {
  try {
    await fetch(`${window.location.origin}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        Object.assign(
          {
            event_source: window.location.host,
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
