import {decode} from "./atlassian";
import {OkResponse, response} from "../OkResponse";
import {captureError} from "../ConfigToucan";
import { KVEnv } from "./KVEnv";

export default async function authenticate({ request, env }) {
  try {
    const {searchParams} = new URL(request.url);
    
    const baseURL = searchParams.get('xdm_e') || '';
    const domain = baseURL ? new URL(baseURL).hostname : '';
    const appKey = searchParams.get('addonKey') || '';
    const isLite = appKey.includes('-lite');
    
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return response(401, 'Unauthorized: Missing Authorization header');
    }
    const jwt = authHeader.split(' ')[1];
    if (!jwt) {
      return response(401, 'Unauthorized: Invalid Authorization format');
    }

    // Check if running in development mode
    const isDevelopment = env.ENVIRONMENT === 'development' || !env[KVEnv.CLIENT_INSTALLATION_KV];
    
    if (!isDevelopment) {
      if (!env || !env[KVEnv.CLIENT_INSTALLATION_KV]) {
        return response(500, 'Server configuration error: KV namespace not available');
      }

      const data = await env[KVEnv.CLIENT_INSTALLATION_KV].get(`${isLite ? 'lite' : 'full'}/${domain}`);
      if (!data) {
        throw new Error(`No installation data found for ${domain} (${isLite ? 'lite' : 'full'} version)`);
      }

      try {
        const parsedData = JSON.parse(data);
        decode(jwt, parsedData.sharedSecret);
      } catch (e) {
        captureError(e);
        return response(401, 'Unauthorized: JWT validation failed');
      }
    }

  } catch (e) {
    captureError(e);
    return response(500, `Unexpected error: ${e}`);
  }

  return OkResponse(undefined);
}
