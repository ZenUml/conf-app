import { response, OkResponse } from "./OkResponse";
import { getClientKeyFromRequest } from "./utils/requestUtils";
import { getCustomContentFromConfluence } from "./utils/confluenceUtils";
import { getInstallationData } from "./utils/installationUtils";

export interface Env {
  DB: D1Database;
}

export const onRequest = async ({ request, env }) => {

  // Get the x-forge-oauth-user header
  const forgeOAuthUser = request.headers.get('x-forge-oauth-user');
  console.log('forge-custom-content forgeOAuthUser:', forgeOAuthUser);
  //TODO: validate forgeOAuthUser

  const body: any = await request.json();
  console.log('forge-custom-content req body:', body);
  console.log('forge-custom-content req body.context:', body.context);

  const installationData = await getInstallationData(env, request, body.forgeCloudId);
  const customContent = await getCustomContentFromConfluence(installationData, body.contentId, forgeOAuthUser);
  console.log('forge-custom-content customContent:', customContent);

  const appId = (installationData as any).appId;

  await createVersion(env, customContent, appId);
  await createOrUpdateContent(env, customContent, appId, body.macroUuid, body.diagramType);

  return OkResponse();
};

async function createVersion(env, data, appId) {
  const result = await env.DB.prepare( "INSERT INTO CustomContentVersion (contentId, body, authorId, createdAt, versionNumber, appId, title, message, minorEdit) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)" )
  .bind(data.id, JSON.stringify(data.body), data.authorId, data.createdAt, data.version.number, appId, data.title || '', data.version.message || '', data.version.minorEdit ? 1 : 0)
  .run();
  console.log('create version result:', JSON.stringify(result));
}

async function getContent(env, data, appId) {
  const { results } = await env.DB.prepare( "SELECT contentId FROM CustomContent WHERE contentId=?1 AND appId=?2" ).bind(data.id, appId).all();
  return results && results.length > 0;
}

async function createOrUpdateContent(env, data, appId, macroUuid, diagramType) {
  if(await getContent(env, data, appId)) {
    const result = await env.DB.prepare( "UPDATE CustomContent SET latestVersionNumber=?1, body=?2, createdAt=?3, title=?4, status=?5 WHERE contentId=?6 AND appId=?7 AND spaceId=?8" )
    .bind(data.version.number, JSON.stringify(data.body), data.createdAt, data.title || '', data.status || '', data.id, appId, data.spaceId)
    .run();
    console.log('update content result:', JSON.stringify(result));
    return;
  }

  const result = await env.DB.prepare( "insert into CustomContent (contentId, type, latestVersionNumber, body, createdAt, appId, spaceId, title, pageId, macroUuid, diagramType, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)" )
  .bind(data.id, data.type, data.version.number, JSON.stringify(data.body), data.createdAt, appId, data.spaceId, data.title || '', data.pageId || '', macroUuid || '', diagramType || '', data.status || '')
  .run();
  console.log('create content result:', JSON.stringify(result));
}

async function getAppId(env, addonKey, clientKey) {
  const { results } = await env.DB.prepare( "SELECT appId FROM AppInstance WHERE addonKey=?1 AND clientKey=?2" )
  .bind(addonKey, clientKey)
  .all();
  if(results && results.length > 0) {
    return results[0].appId;
  }
}

async function getOrCreateAppId(env, data, request) {
  const clientKey = getClientKeyFromRequest(request);
  if (!clientKey) {
    throw new Error('Missing or invalid clientKey in request');
  }

  const appId = await getAppId(env, data.addonKey, clientKey);
  if (appId) {
    return appId;
  }

  const result = await env.DB.prepare( "INSERT INTO AppInstance (clientDomain, addonKey, clientKey) VALUES (?1, ?2, ?3)" )
  .bind(data.clientDomain, data.addonKey, clientKey)
  .run();
  console.log('create app result:', JSON.stringify(result));
  
  return await getAppId(env, data.addonKey, clientKey);
}
