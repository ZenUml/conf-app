import {OkResponse, response} from "../OkResponse";
import {captureError} from "./sentry";
import { getAuthorizationHeader } from "./requestUtils";
import * as jose from 'jose';

export const validateContextToken = async (invocationToken: string, allowedAppIds: string) => {
  const jwksUrl = 'https://forge.cdn.prod.atlassian-dev.net/.well-known/jwks.json';
  const JWKS = jose.createRemoteJWKSet(new URL(jwksUrl));

  try {
    const token = await jose.jwtVerify(invocationToken, JWKS);
    
    const tokenAppId = (token as any).payload.app.id.split('/').pop();
    if (!allowedAppIds.includes(tokenAppId)) {
      throw new Error(`App ID mismatch: expected ${tokenAppId} to be contained in ${allowedAppIds}`);
    }
    
    const apiBaseUrl = token.payload?.app?.apiBaseUrl || token.payload?.app?.installation?.contexts?.[0]?.apiBaseUrl;
    
    return {
      ...token,
      apiBaseUrl,
      forgeAppId: tokenAppId
    };
  } catch (error) {
    try {
      const decodedToken = jose.decodeJwt(invocationToken);
      console.log('jwtVerify failed - decoded token:', decodedToken);
    } catch (decodeError) {
      console.log('jwtVerify failed - could not decode token:', decodeError.message);
    }
    console.log('jwtVerify failed - error:', error.message);
    throw error;
  }
}

import { upsertAtlassianInstance } from './dbUtils';

async function authenticateForgeRequest(jwt, env) {
  const allowedForgeAppIds = env.ALLOWED_FORGE_APP_IDS;
  if (!allowedForgeAppIds) {
    console.error('ALLOWED_FORGE_APP_IDS environment variable is not set');
    return response({ error: 'Server configuration error: ALLOWED_FORGE_APP_IDS not configured' }, 500);
  }
  console.log('ALLOWED_FORGE_APP_IDS:', allowedForgeAppIds);

  const payload = await validateContextToken(jwt, allowedForgeAppIds);
  console.log('validateContextToken - payload', payload);
  env.FORGE_CONTEXT = payload;

  // Populate AtlassianInstance from siteUrl when available in macro-render tokens
  const cloudId = payload.payload?.context?.cloudId;
  const siteUrl = payload.payload?.context?.siteUrl;
  if (cloudId && siteUrl && env.DB) {
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
}

export default async function authenticate({ request, env }) {
  try {
    const jwt = getAuthorizationHeader(request);
    if (!jwt) {
      return response(401, 'Unauthorized: Missing or invalid Authorization header');
    }

    try {
      await authenticateForgeRequest(jwt, env);
      return OkResponse();
    } catch (e) {
      captureError(e);
      return response(401, 'Unauthorized: JWT validation failed');
    }

  } catch (e) {
    captureError(e);
    return response(500, `Unexpected error: ${e}`);
  }
}
