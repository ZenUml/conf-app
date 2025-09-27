import {decode} from "./atlassian";
import {OkResponse, response} from "../OkResponse";
import {captureError} from "./sentry";
import { getInstallationData } from "./installationUtils";
import { getAuthorizationHeader } from "./requestUtils";
import * as jose from 'jose';

export const validateContextToken = async (invocationToken, appId) => {
  const jwksUrl = 'https://forge.cdn.prod.atlassian-dev.net/.well-known/jwks.json';
  const JWKS = jose.createRemoteJWKSet(new URL(jwksUrl));

  const payload = await jose.jwtVerify(invocationToken, JWKS, {audience: appId});
  return payload;
}

export default async function authenticate({ request, env }) {
  try {
    const jwt = getAuthorizationHeader(request);
    if (!jwt) {
      return response(401, 'Unauthorized: Missing or invalid Authorization header');
    }

    try {
      if(request.headers.get('x-forge-oauth-user')) {
        console.log('validateContextToken - jwt', jwt);

        const jwtPayload = jose.decodeJwt(jwt);
        console.log('validateContextToken - jwtPayload', JSON.stringify(jwtPayload));

        const payload = await validateContextToken(jwt, jwtPayload.app?.id);
        console.log('validateContextToken - payload', payload);
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
