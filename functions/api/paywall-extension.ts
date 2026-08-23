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
  resolveMarketplaceAdminNotificationTarget,
  type MarketplaceAdminRoute,
} from '../service/marketplaceContactResolution';
import {
  createPaywallAdminNotification,
  dispatchPaywallAdminNotification,
  failPaywallAdminNotificationBeforeDispatch,
} from '../service/paywallAdminNotification';
import { createPaywallExtensionReminder } from '../service/paywallExtensionLifecycle';

interface Env {
  DB: D1Database;
  confluence_plugin_features: KVNamespace;
  MARKETPLACE_CONTACT_ENCRYPTION_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  RESEND_REPLY_TO?: string;
  PAYWALL_ENTERPRISE_BUNDLE_URL?: string;
}

const AUTHORITATIVE_COUNT_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const MANUAL_ROUTE_FALLBACK: MarketplaceAdminRoute = {
  routingOutcome: 'manual',
  reasonCodes: ['contact_resolution_failed'],
  overrideUsed: false,
  cacheAgeHours: null,
};

function hasCompleteResendRuntimeConfig(env: Env): boolean {
  if (![env.RESEND_API_KEY, env.RESEND_FROM, env.RESEND_REPLY_TO]
    .every((value) => typeof value === 'string' && value.trim())) return false;
  if (!env.RESEND_FROM?.includes('@') || !env.RESEND_REPLY_TO?.includes('@')) return false;
  try {
    return new URL(env.PAYWALL_ENTERPRISE_BUNDLE_URL ?? '').protocol === 'https:';
  } catch {
    return false;
  }
}

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
  waitUntil,
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
    let adminTarget: { route: MarketplaceAdminRoute; recipient: string | null };
    try {
      adminTarget = await resolveMarketplaceAdminNotificationTarget(
        env.DB,
        cloudId,
        env.MARKETPLACE_CONTACT_ENCRYPTION_KEY,
      );
    } catch {
      adminTarget = { route: MANUAL_ROUTE_FALLBACK, recipient: null };
    }

    if (result.status === 'granted') {
      const reminderWork = createPaywallExtensionReminder(env.DB, {
        grantId: result.grant.grantId,
        cloudId,
        accountId,
        spaceId: space.id,
        spaceKey: space.key,
        grantedAt: result.grant.grantedAt,
        expiresAt: result.grant.expiresAt,
      }).catch((error) => {
        // Reminder persistence is idempotent and operationally secondary. The
        // exact seven-day grant must remain successful if its reminder store
        // is temporarily unavailable.
        console.warn('paywall extension reminder scheduling failed', {
          reason: error instanceof Error ? error.name : 'unknown_error',
        });
      });
      const notificationWork = (async () => {
        const notification = await createPaywallAdminNotification(env.DB, {
          requestId: result.requestId,
          grantId: result.grant.grantId,
          cloudId,
          route: adminTarget.route,
        });
        if (adminTarget.route.routingOutcome !== 'automatic') return;
        if (!adminTarget.recipient) {
          await failPaywallAdminNotificationBeforeDispatch(env.DB, notification, 'contact_unavailable');
          return;
        }
        if (!hasCompleteResendRuntimeConfig(env)) {
          await failPaywallAdminNotificationBeforeDispatch(
            env.DB, notification, 'resend_configuration_missing',
          );
          return;
        }
        await dispatchPaywallAdminNotification(env.DB, notification, {
          apiKey: env.RESEND_API_KEY as string,
          from: env.RESEND_FROM as string,
          replyTo: env.RESEND_REPLY_TO as string,
          recipient: adminTarget.recipient,
          content: {
            spaceKey: space.key,
            macroCount: serverMacroCount,
            requestedScope: input.answers.unblockNeed.scope,
            urgency: input.answers.unblockNeed.urgency,
            grantedAt: result.grant.grantedAt,
            expiresAt: result.grant.expiresAt,
            upgradeUrl: env.PAYWALL_ENTERPRISE_BUNDLE_URL as string,
          },
        });
      })().catch((error) => {
        // The grant is already authoritative. Do not propagate notification
        // failures or log tenant/contact/provider values.
        console.warn('paywall administrator notification preparation failed', {
          reason: error instanceof Error ? error.name : 'unknown_error',
        });
      });
      const backgroundWork = Promise.all([reminderWork, notificationWork]).then(() => undefined);
      if (typeof waitUntil === 'function') waitUntil(backgroundWork);
      else await backgroundWork;
    }
    return OkResponse({ ...result, adminContactRouting: adminTarget.route });
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
