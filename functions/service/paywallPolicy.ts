import {
  getAtlassianInstanceClientDomain,
  getForgeInstallationClientDomain,
} from '../utils/dbUtils';
import { normalizeClientDomain } from '../metrics-cache/snapshot/common';

// Full and Diagramly Forge app identifiers (our own app IDs, not tenant
// data — see .claude/skills/forge-installs/SKILL.md).
export const FULL_APP_ID = 'd9e4002b-120b-426b-834b-402a4a5adce7';
export const DIAGRAMLY_APP_ID = '01ede8b1-4e88-451a-b9ef-89eeef93afaf';

// Atlassian's Forge trial is 30 days; +15 days buffer for install-to-decision
// lag. Long-term paid Full/Diagramly tenants are handled by explicit
// PAYWALL_EXEMPTIONS entries (see the paywall skill), NOT by this query —
// this suppression is deliberately time-boxed so it can never substitute for
// a real license check on an old install.
export const PAID_RAIL_TRIAL_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;

const APP_ARI_PREFIX = 'ari:cloud:ecosystem::app/';
const TRUSTED_CLIENT_DOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,126}$/;

export function isBooleanOnlyObject(value: unknown): value is Record<string, boolean> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === 'boolean');
}

/**
 * Parse and validate the `PAYWALL_EXEMPTIONS` KV JSON payload (boolean values
 * only, keyed by Confluence subdomain prefix with `"*"` as the fleet-wide kill
 * switch). Returns `undefined` on any missing, malformed, or non-boolean-valued
 * input so callers fail open.
 */
export function parsePaywallExemptionsMap(raw: string | null | undefined): Record<string, boolean> | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isBooleanOnlyObject(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export async function readPaywallExemptionsMap(
  kv: KVNamespace | undefined,
): Promise<Record<string, boolean> | undefined> {
  if (!kv) return undefined;
  try {
    const raw = await kv.get('PAYWALL_EXEMPTIONS');
    return parsePaywallExemptionsMap(raw);
  } catch (e) {
    console.error(e);
    return undefined;
  }
}

/**
 * Evaluate whether `clientDomain` is exempt from the Lite paywall.
 * Returns `true` (exempt), `false` (default-on), or `undefined` (unavailable /
 * fail-open).
 */
export async function evaluatePaywallExemption(
  kv: KVNamespace | undefined,
  clientDomain: string | undefined,
): Promise<boolean | undefined> {
  if (!kv || !clientDomain) return undefined;
  const exemptions = await readPaywallExemptionsMap(kv);
  if (!exemptions) return undefined;
  return exemptions['*'] === true || exemptions[clientDomain] === true;
}

/**
 * Resolve a trusted `clientDomain` (Confluence subdomain prefix) server-side
 * from an authenticated FIT `cloudId` via D1 (`AtlassianInstance` first, then
 * `ForgeInstallation`), never from an unauthenticated query parameter.
 */
export async function resolveTrustedClientDomain(
  db: D1Database | undefined,
  cloudId: string | undefined,
  forgeAppId?: string,
): Promise<string | undefined> {
  if (!db || !cloudId) return undefined;
  try {
    let rawDomain = await getAtlassianInstanceClientDomain(db, cloudId);
    if (!rawDomain && forgeAppId) {
      const appAri = forgeAppId.startsWith(APP_ARI_PREFIX)
        ? forgeAppId
        : `${APP_ARI_PREFIX}${forgeAppId}`;
      const rawId = forgeAppId.startsWith(APP_ARI_PREFIX)
        ? forgeAppId.slice(APP_ARI_PREFIX.length)
        : forgeAppId;
      rawDomain = await getForgeInstallationClientDomain(db, appAri, cloudId)
        || await getForgeInstallationClientDomain(db, rawId, cloudId);
    }
    const domain = rawDomain ? normalizeClientDomain(rawDomain) : '';
    if (!domain || !TRUSTED_CLIENT_DOMAIN_RE.test(domain)) return undefined;
    return domain;
  } catch {
    return undefined;
  }
}

/**
 * Evaluate a single `SPACE_LICENSE_KV` JSON record against `now`.
 * Returns `true` (active & unexpired), `false` (absent, inactive, or expired),
 * or `'unknown'` (malformed JSON / invalid record shape / unparseable expiry).
 */
export function paidLicense(raw: string | null, now: Date = new Date()): boolean | 'unknown' {
  if (raw === null) return false;
  try {
    const record = JSON.parse(raw) as { status?: unknown; expiresAt?: unknown };
    if (
      !record
      || (record.status !== 'active' && record.status !== 'inactive')
      || typeof record.expiresAt !== 'string'
    ) {
      return 'unknown';
    }
    const expiry = Date.parse(record.expiresAt);
    if (!Number.isFinite(expiry)) return 'unknown';
    return record.status === 'active' && expiry > now.getTime();
  } catch {
    return 'unknown';
  }
}

/**
 * Paid-rail suppression: a `cloudId` with a recent Full or Diagramly Forge
 * install within the 45-day trial window is treated as paid on Lite.
 * Returns `{ isPaid: true, decisionKnown: true, source: 'paid_rail' }` on a hit,
 * `null` on a confirmed miss, and `undefined` when D1 is missing or failed.
 */
export async function checkPaidRail(
  db: D1Database | undefined,
  cloudId: string,
  now: Date = new Date(),
): Promise<{ isPaid: true; decisionKnown: true; source: 'paid_rail' } | null | undefined> {
  if (!db) return undefined;
  try {
    const cutoff = new Date(now.getTime() - PAID_RAIL_TRIAL_WINDOW_MS).toISOString();
    const row = await db
      .prepare(
        `SELECT 1 FROM ForgeInstallation WHERE cloudId = ?1 AND appId IN ('${FULL_APP_ID}','${DIAGRAMLY_APP_ID}') AND createdAt >= ?2 LIMIT 1`
      )
      .bind(cloudId, cutoff)
      .first();
    if (row) {
      return { isPaid: true, decisionKnown: true, source: 'paid_rail' };
    }
    return null;
  } catch (error) {
    console.error('space-status: paid_rail D1 check failed', error);
    return undefined;
  }
}
