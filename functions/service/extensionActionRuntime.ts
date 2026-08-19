import type { SpaceLicenseRecord } from '../api/space-license';
import {
  ExtensionActionError,
  type ExtensionAction,
  type ExtensionActionRecord,
  type ExtensionActionRuntime,
  type ExtensionActionStore,
  type LicenseGrant,
} from './extensionActionService';

export interface ExtensionActionEnv {
  DB: D1Database;
  SPACE_LICENSE_KV: KVNamespace;
  confluence_plugin_features: KVNamespace;
}

interface SpaceMetrics {
  total?: number;
  lastUpdated?: string;
}

interface DomainMetrics {
  spaces?: Record<string, SpaceMetrics>;
}

function rowToRecord(row: Record<string, unknown> | null): ExtensionActionRecord | null {
  if (!row) return null;
  return {
    ticketKey: String(row.ticketKey),
    action: String(row.action) as ExtensionAction,
    status: String(row.status) as ExtensionActionRecord['status'],
    clientDomain: String(row.clientDomain),
    cloudId: String(row.cloudId),
    spaceKey: String(row.spaceKey),
    userAccountId: String(row.userAccountId),
    macroCount: Number(row.macroCount),
    expiresAt: String(row.expiresAt),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

export function createD1ExtensionActionStore(db: D1Database): ExtensionActionStore {
  return {
    async get(ticketKey, action) {
      const row = await db.prepare(
        `SELECT ticketKey, action, status, clientDomain, cloudId, spaceKey,
                userAccountId, macroCount, expiresAt, createdAt, updatedAt
           FROM ExtensionAction
          WHERE ticketKey = ?1 AND action = ?2`,
      ).bind(ticketKey, action).first<Record<string, unknown>>();
      return rowToRecord(row);
    },

    async acquire(record, previousUpdatedAt) {
      if (previousUpdatedAt !== undefined) {
        const result = await db.prepare(
          `UPDATE ExtensionAction
              SET updatedAt = ?3
            WHERE ticketKey = ?1 AND action = ?2
              AND status = 'pending' AND updatedAt = ?4`,
        ).bind(record.ticketKey, record.action, record.updatedAt, previousUpdatedAt).run();
        return (result.meta.changes ?? 0) === 1;
      }
      const result = await db.prepare(
        `INSERT OR IGNORE INTO ExtensionAction
          (ticketKey, action, status, clientDomain, cloudId, spaceKey,
           userAccountId, macroCount, expiresAt, createdAt, updatedAt)
         VALUES (?1, ?2, 'pending', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      ).bind(
        record.ticketKey,
        record.action,
        record.clientDomain,
        record.cloudId,
        record.spaceKey,
        record.userAccountId,
        record.macroCount,
        record.expiresAt,
        record.createdAt,
        record.updatedAt,
      ).run();
      return (result.meta.changes ?? 0) > 0;
    },

    async markApplied(ticketKey, action, updatedAt) {
      const result = await db.prepare(
        `UPDATE ExtensionAction
            SET status = 'applied', updatedAt = ?3
          WHERE ticketKey = ?1 AND action = ?2`,
      ).bind(ticketKey, action, updatedAt).run();
      if ((result.meta.changes ?? 0) !== 1) {
        throw new ExtensionActionError(503, 'action_audit_update_failed', 'idempotency', true);
      }
    },
  };
}

async function resolveTenant(clientDomain: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`https://${clientDomain}/_edge/tenant_info`, {
      headers: { Accept: 'application/json', 'User-Agent': 'ZenUML-Support-Automation/1.0' },
    });
  } catch {
    throw new ExtensionActionError(503, 'tenant_resolution_unavailable', 'tenant_resolution', true);
  }
  if (!response.ok) {
    throw new ExtensionActionError(409, 'tenant_not_found', 'tenant_resolution');
  }
  let body: { cloudId?: unknown };
  try {
    body = await response.json() as { cloudId?: unknown };
  } catch {
    throw new ExtensionActionError(503, 'tenant_response_invalid', 'tenant_resolution', true);
  }
  if (typeof body.cloudId !== 'string' || !body.cloudId) {
    throw new ExtensionActionError(409, 'tenant_cloud_id_missing', 'tenant_resolution');
  }
  return body.cloudId;
}

async function findSpace(
  metricsKv: KVNamespace,
  clientDomain: string,
  spaceKey: string,
): Promise<{ macroCount: number; lastUpdated?: string } | null> {
  const bareDomain = clientDomain.slice(0, -'.atlassian.net'.length);
  for (const product of ['lite', 'full'] as const) {
    let data: DomainMetrics | null;
    try {
      data = await metricsKv.get(`metrics:${bareDomain}:${product}`, 'json') as DomainMetrics | null;
    } catch {
      throw new ExtensionActionError(503, 'space_metrics_unavailable', 'space_validation', true);
    }
    const space = data?.spaces?.[spaceKey];
    if (space && typeof space.total === 'number' && Number.isFinite(space.total)) {
      return { macroCount: space.total, lastUpdated: space.lastUpdated };
    }
  }
  return null;
}

async function hasRecentPaidRail(db: D1Database, cloudId: string, now: Date): Promise<boolean> {
  const cutoff = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const row = await db.prepare(
      `SELECT 1 FROM ForgeInstallation
        WHERE cloudId = ?1
          AND appId IN ('d9e4002b-120b-426b-834b-402a4a5adce7',
                        '01ede8b1-4e88-451a-b9ef-89eeef93afaf')
          AND createdAt >= ?2
        LIMIT 1`,
    ).bind(cloudId, cutoff).first();
    return Boolean(row);
  } catch {
    throw new ExtensionActionError(503, 'paid_status_unavailable', 'paid_status', true);
  }
}

async function hasActiveSpaceLicense(
  kv: KVNamespace,
  cloudId: string,
  spaceKey: string,
  now: Date,
): Promise<boolean> {
  try {
    const raw = await kv.get(`license:${cloudId}:${spaceKey}`);
    if (!raw) return false;
    const record = JSON.parse(raw) as Partial<SpaceLicenseRecord>;
    const expiry = typeof record.expiresAt === 'string' ? new Date(record.expiresAt).getTime() : Number.NaN;
    if (!Number.isFinite(expiry)) {
      throw new ExtensionActionError(503, 'space_license_invalid', 'paid_status', true);
    }
    return record.status === 'active' && expiry > now.getTime();
  } catch (error) {
    if (error instanceof ExtensionActionError) throw error;
    throw new ExtensionActionError(503, 'space_license_unavailable', 'paid_status', true);
  }
}

async function updateLicenseIndex(kv: KVNamespace, grant: LicenseGrant): Promise<void> {
  try {
    const raw = await kv.get('license-index');
    const parsed = raw ? JSON.parse(raw) : [];
    const index: Array<{ cloudId: string; spaceKey: string; userAccountId?: string }> = Array.isArray(parsed)
      ? parsed
      : [];
    const exists = index.some((entry) =>
      entry.cloudId === grant.cloudId
      && entry.spaceKey === grant.spaceKey
      && entry.userAccountId === grant.userAccountId);
    if (!exists) {
      index.push({
        cloudId: grant.cloudId,
        spaceKey: grant.spaceKey,
        userAccountId: grant.userAccountId,
      });
      await kv.put('license-index', JSON.stringify(index));
    }
  } catch (error) {
    console.warn('[extension-action] license-index update failed', {
      reason: error instanceof Error ? error.name : 'unknown_error',
    });
  }
}

async function applyLicense(kv: KVNamespace, grant: LicenseGrant, now: Date): Promise<void> {
  const key = `license:${grant.cloudId}:${grant.spaceKey}:${grant.userAccountId}`;
  let existing: SpaceLicenseRecord | null = null;
  try {
    const raw = await kv.get(key);
    existing = raw ? JSON.parse(raw) as SpaceLicenseRecord : null;
    const nowIso = now.toISOString();
    const record: SpaceLicenseRecord = {
      ...(existing ?? {} as SpaceLicenseRecord),
      cloudId: grant.cloudId,
      spaceKey: grant.spaceKey,
      userAccountId: grant.userAccountId,
      status: 'active',
      activatedBy: grant.activatedBy,
      expiresAt: grant.expiresAt,
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };
    await kv.put(key, JSON.stringify(record));
  } catch {
    throw new ExtensionActionError(503, 'license_write_failed', 'license_write', true);
  }

  let verified: SpaceLicenseRecord;
  try {
    const raw = await kv.get(key);
    if (!raw) throw new Error('missing');
    verified = JSON.parse(raw) as SpaceLicenseRecord;
  } catch {
    throw new ExtensionActionError(503, 'license_readback_failed', 'license_verify', true);
  }
  if (
    verified.status !== 'active'
    || verified.cloudId !== grant.cloudId
    || verified.spaceKey !== grant.spaceKey
    || verified.userAccountId !== grant.userAccountId
    || verified.expiresAt !== grant.expiresAt
  ) {
    throw new ExtensionActionError(503, 'license_readback_mismatch', 'license_verify', true);
  }
  await updateLicenseIndex(kv, grant);
}

export function createExtensionActionRuntime(
  env: ExtensionActionEnv,
  now: () => Date = () => new Date(),
): ExtensionActionRuntime {
  return {
    now,
    actions: createD1ExtensionActionStore(env.DB),
    resolveTenant,
    findSpace: (clientDomain, spaceKey) =>
      findSpace(env.confluence_plugin_features, clientDomain, spaceKey),
    hasRecentPaidRail: (cloudId) => hasRecentPaidRail(env.DB, cloudId, now()),
    hasActiveSpaceLicense: (cloudId, spaceKey) =>
      hasActiveSpaceLicense(env.SPACE_LICENSE_KV, cloudId, spaceKey, now()),
    applyLicense: (grant) => applyLicense(env.SPACE_LICENSE_KV, grant, now()),
  };
}
