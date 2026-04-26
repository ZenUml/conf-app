import { D1Database } from "@cloudflare/workers-types";
import { getAuthorizationHeader } from '../utils/requestUtils';
import { validateContextToken } from '../utils/authenticate';
import { captureError } from '../utils/sentry';
import {
  getCachedTenantSize,
  setCachedTenantSize,
  computeTenantSizeEstimate,
  loadTenantSizeInputs,
  TenantSizeEstimate,
} from '../utils/tenantSize';
import type { SpaceLicenseRecord } from './space-license';

interface Env {
  SPACE_LICENSE_KV: KVNamespace;
  MACRO_AUTHORSHIP_KV?: KVNamespace;
  DB?: D1Database;
  ALLOWED_FORGE_APP_IDS?: string;
  FORGE_CONTEXT?: any;
}

interface SpaceStatusResponse {
  isPaid: boolean;
  source?: 'space_license';
  personalAuthored?: number;
  tenantSizeEstimate?: TenantSizeEstimate;
  confluenceAdmin?: boolean;
}

/** Forge invokeRemote requires valid JSON + application/json for every status (incl. errors). */
function jsonResponse(
  status: number,
  body: SpaceStatusResponse & { error?: string; message?: string },
  cache: 'short' | 'none' = 'none'
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (cache === 'short') {
    headers['Cache-Control'] = 'max-age=300';
  } else {
    headers['Cache-Control'] = 'no-store';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function hashAccountId(accountId: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accountId));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getPersonalAuthored(
  db: D1Database | undefined,
  authorshipKv: KVNamespace | undefined,
  cloudId: string,
  spaceKey: string,
  accountId: string | undefined
): Promise<number> {
  if (!accountId) return 0;
  if (!db && !authorshipKv) return 0;
  let cacheKey: string | null = null;
  try {
    if (authorshipKv) {
      const hashed = await hashAccountId(accountId);
      cacheKey = `authored:${cloudId}:${spaceKey}:${hashed}`;
      const cached = await authorshipKv.get(cacheKey);
      if (cached !== null) {
        const n = parseInt(cached, 10);
        if (!Number.isNaN(n)) return n;
      }
    }
  } catch (err) {
    console.warn('space-status: personalAuthored cache lookup failed', err);
  }
  if (!db) return 0;
  try {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM UserBehaviorEvent
          WHERE cloudId = ? AND userAccountId = ? AND spaceKey = ?
            AND action IN ('create_macro_end', 'edit_macro_end')`
      )
      .bind(cloudId, accountId, spaceKey)
      .first<{ n: number }>();
    const count = row?.n ?? 0;
    if (cacheKey && authorshipKv) {
      try {
        await authorshipKv.put(cacheKey, String(count), { expirationTtl: 300 });
      } catch (err) {
        console.warn('space-status: personalAuthored cache write failed', err);
      }
    }
    return count;
  } catch (err) {
    console.warn('space-status: personalAuthored query failed', err);
    return 0;
  }
}

async function getTenantSizeEstimate(
  db: D1Database | undefined,
  authorshipKv: KVNamespace | undefined,
  cloudId: string
): Promise<TenantSizeEstimate> {
  if (!authorshipKv && !db) return 'unknown';
  try {
    if (authorshipKv) {
      const cached = await getCachedTenantSize(authorshipKv, cloudId);
      if (cached !== null) return cached;
    }
    if (!db) return 'unknown';
    const inputs = await loadTenantSizeInputs({ DB: db }, cloudId);
    const estimate = computeTenantSizeEstimate(inputs);
    if (authorshipKv) {
      try {
        await setCachedTenantSize(authorshipKv, cloudId, estimate);
      } catch (err) {
        console.warn('space-status: tenantSize cache write failed', err);
      }
    }
    return estimate;
  } catch (err) {
    console.warn('space-status: tenantSizeEstimate failed', err);
    return 'unknown';
  }
}

function extractConfluenceAdmin(payload: any): boolean {
  try {
    const ctx = payload?.payload?.context;
    return ctx?.confluence?.admin === true;
  } catch {
    return false;
  }
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return jsonResponse(405, {
      isPaid: false,
      error: 'method_not_allowed',
      message: 'Method Not Allowed',
    });
  }

  try {
    const jwt = getAuthorizationHeader(request);

    if (!jwt) {
      return jsonResponse(401, {
        isPaid: false,
        error: 'unauthorized',
        message: 'Missing or invalid Authorization header',
      });
    }

    const allowedForgeAppIds = env.ALLOWED_FORGE_APP_IDS;
    if (!allowedForgeAppIds) {
      console.error('ALLOWED_FORGE_APP_IDS environment variable is not set');
      return jsonResponse(500, {
        isPaid: false,
        error: 'server_configuration',
        message: 'ALLOWED_FORGE_APP_IDS not configured',
      });
    }

    const url = new URL(request.url);
    const payload = await validateContextToken(jwt, allowedForgeAppIds);
    const cloudId = payload?.payload?.context?.cloudId;
    const accountId = payload?.payload?.context?.accountId;
    const spaceKey = url.searchParams.get('spaceKey') || undefined;
    const confluenceAdmin = extractConfluenceAdmin(payload);

    if (!cloudId || !spaceKey) {
      console.log('space-status: missing cloudId or spaceKey', { cloudId, spaceKey });
      const [personalAuthored, tenantSizeEstimate] = await Promise.all([
        cloudId && spaceKey
          ? getPersonalAuthored(env.DB, env.MACRO_AUTHORSHIP_KV, cloudId, spaceKey, accountId)
          : Promise.resolve(0),
        cloudId
          ? getTenantSizeEstimate(env.DB, env.MACRO_AUTHORSHIP_KV, cloudId)
          : Promise.resolve<TenantSizeEstimate>('unknown'),
      ]);
      return jsonResponse(
        200,
        { isPaid: false, personalAuthored, tenantSizeEstimate, confluenceAdmin },
        'short'
      );
    }

    // Run license + extended fields in parallel.
    const [licenseRaw, personalAuthored, tenantSizeEstimate] = await Promise.all([
      env.SPACE_LICENSE_KV ? env.SPACE_LICENSE_KV.get(`license:${cloudId}:${spaceKey}`) : Promise.resolve(null),
      getPersonalAuthored(env.DB, env.MACRO_AUTHORSHIP_KV, cloudId, spaceKey, accountId),
      getTenantSizeEstimate(env.DB, env.MACRO_AUTHORSHIP_KV, cloudId),
    ]);

    if (!env.SPACE_LICENSE_KV) {
      console.error('SPACE_LICENSE_KV binding not configured');
      return jsonResponse(
        200,
        { isPaid: false, personalAuthored, tenantSizeEstimate, confluenceAdmin },
        'short'
      );
    }

    if (!licenseRaw) {
      console.log('space-status: no license found for', `license:${cloudId}:${spaceKey}`);
      return jsonResponse(
        200,
        { isPaid: false, personalAuthored, tenantSizeEstimate, confluenceAdmin },
        'short'
      );
    }

    const record = JSON.parse(licenseRaw) as SpaceLicenseRecord;

    const isActive = record.status === 'active';
    const isExpired = new Date(record.expiresAt) < new Date();
    const isPaid = isActive && !isExpired;

    console.log('space-status: license check', {
      key: `license:${cloudId}:${spaceKey}`,
      status: record.status,
      expiresAt: record.expiresAt,
      isActive,
      isExpired,
      isPaid,
    });

    if (isPaid) {
      return jsonResponse(
        200,
        {
          isPaid: true,
          source: 'space_license',
          personalAuthored,
          tenantSizeEstimate,
          confluenceAdmin,
        },
        'short'
      );
    }

    return jsonResponse(
      200,
      { isPaid: false, personalAuthored, tenantSizeEstimate, confluenceAdmin },
      'short'
    );
  } catch (error) {
    console.error('Error checking space status:', error);
    captureError(error);
    return jsonResponse(500, {
      isPaid: false,
      error: 'internal_error',
      message: 'Internal Server Error',
    });
  }
};
