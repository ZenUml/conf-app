import { mixpanelTrack } from '../service/mixpanelService';
import type { BundleCheckoutDeps } from '../service/bundleCheckout';

export interface BundleCheckoutEnv {
  MIXPANEL_TOKEN?: string;
}

/** Runtime wiring shared by /bundle-checkout and /bundle-checkout/go. */
export function bundleCheckoutDeps(env: BundleCheckoutEnv, waitUntil: (work: Promise<unknown>) => void): BundleCheckoutDeps {
  return {
    track: async (event) => {
      if (env.MIXPANEL_TOKEN) await mixpanelTrack(event, env.MIXPANEL_TOKEN, env);
    },
    waitUntil,
    nonce: crypto.randomUUID().replace(/-/g, ''),
  };
}
