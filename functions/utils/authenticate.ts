import {OkResponse, response} from "../OkResponse";
import {captureError} from "./sentry";
import { getAuthorizationHeader } from "./requestUtils";
import * as jose from 'jose';

const FORGE_FIT_ISSUER = 'forge/invocation-token';
const COMMERCIAL_FORGE_JWKS =
  'https://forge.cdn.prod.atlassian-dev.net/.well-known/jwks.json';
const APP_ARI_PREFIX = 'ari:cloud:ecosystem::app/';
const COMMERCIAL_JWKS = jose.createRemoteJWKSet(new URL(COMMERCIAL_FORGE_JWKS));

type ForgeInstallationContext = {
  name?: unknown;
  apiBaseUrl?: unknown;
  cloudId?: unknown;
};

type ForgeFitApp = {
  id?: unknown;
  apiBaseUrl?: unknown;
  installationId?: unknown;
  installation?: {
    id?: unknown;
    contexts?: unknown;
  };
  environment?: {
    type?: unknown;
    id?: unknown;
  };
};

type ForgeFitContext = {
  cloudId?: unknown;
  siteUrl?: unknown;
};

type ForgeFitPayload = jose.JWTPayload & {
  app: ForgeFitApp;
  context?: ForgeFitContext;
  principal?: unknown;
  icLabel?: unknown;
};

export type VerifiedForgeFit = jose.JWTVerifyResult<ForgeFitPayload> & {
  apiBaseUrl: string;
  cloudId: string;
  environmentId?: string;
  environmentType?: string;
  forgeAppId: string;
  forgeAppAri: string;
  installationId: string;
};

function requiredString(value: unknown, claim: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`FIT is missing required claim: ${claim}`);
  }
  return value;
}

export function normalizeAllowedForgeAppAris(allowedAppIds: string): string[] {
  const aris = allowedAppIds
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => id.startsWith(APP_ARI_PREFIX) ? id : `${APP_ARI_PREFIX}${id}`);

  if (aris.length === 0) {
    throw new Error('No allowed Forge app IDs configured');
  }
  return [...new Set(aris)];
}

function confluenceInstallationContexts(app: ForgeFitApp): ForgeInstallationContext[] {
  const contexts = app.installation?.contexts;
  if (!Array.isArray(contexts)) return [];
  return contexts.filter((context): context is ForgeInstallationContext => (
    typeof context === 'object'
    && context !== null
    && (context as ForgeInstallationContext).name === 'confluence'
  ));
}

function cloudIdFromApiBaseUrl(apiBaseUrl: string): string | undefined {
  try {
    const url = new URL(apiBaseUrl);
    const match = url.pathname.match(/\/ex\/confluence\/([^/]+)(?:\/|$)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function normalizeApiBaseUrl(value: string): string {
  const url = new URL(value);
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/**
 * Verify a Forge Invocation Token and return only normalized, authenticated
 * identity. Request body/query identity is deliberately not considered here.
 *
 * `verificationKey` is injectable so unit tests can use a local public key
 * without weakening the production JWKS path.
 */
export const validateContextToken = async (
  invocationToken: string,
  allowedAppIds: string,
  verificationKey: jose.JWTVerifyGetKey = COMMERCIAL_JWKS,
): Promise<VerifiedForgeFit> => {
  const allowedAppAris = normalizeAllowedForgeAppAris(allowedAppIds);

  try {
    const token = await jose.jwtVerify<ForgeFitPayload>(invocationToken, verificationKey, {
      issuer: FORGE_FIT_ISSUER,
      audience: allowedAppAris,
      requiredClaims: ['iss', 'aud', 'iat', 'nbf', 'exp'],
    });
    if (token.payload.icLabel != null) {
      throw new Error('Isolated Cloud FIT verification is not configured');
    }
    const app = token.payload.app as ForgeFitApp | undefined;
    if (!app || typeof app !== 'object') {
      throw new Error('FIT is missing required claim: app');
    }

    const forgeAppAri = requiredString(app.id, 'app.id');
    if (!allowedAppAris.includes(forgeAppAri)) {
      throw new Error('FIT app.id is not allowlisted');
    }

    const audiences = Array.isArray(token.payload.aud)
      ? token.payload.aud
      : [token.payload.aud];
    if (!audiences.includes(forgeAppAri)) {
      throw new Error('FIT app.id does not match aud');
    }

    const installationContexts = confluenceInstallationContexts(app);
    if (installationContexts.length === 0) {
      throw new Error('FIT is missing Confluence installation context');
    }
    const apiBaseUrl = requiredString(app.apiBaseUrl, 'app.apiBaseUrl');
    const apiCloudId = requiredString(cloudIdFromApiBaseUrl(apiBaseUrl), 'app.apiBaseUrl cloudId');
    for (const context of installationContexts) {
      const contextApiBaseUrl = requiredString(
        context.apiBaseUrl,
        'app.installation.contexts[].apiBaseUrl',
      );
      const contextCloudId = requiredString(
        context.cloudId,
        'app.installation.contexts[].cloudId',
      );
      if (
        normalizeApiBaseUrl(contextApiBaseUrl) !== normalizeApiBaseUrl(apiBaseUrl)
        || cloudIdFromApiBaseUrl(contextApiBaseUrl) !== contextCloudId
      ) {
        throw new Error('FIT Confluence installation context is inconsistent');
      }
      if (contextCloudId !== apiCloudId) {
        throw new Error('FIT Confluence cloud IDs do not match');
      }
    }
    if (token.payload.context?.cloudId != null) {
      const frontendCloudId = requiredString(token.payload.context.cloudId, 'context.cloudId');
      if (frontendCloudId !== apiCloudId) {
        throw new Error('FIT frontend context cloudId does not match installation');
      }
    }

    const legacyInstallationId = requiredString(app.installationId, 'app.installationId');
    const installationId = requiredString(app.installation?.id, 'app.installation.id');
    if (legacyInstallationId !== installationId) {
      throw new Error('FIT installation IDs do not match');
    }
    const environmentId = requiredString(app.environment?.id, 'app.environment.id');
    const environmentType = requiredString(app.environment?.type, 'app.environment.type');

    return {
      ...token,
      apiBaseUrl,
      cloudId: apiCloudId,
      environmentId,
      environmentType,
      forgeAppId: forgeAppAri.slice(APP_ARI_PREFIX.length),
      forgeAppAri,
      installationId,
    };
  } catch (error) {
    // Never decode or log the FIT. Even a verified payload can contain tenant
    // and user identifiers, and the bearer token itself is a credential.
    console.warn('Forge FIT verification failed', {
      reason: error instanceof Error ? error.name : 'unknown_error',
    });
    throw error;
  }
}

import { upsertAtlassianInstance } from './dbUtils';

export interface ForgeRequestContext {
  cloudId?: string;
  accountId?: string;
  apiBaseUrl?: string;
  forgeAppId?: string;
  forgeAppAri?: string;
  installationId?: string;
  environmentId?: string;
  environmentType?: string;
  invocationSource?: 'backend' | 'frontend';
}

export type ForgeRequestData = Record<string, unknown> & {
  forgeContext?: ForgeRequestContext;
};

async function authenticateForgeRequest(jwt: string, env: any): Promise<ForgeRequestContext> {
  const allowedForgeAppIds = env.ALLOWED_FORGE_APP_IDS;
  const payload = await validateContextToken(jwt, allowedForgeAppIds);

  // Populate AtlassianInstance from siteUrl when available in macro-render tokens
  const cloudId = payload.cloudId;

  const siteUrl = payload.payload?.context?.siteUrl;
  if (cloudId && typeof siteUrl === 'string' && siteUrl && env.DB) {
    try {
      const domain = new URL(siteUrl).hostname;
      if (domain) {
        upsertAtlassianInstance(env.DB, cloudId, domain).catch(e =>
          console.log('AtlassianInstance upsert failed:', e)
        );
      }
    } catch (e) {
      console.log('Could not parse siteUrl for AtlassianInstance upsert:', e);
    }
  }

  const principal = payload.payload?.principal;
  return {
    cloudId,
    accountId: typeof principal === 'string' ? principal : undefined,
    apiBaseUrl: payload.apiBaseUrl,
    forgeAppId: payload.forgeAppId,
    forgeAppAri: payload.forgeAppAri,
    installationId: payload.installationId,
    environmentId: payload.environmentId,
    environmentType: payload.environmentType,
    invocationSource: payload.payload.context == null ? 'backend' : 'frontend',
  };
}

export default async function authenticate({
  request,
  env,
  data,
}: {
  request: Request;
  env: any;
  data: ForgeRequestData;
}) {
  try {
    const jwt = getAuthorizationHeader(request);
    if (!jwt) {
      return response(401, 'Unauthorized: Missing or invalid Authorization header');
    }

    if (!env.ALLOWED_FORGE_APP_IDS) {
      console.error('ALLOWED_FORGE_APP_IDS environment variable is not set');
      return response(500, 'Server configuration error: ALLOWED_FORGE_APP_IDS not configured');
    }

    try {
      data.forgeContext = await authenticateForgeRequest(jwt, env);
      return OkResponse();
    } catch (e) {
      console.error('JWT validation failed:', e);
      captureError(e);
      return response(401, 'Unauthorized: JWT validation failed');
    }

  } catch (e) {
    console.error('Unexpected error authenticating Forge request:', e);
    captureError(e);
    return response(500, `Unexpected error: ${e}`);
  }
}
