import { getAuthorizationHeader } from '../utils/requestUtils';
import { validateContextToken } from '../utils/authenticate';
import { captureError } from '../utils/sentry';
import type { SpaceLicenseRecord } from './space-license';
import { json } from '../OkResponse';
import {
  checkPaidRail,
  paidLicense,
  readPaywallExemptionsMap,
  resolveTrustedClientDomain,
} from '../service/paywallPolicy';

interface Env {
  SPACE_LICENSE_KV: KVNamespace;
  KV_FEATURE_FLAGS?: KVNamespace;
  ALLOWED_FORGE_APP_IDS?: string;
  // Optional: the project-wide "DB" D1 binding (conf-zenuml-prod). Optional
  // because some environments (tests, older wrangler configs) don't bind it —
  // the paid-rail check below must degrade to the existing not-paid path
  // rather than fail the request when it's absent.
  DB?: D1Database;
}

export interface SpaceStatusResponse {
  isPaid: boolean;
  decisionKnown: boolean;
  source?: 'user_license' | 'space_license' | 'paid_rail';
  paywallExempt?: boolean;
}

// Forge invokeRemote requires valid JSON + application/json for every status
// (incl. errors); json() supplies the Content-Type.
const NO_STORE = { 'Cache-Control': 'no-store' };
// 'private': the response varies by the caller's accountId (user-scoped
// license), not just cloudId+spaceKey - a shared/CDN cache must not reuse
// one user's response for another user on the same space.
const PRIVATE_CACHE_5MIN = { 'Cache-Control': 'private, max-age=300' };

/**
 * Resolve the tenant-level paywall exemption verdict for an authenticated
 * `cloudId`. Never trusts a client-supplied `?client=` parameter: the domain is
 * resolved server-side from D1 (`AtlassianInstance` / `ForgeInstallation`).
 * Returns `undefined` when `KV_FEATURE_FLAGS`, `DB`, the domain mapping, or the
 * `PAYWALL_EXEMPTIONS` map is unavailable/malformed so the frontend fails open.
 */
async function resolvePaywallExemptForCloudId(
  env: Env,
  cloudId: string,
  forgeAppId?: string,
): Promise<boolean | undefined> {
  if (!env.KV_FEATURE_FLAGS || !env.DB) return undefined;
  const exemptions = await readPaywallExemptionsMap(env.KV_FEATURE_FLAGS);
  if (!exemptions) return undefined;
  const clientDomain = await resolveTrustedClientDomain(env.DB, cloudId, forgeAppId);
  if (!clientDomain) return undefined;
  return exemptions['*'] === true || exemptions[clientDomain] === true;
}

function withPaywallExempt(
  body: SpaceStatusResponse,
  paywallExempt: boolean | undefined,
): SpaceStatusResponse {
  return typeof paywallExempt === 'boolean' ? { ...body, paywallExempt } : body;
}

/**
 * The shared tail for both "no active license" exits: a missing space-level
 * KV record, and a record that's present but inactive/expired. Both must
 * check the D1 paid-rail fallback before finally reporting not-paid — the
 * user- and space-license checks above this still win when they hit.
 */
async function notPaidOrPaidRail(
  env: Env,
  cloudId: string,
  paywallExempt: boolean | undefined,
): Promise<Response> {
  const paidRail = await checkPaidRail(env.DB, cloudId);
  if (paidRail) {
    return json(withPaywallExempt(paidRail, paywallExempt), {
      status: 200,
      headers: PRIVATE_CACHE_5MIN,
    });
  }
  const decisionKnown = paidRail === null;
  return json(withPaywallExempt({ isPaid: false, decisionKnown }, paywallExempt), {
    status: 200,
    headers: decisionKnown ? PRIVATE_CACHE_5MIN : NO_STORE,
  });
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return json({
      isPaid: false,
      decisionKnown: false,
      error: 'method_not_allowed',
      message: 'Method Not Allowed',
    }, { status: 405, headers: NO_STORE });
  }

  try {
    const jwt = getAuthorizationHeader(request);

    if (!jwt) {
      return json({
        isPaid: false,
        decisionKnown: false,
        error: 'unauthorized',
        message: 'Missing or invalid Authorization header',
      }, { status: 401, headers: NO_STORE });
    }

    const allowedForgeAppIds = env.ALLOWED_FORGE_APP_IDS;
    if (!allowedForgeAppIds) {
      console.error('ALLOWED_FORGE_APP_IDS environment variable is not set');
      return json({
        isPaid: false,
        decisionKnown: false,
        error: 'server_configuration',
        message: 'ALLOWED_FORGE_APP_IDS not configured',
      }, { status: 500, headers: NO_STORE });
    }

    const url = new URL(request.url);
    const payload = await validateContextToken(jwt, allowedForgeAppIds);
    // `context.cloudId` is typed `unknown` on the FIT payload, so the raw
    // expression is `string | {}` — fine while it only fed template literals,
    // but the D1 paid-rail check below binds it as a parameter. Narrow to a
    // real string; a non-string value now reads as absent (falsy), which the
    // guard below already treats as "no decision to make".
    const rawCloudId = payload.cloudId || payload.payload.context?.cloudId;
    const cloudId = typeof rawCloudId === 'string' ? rawCloudId : undefined;
    const rawForgeAppId = (payload as { forgeAppId?: unknown; forgeAppAri?: unknown }).forgeAppId
      || (payload as { forgeAppAri?: unknown }).forgeAppAri
      || (payload.payload?.app as { id?: unknown } | undefined)?.id;
    const forgeAppId = typeof rawForgeAppId === 'string' ? rawForgeAppId : undefined;
    // Derived from the Forge-validated token, never a client query param — a
    // query param would let any user claim another user's accountId.
    const accountId = payload?.payload?.principal;
    const spaceKey = url.searchParams.get('spaceKey') || undefined;

    if (!cloudId || !spaceKey) {
      console.log('space-status: missing cloudId or spaceKey', { cloudId, spaceKey });
      return json({ isPaid: false, decisionKnown: false }, { status: 200, headers: NO_STORE });
    }

    if (!env.SPACE_LICENSE_KV) {
      console.error('SPACE_LICENSE_KV binding not configured');
      return json({ isPaid: false, decisionKnown: false }, { status: 200, headers: NO_STORE });
    }

    const paywallExempt = await resolvePaywallExemptForCloudId(env, cloudId, forgeAppId);

    // User-scoped extension (checked first): only when the token carries a
    // real accountId — never build/match a key on a missing one.
    if (accountId) {
      const userLicenseRaw = await env.SPACE_LICENSE_KV.get(`license:${cloudId}:${spaceKey}:${accountId}`);
      if (userLicenseRaw) {
        const userVerdict = paidLicense(userLicenseRaw);
        if (userVerdict === 'unknown') {
          throw new Error('Malformed user space license record');
        }
        if (userVerdict) {
          const decisionKnown = (await checkPaidRail(env.DB, cloudId)) !== undefined;
          return json(
            withPaywallExempt({ isPaid: true, decisionKnown, source: 'user_license' }, paywallExempt),
            { status: 200, headers: decisionKnown ? PRIVATE_CACHE_5MIN : NO_STORE },
          );
        }
      }
    }

    const licenseRaw = await env.SPACE_LICENSE_KV.get(`license:${cloudId}:${spaceKey}`);

    if (!licenseRaw) {
      console.log('space-status: no license found for', `license:${cloudId}:${spaceKey}`);
      return await notPaidOrPaidRail(env, cloudId, paywallExempt);
    }

    const record = JSON.parse(licenseRaw) as SpaceLicenseRecord;
    const spaceVerdict = paidLicense(licenseRaw);
    if (spaceVerdict === 'unknown') {
      throw new Error('Malformed space license record');
    }
    const isPaid = spaceVerdict;
    const isActive = record.status === 'active';
    const isExpired = !isPaid && isActive;

    console.log('space-status: license check', {
      key: `license:${cloudId}:${spaceKey}`,
      status: record.status,
      expiresAt: record.expiresAt,
      isActive,
      isExpired,
      isPaid,
    });

    if (isPaid) {
      const decisionKnown = (await checkPaidRail(env.DB, cloudId)) !== undefined;
      return json(
        withPaywallExempt({ isPaid: true, decisionKnown, source: 'space_license' }, paywallExempt),
        { status: 200, headers: decisionKnown ? PRIVATE_CACHE_5MIN : NO_STORE },
      );
    }

    return await notPaidOrPaidRail(env, cloudId, paywallExempt);
  } catch (error) {
    console.error('Error checking space status:', error);
    captureError(error);
    return json({
      isPaid: false,
      decisionKnown: false,
      error: 'internal_error',
      message: 'Internal Server Error',
    }, { status: 500, headers: NO_STORE });
  }
};
