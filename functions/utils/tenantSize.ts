import { D1Database } from "@cloudflare/workers-types";

export type TenantSizeEstimate = 'unknown' | 'small_likely' | 'medium_or_larger';

const VALID: ReadonlySet<TenantSizeEstimate> = new Set(['unknown', 'small_likely', 'medium_or_larger']);

const MIN_DAYS_FOR_CONFIDENCE = 30;
const MIN_VIEWERS_FOR_SIGNAL = 3;
const SMALL_LIKELY_MAX_VIEWERS = 8;
const CACHE_TTL_SECONDS = 24 * 60 * 60;

export interface TenantSizeInput {
  installAgeDays: number;
  uniqueViewerCount30d: number;
}

export interface TenantSizeEnv {
  DB?: D1Database;
}

export function computeTenantSizeEstimate(input: TenantSizeInput): TenantSizeEstimate {
  if (input.installAgeDays < MIN_DAYS_FOR_CONFIDENCE) return 'unknown';
  if (input.uniqueViewerCount30d < MIN_VIEWERS_FOR_SIGNAL) return 'unknown';
  if (input.uniqueViewerCount30d <= SMALL_LIKELY_MAX_VIEWERS) return 'small_likely';
  return 'medium_or_larger';
}

function key(cloudId: string): string {
  return `tenant_size:${cloudId}`;
}

export async function getCachedTenantSize(
  kv: KVNamespace,
  cloudId: string
): Promise<TenantSizeEstimate | null> {
  const raw = await kv.get(key(cloudId));
  if (!raw) return null;
  return VALID.has(raw as TenantSizeEstimate) ? (raw as TenantSizeEstimate) : null;
}

export async function setCachedTenantSize(
  kv: KVNamespace,
  cloudId: string,
  estimate: TenantSizeEstimate
): Promise<void> {
  await kv.put(key(cloudId), estimate, { expirationTtl: CACHE_TTL_SECONDS });
}

export async function loadTenantSizeInputs(
  env: TenantSizeEnv,
  cloudId: string
): Promise<TenantSizeInput> {
  if (!env.DB) {
    return { installAgeDays: 0, uniqueViewerCount30d: 0 };
  }

  // Install age — try ForgeInstallation first, fall back to oldest event in UserBehaviorEvent.
  let installAgeDays = 0;
  try {
    let installedAtIso: string | null = null;
    try {
      const row = await env.DB
        .prepare(`SELECT installed_at FROM ForgeInstallation WHERE cloudId = ? ORDER BY installed_at ASC LIMIT 1`)
        .bind(cloudId)
        .first<{ installed_at: string }>();
      if (row?.installed_at) installedAtIso = row.installed_at;
    } catch {
      // column or table shape may differ; fall through to proxy
    }
    if (!installedAtIso) {
      const row = await env.DB
        .prepare(`SELECT MIN(createdAt) AS oldest FROM UserBehaviorEvent WHERE cloudId = ?`)
        .bind(cloudId)
        .first<{ oldest: string | null }>();
      if (row?.oldest) installedAtIso = row.oldest;
    }
    if (installedAtIso) {
      const installed = new Date(installedAtIso).getTime();
      installAgeDays = Math.max(0, Math.floor((Date.now() - installed) / 86_400_000));
    }
  } catch (err) {
    console.warn('loadTenantSizeInputs: install age lookup failed', err);
  }

  // Unique view_macro users over last 30d.
  let uniqueViewerCount30d = 0;
  try {
    const row = await env.DB
      .prepare(
        `SELECT COUNT(DISTINCT userAccountId) AS n
           FROM UserBehaviorEvent
          WHERE cloudId = ?
            AND action = 'view_macro'
            AND createdAt >= datetime('now', '-30 days')`
      )
      .bind(cloudId)
      .first<{ n: number }>();
    uniqueViewerCount30d = row?.n ?? 0;
  } catch (err) {
    console.warn('loadTenantSizeInputs: viewer count lookup failed', err);
  }

  return { installAgeDays, uniqueViewerCount30d };
}
