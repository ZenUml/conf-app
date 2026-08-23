import { OkResponse, response } from '../OkResponse';
import type { ForgeRequestData } from '../utils/authenticate';
import { captureError } from '../utils/sentry';
import {
  createOrReplayPaywallExtension,
  parsePaywallExtensionInput,
  PaywallExtensionValidationError,
} from '../service/paywallExtensionService';
import {
  getAtlassianInstanceClientDomain,
  getForgeInstallationClientDomain,
} from '../utils/dbUtils';
import {
  metricsKvKey,
  normalizeClientDomain,
  type DomainMetrics,
} from '../metrics-cache/snapshot/common';
import {
  resolveMarketplaceAdminRoute,
  type MarketplaceAdminRoute,
} from '../service/marketplaceContactResolution';

interface Env {
  DB: D1Database;
  confluence_plugin_features: KVNamespace;
  MARKETPLACE_CONTACT_ENCRYPTION_KEY?: string;
}

const AUTHORITATIVE_COUNT_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const MANUAL_ROUTE_FALLBACK: MarketplaceAdminRoute = {
  routingOutcome: 'manual',
  reasonCodes: ['contact_resolution_failed'],
  overrideUsed: false,
  cacheAgeHours: null,
};

interface ConfluenceSpace {
  id?: unknown;
  key?: unknown;
}

async function resolveCurrentSpace(
  apiBaseUrl: string,
  userToken: string,
  spaceKey: string,
): Promise<{ id: string; key: string } | null> {
  const url = `${apiBaseUrl}/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}&limit=2`;
  const upstream = await fetch(url, {
    headers: {
      Authorization: `Bearer ${userToken}`,
      Accept: 'application/json',
    },
  });
  if (!upstream.ok) return null;
  const payload = await upstream.json() as { results?: unknown };
  const results = Array.isArray(payload.results) ? payload.results : [];
  const exact = results.find((candidate): candidate is ConfluenceSpace => (
    typeof candidate === 'object'
    && candidate !== null
    && (candidate as ConfluenceSpace).key === spaceKey
  ));
  return exact && typeof exact.id === 'string'
    ? { id: exact.id, key: spaceKey }
    : null;
}

async function authoritativeMacroCount(
  env: Env,
  cloudId: string,
  spaceKey: string,
  forgeAppId?: string,
  forgeAppAri?: string,
  now: Date = new Date(),
): Promise<number | null> {
  if (!env.confluence_plugin_features) return null;
  const storedDomain = await getAtlassianInstanceClientDomain(env.DB, cloudId)
    || await getForgeInstallationClientDomain(env.DB, forgeAppAri, cloudId)
    || await getForgeInstallationClientDomain(env.DB, forgeAppId, cloudId);
  const clientDomain = storedDomain ? normalizeClientDomain(storedDomain) : '';
  if (!clientDomain) return null;
  const metrics = await env.confluence_plugin_features.get(
    metricsKvKey({ clientDomain, productType: 'lite' }),
    'json',
  ) as DomainMetrics | null;
  const space = metrics?.spaces?.[spaceKey];
  if (!space || !Number.isInteger(space.total)) return null;
  const updatedAt = Date.parse(space.lastUpdated);
  const age = now.getTime() - updatedAt;
  if (!Number.isFinite(updatedAt) || age < 0 || age > AUTHORITATIVE_COUNT_MAX_AGE_MS) return null;
  return space.total;
}

export const onRequest: PagesFunction<Env, string, ForgeRequestData> = async ({
  request,
  env,
  data,
}) => {
  if (request.method !== 'POST') return response(405, 'Method not allowed');
  if (!env.DB) return response(500, 'D1 binding is not configured');

  const cloudId = data.forgeContext?.cloudId;
  const accountId = data.forgeContext?.accountId;
  const apiBaseUrl = data.forgeContext?.apiBaseUrl;
  const userToken = request.headers.get('x-forge-oauth-user');
  if (!cloudId || !accountId || !apiBaseUrl || !userToken) {
    return response(401, 'Authenticated Forge user context is required');
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return response(400, 'Invalid JSON body');
  }

  try {
    const input = parsePaywallExtensionInput(rawBody);
    const space = await resolveCurrentSpace(apiBaseUrl, userToken, input.spaceKey);
    if (!space) return response(400, 'spaceKey is not an accessible current-site Space');
    const serverMacroCount = await authoritativeMacroCount(
      env,
      cloudId,
      input.spaceKey,
      data.forgeContext?.forgeAppId,
      data.forgeContext?.forgeAppAri,
    );
    if (serverMacroCount == null) {
      return response(409, 'Authoritative paywall state is unavailable or stale; automatic extension was not granted');
    }
    if (serverMacroCount <= 100) {
      return response(409, 'This Space has not exceeded the 100 macro limit; automatic extension was not granted');
    }

    const result = await createOrReplayPaywallExtension(env.DB, {
      cloudId,
      accountId,
      spaceId: space.id,
      spaceKey: space.key,
    }, input);
    // Contact resolution is a D1-only best-effort lookup after the extension
    // authority has decided. Failure can change outreach routing, never the
    // eligible user's grant. The API returns metadata, not the contact.
    let adminContactRouting: MarketplaceAdminRoute;
    try {
      adminContactRouting = await resolveMarketplaceAdminRoute(
        env.DB,
        cloudId,
        env.MARKETPLACE_CONTACT_ENCRYPTION_KEY,
      );
    } catch {
      adminContactRouting = MANUAL_ROUTE_FALLBACK;
    }
    return OkResponse({ ...result, adminContactRouting });
  } catch (error) {
    if (error instanceof PaywallExtensionValidationError) {
      return response(400, error.message);
    }
    // Do not log the request body or authenticated identifiers. The exception
    // class/message is enough to diagnose operational failures.
    console.error('paywall-extension request failed', {
      reason: error instanceof Error ? error.message : 'unknown_error',
    });
    captureError(error);
    return response(500, 'Internal server error');
  }
};
