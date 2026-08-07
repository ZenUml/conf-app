import { getAuthorizationHeader } from '../utils/requestUtils';
import { validateContextToken } from '../utils/authenticate';
import { captureError } from '../utils/sentry';
import type { SpaceLicenseRecord } from './space-license';

interface Env {
  SPACE_LICENSE_KV: KVNamespace;
  ALLOWED_FORGE_APP_IDS?: string;
  // Optional: the project-wide "DB" D1 binding (conf-zenuml-prod). Optional
  // because some environments (tests, older wrangler configs) don't bind it —
  // the paid-rail check below must degrade to the existing not-paid path
  // rather than fail the request when it's absent.
  DB?: D1Database;
}

interface SpaceStatusResponse {
  isPaid: boolean;
  source?: 'user_license' | 'space_license' | 'paid_rail';
}

// Full and Diagramly Forge app identifiers (our own app IDs, not tenant
// data — see .claude/skills/forge-installs/SKILL.md).
const FULL_APP_ID = 'd9e4002b-120b-426b-834b-402a4a5adce7';
const DIAGRAMLY_APP_ID = '01ede8b1-4e88-451a-b9ef-89eeef93afaf';

// Atlassian's Forge trial is 30 days; +15 days buffer for install-to-decision
// lag. Long-term paid Full/Diagramly tenants are handled by explicit
// PAYWALL_EXEMPTIONS entries (see the paywall skill), NOT by this query —
// this suppression is deliberately time-boxed so it can never substitute for
// a real license check on an old install.
//
// Caveat (verified against Atlassian's own docs, not assumed): ForgeInstallation.createdAt
// (functions/utils/dbUtils.ts upsertForgeInstallation) is overwritten to "now" on EVERY
// upsert, including avi:forge:upgraded:app — but per
// https://developer.atlassian.com/platform/forge/events-reference/life-cycle/ that event
// "is not sent for minor or patch version upgrades", only major ones (scope/licensing/consent
// changes — see this repo's own "Forge app versions" doc). Majors are rare, so createdAt is a
// reasonable install-date proxy for most tenants; a tenant whose install had a recent MAJOR
// version bump (not a routine release) will also read as "recent" here — an occasional,
// fail-safe (over-suppressing, not under-suppressing) false positive, not a systemic one.
const PAID_RAIL_TRIAL_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;

/**
 * Paid-rail suppression (owner directive 2026-08-07): a cloudId with a
 * RECENT Full or Diagramly Forge install is very likely mid-trial on one of
 * those products and evaluating whether to buy — don't paywall their Lite
 * usage on the same tenant while that evaluation is in flight. This is our
 * own D1 (ForgeInstallation), not the Atlassian Marketplace API.
 *
 * Returns the paid-rail response when a qualifying install is found, `null`
 * on a miss OR any error (never throws into the caller — a D1 outage must
 * fall through to the existing not-paid path, not fail the request).
 */
async function checkPaidRail(db: D1Database | undefined, cloudId: string): Promise<SpaceStatusResponse | null> {
  if (!db) return null;
  try {
    const cutoff = new Date(Date.now() - PAID_RAIL_TRIAL_WINDOW_MS).toISOString();
    const row = await db
      .prepare(
        `SELECT 1 FROM ForgeInstallation WHERE cloudId = ?1 AND appId IN ('${FULL_APP_ID}','${DIAGRAMLY_APP_ID}') AND createdAt >= ?2 LIMIT 1`
      )
      .bind(cloudId, cutoff)
      .first();
    if (row) {
      return { isPaid: true, source: 'paid_rail' };
    }
    return null;
  } catch (error) {
    console.error('space-status: paid_rail D1 check failed', error);
    return null;
  }
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
    // 'private': the response varies by the caller's accountId (user-scoped
    // license), not just cloudId+spaceKey — a shared/CDN cache must not reuse
    // one user's response for another user on the same space.
    headers['Cache-Control'] = 'private, max-age=300';
  } else {
    headers['Cache-Control'] = 'no-store';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * The shared tail for both "no active license" exits: a missing space-level
 * KV record, and a record that's present but inactive/expired. Both must
 * check the D1 paid-rail fallback before finally reporting not-paid — the
 * user- and space-license checks above this still win when they hit.
 */
async function notPaidOrPaidRail(env: Env, cloudId: string): Promise<Response> {
  const paidRail = await checkPaidRail(env.DB, cloudId);
  if (paidRail) {
    return jsonResponse(200, paidRail, 'short');
  }
  return jsonResponse(200, { isPaid: false }, 'short');
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
    const cloudId = payload.cloudId || payload.payload.context?.cloudId;
    // Derived from the Forge-validated token, never a client query param — a
    // query param would let any user claim another user's accountId.
    const accountId = payload?.payload?.principal;
    const spaceKey = url.searchParams.get('spaceKey') || undefined;

    if (!cloudId || !spaceKey) {
      console.log('space-status: missing cloudId or spaceKey', { cloudId, spaceKey });
      return jsonResponse(200, { isPaid: false }, 'short');
    }

    if (!env.SPACE_LICENSE_KV) {
      console.error('SPACE_LICENSE_KV binding not configured');
      return jsonResponse(200, { isPaid: false }, 'short');
    }

    // User-scoped extension (checked first): only when the token carries a
    // real accountId — never build/match a key on a missing one.
    if (accountId) {
      const userLicenseRaw = await env.SPACE_LICENSE_KV.get(`license:${cloudId}:${spaceKey}:${accountId}`);
      if (userLicenseRaw) {
        const userRecord = JSON.parse(userLicenseRaw) as SpaceLicenseRecord;
        const userIsActive = userRecord.status === 'active';
        const userIsExpired = new Date(userRecord.expiresAt) < new Date();
        if (userIsActive && !userIsExpired) {
          return jsonResponse(200, { isPaid: true, source: 'user_license' }, 'short');
        }
      }
    }

    const licenseRaw = await env.SPACE_LICENSE_KV.get(`license:${cloudId}:${spaceKey}`);

    if (!licenseRaw) {
      console.log('space-status: no license found for', `license:${cloudId}:${spaceKey}`);
      return await notPaidOrPaidRail(env, cloudId);
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
        { isPaid: true, source: 'space_license' },
        'short'
      );
    }

    return await notPaidOrPaidRail(env, cloudId);
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
