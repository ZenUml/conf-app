import {
  getAtlassianInstanceClientDomain,
  getForgeInstallationClientDomain,
} from '../utils/dbUtils';
import {
  latestPointerKey, normalizeClientDomain, readJsonObject, sha256Hex,
  SNAPSHOT_SCHEMA_VERSION, tenantSnapshotPrefix, utcDateParts,
  type LatestPointer,
} from '../metrics-cache/snapshot/common';
import type { RecoveryEnv, RecoveryIdentity, RecoveryPolicy } from './fullscreenRecoveryService';

export const FULLSCREEN_RECOVERY_MACROS_LIMIT = 100;
export const FULLSCREEN_RECOVERY_METRICS_FRESHNESS_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const PAID_RAIL_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;
const FULL_APP_ID = 'd9e4002b-120b-426b-834b-402a4a5adce7';
const DIAGRAMLY_APP_ID = '01ede8b1-4e88-451a-b9ef-89eeef93afaf';
export const RECOVERY_SPACE_KEY = /^[A-Za-z0-9_.~-]{1,255}$/;

export type RecoveryEligibility = 'eligible' | 'disabled' | 'unavailable';

type AggregateReference = { key: string; rowCount: number; sha256: string };
type CompletedManifest = {
  schemaVersion: number; runId: string; capturedAt: string; cloudId: string;
  productType: string; state: string; spaceAggregateChunks: AggregateReference[];
};
type AggregateRow = { spaceId: string; spaceKey: string; metrics: { total: number } };
type AggregateChunk = { schemaVersion: number; runId: string; rows: AggregateRow[] };

/** The legacy metrics KV is browser-writable. Only a completed, server-owned R2
 * snapshot can establish the count that permits a once-only recovery grant. */
async function trustedSpaceCount(
  bucket: R2Bucket, cloudId: string, spaceKey: string, now: Date,
): Promise<number | null> {
  const pointer = await readJsonObject<LatestPointer>(bucket, latestPointerKey('lite', cloudId));
  if (!pointer || pointer.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || pointer.state !== 'completed'
    || pointer.cloudId !== cloudId || pointer.productType !== 'lite'
    || !/^[A-Za-z0-9._~-]{1,200}$/.test(pointer.runId)
    || typeof pointer.capturedAt !== 'string') return null;
  const capturedAt = Date.parse(pointer.capturedAt);
  if (!Number.isFinite(capturedAt) || now.getTime() - capturedAt > FULLSCREEN_RECOVERY_METRICS_FRESHNESS_MS
    || capturedAt - now.getTime() > MAX_FUTURE_SKEW_MS) return null;
  const { year, month, day } = utcDateParts(pointer.capturedAt);
  const prefix = `${tenantSnapshotPrefix('lite', cloudId)}/${year}/${month}/${day}/${pointer.runId}`;
  const manifest = await readJsonObject<CompletedManifest>(bucket, `${prefix}/manifest.json`);
  if (!manifest || manifest.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || manifest.state !== 'completed'
    || manifest.runId !== pointer.runId || manifest.capturedAt !== pointer.capturedAt
    || manifest.cloudId !== cloudId || manifest.productType !== 'lite'
    || !Array.isArray(manifest.spaceAggregateChunks)) return null;

  for (const ref of manifest.spaceAggregateChunks) {
    if (!ref || typeof ref.key !== 'string' || !ref.key.startsWith(`${prefix}/`)
      || !/^spaces-[0-9]{6}\.json$/.test(ref.key.slice(prefix.length + 1))
      || !Number.isSafeInteger(ref.rowCount) || ref.rowCount < 0
      || typeof ref.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(ref.sha256)) return null;
    const object = await bucket.get(ref.key);
    if (!object) return null;
    const serialized = await object.text();
    if (await sha256Hex(serialized) !== ref.sha256) return null;
    const chunk = JSON.parse(serialized) as AggregateChunk;
    if (!chunk || chunk.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || chunk.runId !== pointer.runId
      || !Array.isArray(chunk.rows) || chunk.rows.length !== ref.rowCount) return null;
    for (const row of chunk.rows) {
      if (!row || typeof row.spaceKey !== 'string' || !row.metrics
        || !Number.isSafeInteger(row.metrics.total) || row.metrics.total < 0) return null;
      if (row.spaceKey === spaceKey) return row.metrics.total;
    }
  }
  return null;
}

/** Every value that grants eligibility comes from server-side D1/KV/R2 bindings. */
export async function recoveryEligibility(
  env: RecoveryEnv,
  identity: RecoveryIdentity,
  spaceKey: string | undefined,
  policy: RecoveryPolicy,
  now = new Date(),
): Promise<RecoveryEligibility> {
  if (!spaceKey || !RECOVERY_SPACE_KEY.test(spaceKey)
    || !env.DB || !env.MACRO_COUNT_SNAPSHOT_BUCKET || !env.KV_FEATURE_FLAGS || !env.SPACE_LICENSE_KV) {
    return 'unavailable';
  }
  try {
    const appAri = `ari:cloud:ecosystem::app/${identity.forgeAppId}`;
    const rawDomain = await getAtlassianInstanceClientDomain(env.DB, identity.cloudId)
      || await getForgeInstallationClientDomain(env.DB, appAri, identity.cloudId)
      || await getForgeInstallationClientDomain(env.DB, identity.forgeAppId, identity.cloudId);
    const domain = rawDomain ? normalizeClientDomain(rawDomain) : '';
    if (!domain || !/^[a-z0-9][a-z0-9-]{0,126}$/.test(domain)) return 'unavailable';

    const count = await trustedSpaceCount(env.MACRO_COUNT_SNAPSHOT_BUCKET, identity.cloudId, spaceKey, now);
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
