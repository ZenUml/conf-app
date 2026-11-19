// functions/service/appInstalledAnalytics.ts
//
// Builds the backend-emitted `app_installed` Mixpanel event (#1102) from the
// Forge `avi:forge:installed:app` trigger payload. Pure so it can be unit
// tested without D1 or the network; functions/forge-installed.ts sends it.
//
// Why this exists: installs were recorded only in D1 (AnalyticsEventFact,
// purged by retention) and ForgeInstallation (whose createdAt is overwritten
// on every upgrade), so "did a new site publish a diagram within 24h?" could
// not be a Mixpanel funnel. distinct_id is the installer's accountId — the
// same id the frontend passes to mixpanel.identify (src/utils/window.ts) — so
// app_installed -> macro_create_succeeded joins on the person who installed.
import type { ForgeAppRequestBody } from '../RequestBody';
import type { MixpanelServiceEvent } from './mixpanelService';
import { normalizeClientDomain, productTypeForAppId } from '../metrics-cache/snapshot/common';

export interface AppInstalledContext {
  cloudId: string | null;
  /** D1's known domain for the site; frequently null on a brand-new install. */
  clientDomain: string | null;
  /** Epoch milliseconds; injected for deterministic tests. */
  now: number;
}

/** Returns null for anything that is not a first install (upgrades are excluded). */
export function buildAppInstalledEvent(
  body: ForgeAppRequestBody,
  context: AppInstalledContext,
): MixpanelServiceEvent | null {
  if (body.eventType !== 'avi:forge:installed:app') return null;
  if (!body.id) return null;

  const productType = productTypeForAppId(body.app?.id || '');
  const clientDomain = context.clientDomain ? normalizeClientDomain(context.clientDomain) : '';

  return {
    event: 'app_installed',
    // Fall back to an installation-scoped id rather than dropping the event:
    // the install still counts toward per-site funnels via cloud_id.
    distinctId: body.installerAccountId || `installation:${body.id}`,
    // One install fires once; a Forge retry of the same trigger dedupes here.
    insertId: `${body.id}:app_installed`,
    time: Math.floor(context.now / 1000),
    properties: {
      feature_area: 'system',
      surface: 'forge_trigger',
      product_type: productType ?? 'unknown',
      installation_id: body.id,
      cloud_id: context.cloudId,
      app_version: body.app?.version || null,
      client_domain: clientDomain || null,
      installer_known: !!body.installerAccountId,
    },
  };
}
