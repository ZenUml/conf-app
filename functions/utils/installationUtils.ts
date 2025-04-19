import { KVEnv } from "./KVEnv";
import { getClientKeyFromRequest } from "./requestUtils";

async function getInstallationDataFromD1(db: D1Database, clientKey: string) {
  return await db.prepare(
    `SELECT * FROM ClientInstallation WHERE clientKey = ?`
  ).bind(clientKey).first();
}

export async function getInstallationData(env: any, request: Request) {
  const {searchParams} = new URL(request.url);
    
  const baseURL = searchParams.get('xdm_e') || '';
  const domain = baseURL ? new URL(baseURL).hostname : '';
  const appKey = searchParams.get('addonKey') || '';
  const isLite = appKey.includes('-lite');

  const clientKey = getClientKeyFromRequest(request);
  if (!clientKey) {
    throw new Error('Missing or invalid clientKey in request');
  }

  let installationData = await getInstallationDataFromD1(env.DB, clientKey);

  // Fallback to KV if installation data is not found in D1
  if (!installationData) {
    const kvData = await env[KVEnv.CLIENT_INSTALLATION_KV].get(`${isLite ? 'lite' : 'full'}/${domain}`);
    if (!kvData) {
      throw new Error(`No installation data found for clientKey: ${clientKey}, domain: ${domain} in both D1 and KV`);
    }
    installationData = JSON.parse(kvData);
  }

  return installationData;
}