import { captureError } from "./utils/sentry";
import {OkResponse} from "./OkResponse";
import { upsertForgeInstallation } from "./utils/dbUtils";
import { ForgeAppRequestBody } from "./RequestBody";
import { getAuthorizationHeader } from "./utils/requestUtils";
import * as jose from 'jose';

export const onRequest: PagesFunction = async ({ request, env }) => {
  try {
    // Decode and log the Forge authorization header
    const authHeader = getAuthorizationHeader(request);
    if (authHeader) {
      try {
        const decodedToken = jose.decodeJwt(authHeader);
        /**
         * Example token:
         * {
          "app": {
            "id": "ari:cloud:ecosystem::app/d9e4002b-120b-426b-834b-402a4a5adce7",
            "version": "8",
            "appVersion": "22.7.0",
            "installationId": "ari:cloud:ecosystem::installation/78738015-0fed-45bb-857b-3c2c8e3c7d0a",
            "apiBaseUrl": "https://api.atlassian.com/ex/confluence/866c3a03-ec62-4717-91c4-1ad078bfcc60",
            "environment": {
              "type": "DEVELOPMENT",
              "id": "ari:cloud:ecosystem::environment/d9e4002b-120b-426b-834b-402a4a5adce7/1e468bcd-89ab-49f0-a648-14620b9cde00"
            },
            "module": {
              "type": "core:trigger",
              "key": "remote-installed-trigger"
            },
            "installation": {
              "id": "ari:cloud:ecosystem::installation/78738015-0fed-45bb-857b-3c2c8e3c7d0a",
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
            "moduleKey": "remote-installed-trigger",
            "userAccess": {
              "enabled": false
            }
          },
          "aud": "ari:cloud:ecosystem::app/d9e4002b-120b-426b-834b-402a4a5adce7",
          "iss": "forge/invocation-token",
          "iat": 1760755604,
          "nbf": 1760755604,
          "exp": 1760755629,
          "jti": "46d16c0878f3db54963c84a9af48a902efcab29c"
        }
         */

        const data = await request.json() as ForgeAppRequestBody;
        console.log('forge-installed body:', data);

        await upsertForgeInstallation((env as any).DB, data);

      } catch (decodeError) {
        console.log('forge-installed could not decode authorization token:', decodeError.message);
      }
    } else {
      console.log('forge-installed no authorization header found');
    }

  } catch (e) {
    console.log(`Error: ${e}`);
    captureError(e);
  }
  return OkResponse(undefined);
};
