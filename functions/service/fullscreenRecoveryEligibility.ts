import {
  getAtlassianInstanceClientDomain,
  getForgeInstallationClientDomain,
} from '../utils/dbUtils';
import { normalizeClientDomain } from '../metrics-cache/snapshot/common';
import type { RecoveryEnv, RecoveryIdentity, RecoveryPolicy } from './fullscreenRecoveryService';

export const FULLSCREEN_RECOVERY_MACROS_LIMIT = 100;
const PAID_RAIL_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;
const FULL_APP_ID = 'd9e4002b-120b-426b-834b-402a4a5adce7';
const DIAGRAMLY_APP_ID = '01ede8b1-4e88-451a-b9ef-89eeef93afaf';
export const RECOVERY_SPACE_KEY = /^[A-Za-z0-9_.~-]{1,255}$/;

export type RecoveryEligibility = 'eligible' | 'disabled' | 'unavailable';

type MetricsDocument = { spaces?: Record<string, { total?: unknown }> };

/** Reuse the exact metrics KV entry served by /metrics-cache/query. Legacy
 * entries can be written through the existing browser update path; this is
 * an existing count dependency, not an independently verified inventory. */
async function cachedSpaceCount(kv: KVNamespace, domain: string, spaceKey: string): Promise<number | null> {
  const metrics = await kv.get(`metrics:${domain}:lite`, 'json') as MetricsDocument | null;
  if (!metrics?.spaces || typeof metrics.spaces !== 'object' || Array.isArray(metrics.spaces)
    || !Object.prototype.hasOwnProperty.call(metrics.spaces, spaceKey)) return null;
  const count = metrics.spaces[spaceKey]?.total;
  return Number.isSafeInteger(count) && Number(count) >= 0 ? Number(count) : null;
}

/** Account/site identity and paid status are server-derived; the count follows
 * the existing Lite metrics-cache read contract. */
export async function recoveryEligibility(
  env: RecoveryEnv,
  identity: RecoveryIdentity,
  spaceKey: string | undefined,
  policy: RecoveryPolicy,
  now = new Date(),
): Promise<RecoveryEligibility> {
  if (!spaceKey || !RECOVERY_SPACE_KEY.test(spaceKey)
    || !env.DB || !env.confluence_plugin_features || !env.KV_FEATURE_FLAGS || !env.SPACE_LICENSE_KV) {
    return 'unavailable';
  }
  try {
    const appAri = `ari:cloud:ecosystem::app/${identity.forgeAppId}`;
    const rawDomain = await getAtlassianInstanceClientDomain(env.DB, identity.cloudId)
      || await getForgeInstallationClientDomain(env.DB, appAri, identity.cloudId)
      || await getForgeInstallationClientDomain(env.DB, identity.forgeAppId, identity.cloudId);
    const domain = rawDomain ? normalizeClientDomain(rawDomain) : '';
    if (!domain || !/^[a-z0-9][a-z0-9-]{0,126}$/.test(domain)) return 'unavailable';

    const count = await cachedSpaceCount(env.confluence_plugin_features, domain, spaceKey);
    if (count === null) return 'unavailable';
    if (count < FULLSCREEN_RECOVERY_MACROS_LIMIT) return 'disabled';

    const [userRaw, spaceRaw, exemptionRaw] = await Promise.all([
      env.SPACE_LICENSE_KV.get(`license:${identity.cloudId}:${spaceKey}:${identity.accountId}`),
      env.SPACE_LICENSE_KV.get(`license:${identity.cloudId}:${spaceKey}`),
      env.KV_FEATURE_FLAGS.get('PAYWALL_EXEMPTIONS'),
    ]);
    const userPaid = paidLicense(userRaw, now);
    const spacePaid = paidLicense(spaceRaw, now);
    if (userPaid === 'unknown' || spacePaid === 'unknown') return 'unavailable';
    if (userPaid || spacePaid) return 'disabled';
    const cutoff = new Date(now.getTime() - PAID_RAIL_WINDOW_MS).toISOString();
    const paidRail = await env.DB.prepare(`SELECT 1 FROM ForgeInstallation
      WHERE cloudId = ?1 AND appId IN (?2, ?3) AND createdAt >= ?4 LIMIT 1`)
      .bind(identity.cloudId, FULL_APP_ID, DIAGRAMLY_APP_ID, cutoff).first();
    if (paidRail) return 'disabled';

    if (!exemptionRaw) return 'unavailable';
    const exemptions: unknown = JSON.parse(exemptionRaw);
    if (!exemptions || typeof exemptions !== 'object' || Array.isArray(exemptions)
      || Object.values(exemptions).some(value => typeof value !== 'boolean')) return 'unavailable';
    const flags = exemptions as Record<string, boolean>;
    // The wildcard is a fleet-wide kill switch. A site-specific reviewed
    // override may bypass only that site's operational exemption.
    if (flags['*'] === true) return 'disabled';
    if (flags[domain] === true && policy.exemptionOverrideReviewed !== true) return 'disabled';
    return 'eligible';
  } catch {
    // Missing or failed evidence cannot consume the once-only grant.
    return 'unavailable';
  }
}

function paidLicense(raw: string | null, now: Date): boolean | 'unknown' {
  if (raw === null) return false;
  try {
    const record = JSON.parse(raw) as { status?: unknown; expiresAt?: unknown };
    if (!record || (record.status !== 'active' && record.status !== 'inactive')
      || typeof record.expiresAt !== 'string') return 'unknown';
    const expiry = Date.parse(record.expiresAt);
    if (!Number.isFinite(expiry)) return 'unknown';
    return record.status === 'active' && expiry > now.getTime();
  } catch { return 'unknown'; }
}
