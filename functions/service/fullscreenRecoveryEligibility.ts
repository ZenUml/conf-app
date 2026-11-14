import {
  checkPaidRail,
  paidLicense,
  parsePaywallExemptionsMap,
  resolveTrustedClientDomain,
} from './paywallPolicy';
import type { RecoveryEnv, RecoveryIdentity, RecoveryPolicy } from './fullscreenRecoveryService';

export const FULLSCREEN_RECOVERY_MACROS_LIMIT = 100;
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
    const domain = await resolveTrustedClientDomain(env.DB, identity.cloudId, identity.forgeAppId);
    if (!domain) return 'unavailable';

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

    const paidRail = await checkPaidRail(env.DB, identity.cloudId, now);
    if (paidRail === undefined) return 'unavailable';
    if (paidRail) return 'disabled';

    const flags = parsePaywallExemptionsMap(exemptionRaw);
    if (!flags) return 'unavailable';
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
