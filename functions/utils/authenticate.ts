import {decode} from "./atlassian";
import {OkResponse, response} from "../OkResponse";
import {captureError} from "./sentry";
import { getInstallationData } from "./installationUtils";
import { getAuthorizationHeader } from "./requestUtils";
import * as jose from 'jose';

export const validateContextToken = async (invocationToken: string, allowedAppIds: string) => {
  const jwksUrl = 'https://forge.cdn.prod.atlassian-dev.net/.well-known/jwks.json';
  const JWKS = jose.createRemoteJWKSet(new URL(jwksUrl));

  try {
    const token = await jose.jwtVerify(invocationToken, JWKS);
    
    // Check that the tokenAppId is allowed
    const tokenAppId = (token as any).payload.app.id.split('/').pop();
    if (!allowedAppIds.includes(tokenAppId)) {
      throw new Error(`App ID mismatch: expected ${tokenAppId} to be contained in ${allowedAppIds}`);
    }
    /** Example token:
     * {
          "payload": {
            "app": {
              "id": "ari:cloud:ecosystem::app/d9e4002b-120b-426b-834b-402a4a5adce7",
              "version": "5",
              "appVersion": "22.4.0",
              "installationId": "ari:cloud:ecosystem::installation/11ac20df-be56-457d-af77-b776285cb0f0",
              "apiBaseUrl": "https://api.atlassian.com/ex/confluence/866c3a03-ec62-4717-91c4-1ad078bfcc60",
              "environment": {
                "type": "DEVELOPMENT",
                "id": "ari:cloud:ecosystem::environment/d9e4002b-120b-426b-834b-402a4a5adce7/1e468bcd-89ab-49f0-a648-14620b9cde00"
              },
              "module": {
                "type": "xen:macro",
                "key": "zenuml-sequence-macro"
              },
              "installation": {
                "id": "ari:cloud:ecosystem::installation/11ac20df-be56-457d-af77-b776285cb0f0",
                "contexts": [
                  {
                    "name": "confluence",
                    "apiBaseUrl": "https://api.atlassian.com/ex/confluence/866c3a03-ec62-4717-91c4-1ad078bfcc60"
                  }
                ]
              }
            },
            "context": {
              "cloudId": "866c3a03-ec62-4717-91c4-1ad078bfcc60",
              "localId": "a46ed7ed-f7a7-45da-9b5f-9cffd1baeda8",
              "environmentId": "1e468bcd-89ab-49f0-a648-14620b9cde00",
              "environmentType": "DEVELOPMENT",
              "moduleKey": "zenuml-sequence-macro",
              "siteUrl": "https://whimet4.atlassian.net",
              "appVersion": "22.4.0",
              "extension": {
                "config": {
                  "customContentId": "597295109",
                  "updatedAt": "2025-08-20T09:46:01.365Z"
                },
                "isEditing": false,
                "type": "macro",
                "content": {
                  "id": "584318979",
                  "type": "page",
                  "subtype": null
                },
                "space": {
                  "key": "WHIMET4",
                  "id": "163841"
                },
                "references": [],
                "modal": {
                  "macroMode": "editor"
                }
              },
              "userAccess": {
                "enabled": false,
                "hasAccess": true
              },
              "accountType": "licensed",
              "accountId": "557058:3731f189-7e58-46c0-b5c7-697c5a021aee"
            },
            "principal": "557058:3731f189-7e58-46c0-b5c7-697c5a021aee",
            "aud": "ari:cloud:ecosystem::app/d9e4002b-120b-426b-834b-402a4a5adce7",
            "iss": "forge/invocation-token",
            "iat": 1760174467,
            "nbf": 1760174467,
            "exp": 1760174492,
            "jti": "c900303226dd9b698199667c9c7c2b91d7cef2ff"
          },
          "protectedHeader": {
            "alg": "RS256",
            "kid": "forge/invocation-token/wf-f641e7a7-d1b6-472a-806b-5e4b03912149"
          },
          "key": {
            "usages": [
              "verify"
            ],
            "algorithm": {
              "name": "RSASSA-PKCS1-v1_5",
              "modulusLength": 2048,
              "publicExponent": {
                "0": 1,
                "1": 0,
                "2": 1
              },
              "hash": {
                "name": "SHA-256"
              }
            },
            "extractable": true,
            "type": "public"
          },
          "apiBaseUrl": "https://api.atlassian.com/ex/confluence/866c3a03-ec62-4717-91c4-1ad078bfcc60"
        }
     */
    
    // Extract apiBaseUrl from the token payload
    const apiBaseUrl = token.payload?.app?.apiBaseUrl || token.payload?.app?.installation?.contexts?.[0]?.apiBaseUrl;
    
    return {
      ...token,
      apiBaseUrl,
      forgeAppId: tokenAppId
    };
  } catch (error) {
    // Log the decoded token when jwtVerify fails
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
      const isForge = request.headers.get('x-forge-oauth-user');
      if(isForge) {
        await authenticateForgeRequest(jwt, env);
        return OkResponse();
      }

      const installationData = await getInstallationData(env, request);
      decode(jwt, (installationData as any).sharedSecret);

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
