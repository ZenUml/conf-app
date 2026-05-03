import { response, OkResponse } from "./OkResponse";
import { getCustomContentFromConfluenceForForge } from "./utils/confluenceUtils";
import { upsertAtlassianInstance } from "./utils/dbUtils";

export interface Env {
  DB: D1Database;
}

export const onRequest = async ({ request, env }) => {
  try {
    const apiBaseUrl = env.FORGE_CONTEXT.apiBaseUrl;
    const forgeAppId = env.FORGE_CONTEXT.forgeAppId;
    console.log('Using apiBaseUrl from forge token:', apiBaseUrl);

    const forgeOAuthUser = request.headers.get('x-forge-oauth-user');
    if (!forgeOAuthUser) {
      throw 'Missing x-forge-oauth-user header - not a valid Forge request';
    }

    const body: any = await request.json();

    const customContent = await getCustomContentFromConfluenceForForge(apiBaseUrl, body.contentId, forgeOAuthUser);

    const versionResult = await createVersion(env, customContent, forgeAppId);
    if(versionResult) {
      await createOrUpdateContent(env, customContent, forgeAppId, body.macroUuid, body.diagramType);
    }

    // Update ForgeInstallation with clientDomain if provided
    if (body.clientDomain) {
      await updateForgeInstallationClientDomain(env, forgeAppId, apiBaseUrl, body.clientDomain);
    }

    return OkResponse();
  } catch (error) {
    console.error('Error in forge-custom-content:', error);
    return response(500, 'Internal server error');
  }
};

async function createVersion(env, data, appId) {
  // Check if version already exists
  const existingVersion = await env.DB.prepare(
    "SELECT versionNumber FROM CustomContentVersion WHERE contentId = ?1 AND appId = ?2 AND versionNumber = ?3"
  )
  .bind(data.id, appId, data.version.number)
  .first();

  if (existingVersion) {
    console.log(`Version ${data.version.number} already exists for contentId ${data.id} and appId ${appId}, skipping creation`);
    return;
  }

  const result = await env.DB.prepare( "INSERT INTO CustomContentVersion (contentId, body, authorId, createdAt, versionNumber, appId, title, message, minorEdit) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)" )
  .bind(data.id, JSON.stringify(data.body), data.authorId, data.createdAt, data.version.number, appId, data.title || '', data.version.message || '', data.version.minorEdit ? 1 : 0)
  .run();
  console.log('create version result:', result);
  return result;
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
    console.log('update content result:', result);
    return;
  }

  const result = await env.DB.prepare( "insert into CustomContent (contentId, type, latestVersionNumber, body, createdAt, appId, spaceId, title, pageId, macroUuid, diagramType, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)" )
  .bind(data.id, data.type, data.version.number, JSON.stringify(data.body), data.createdAt, appId, data.spaceId, data.title || '', data.pageId || '', macroUuid || '', diagramType || '', data.status || '')
  .run();
  console.log('create content result:', result);
}

async function updateForgeInstallationClientDomain(env, appId, apiBaseUrl, clientDomain) {
  // Extract cloudId from apiBaseUrl (e.g., https://api.atlassian.com/ex/confluence/{cloudId})
  let cloudId: string | null = null;
  if (apiBaseUrl) {
    const match = apiBaseUrl.match(/\/ex\/confluence\/([a-f0-9-]+)/);
    if (match) {
      cloudId = match[1];
    }
  }

  if (!cloudId) {
    console.log('Could not extract cloudId from apiBaseUrl:', apiBaseUrl);
    return;
  }

  await upsertAtlassianInstance(env.DB, cloudId, clientDomain);

  const result = await env.DB.prepare(
    "UPDATE ForgeInstallation SET clientDomain = ?1 WHERE appId = ?2 AND cloudId = ?3"
  )
  .bind(clientDomain, appId, cloudId)
  .run();

  console.log('Update ForgeInstallation clientDomain result:', result);
}
