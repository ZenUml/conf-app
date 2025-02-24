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
      return response(401, 'Unauthorized');
    }
    const jwt = authHeader.split(' ')[1];
    if (!jwt) {
      return response(401, 'Unauthorized');
    }

    const data = await env[KVEnv.CLIENT_INSTALLATION_KV].get(`${isLite ? 'lite' : 'full'}/${domain}`);
    if (!data) {
      throw new Error(`No installation data found for ${domain}`);
    }

    try {
      decode(jwt, JSON.parse(data).sharedSecret);
    } catch (e) {
      console.log(`Decode JWT error: ${e}`);
      captureError(e);
      return response(401, 'Unauthorized');
    }

  } catch (e) {
    console.log(`Error: ${e}`);
    captureError(e);
    return response(500, 'Unexpected error');
  }

  return OkResponse();
}
