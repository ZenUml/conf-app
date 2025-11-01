import { response, OkResponse } from "./OkResponse";
import { getCustomContentFromConfluenceForForge } from "./utils/confluenceUtils";
import { validateContextToken } from "./utils/authenticate";
import { getAuthorizationHeader } from "./utils/requestUtils";

export interface Env {
  DB: D1Database;
  FORGE_APP_ID: string;
}

export const onRequest = async ({ request, env }) => {
  try {
    // Check if FORGE_APP_ID environment variable is present
    const forgeAppId = env.FORGE_APP_ID;
    if (!forgeAppId) {
      console.error('FORGE_APP_ID environment variable is not set');
      return response({ error: 'Server configuration error: FORGE_APP_ID not configured' }, 500);
    }
    
    console.log('FORGE_APP_ID:', forgeAppId);
    
    // Validate that this is a legitimate Forge request
    const validationResult = await validateForgeRequest(request, forgeAppId);
    if (validationResult.error) {
      console.error('Forge request validation failed:', validationResult.error);
      return response({ error: validationResult.error }, validationResult.status);
    }

    // Extract apiBaseUrl from validation result
    const apiBaseUrl = validationResult.apiBaseUrl;
    console.log('Using apiBaseUrl from token:', apiBaseUrl);

    // Get the x-forge-oauth-user header
    const forgeOAuthUser = request.headers.get('x-forge-oauth-user');

    const body: any = await request.json();

    const customContent = await getCustomContentFromConfluenceForForge(apiBaseUrl, body.contentId, forgeOAuthUser);

    const versionResult = await createVersion(env, customContent, forgeAppId);
    if(versionResult) {
      await createOrUpdateContent(env, customContent, forgeAppId, body.macroUuid, body.diagramType);
    }
    
    return OkResponse();
  } catch (error) {
    console.error('Error in forge-custom-content:', error);
    return response({ error: 'Internal server error' }, 500);
  }
};

async function validateForgeRequest(request: Request, forgeAppId: string): Promise<{ error?: string; status?: number }> {
  // Check for required Forge headers
  const forgeOAuthUser = request.headers.get('x-forge-oauth-user');
  if (!forgeOAuthUser) {
    return { error: 'Missing x-forge-oauth-user header - not a valid Forge request', status: 401 };
  }

  // Validate Authorization header (JWT token)
  const jwt = getAuthorizationHeader(request);
  if (!jwt) {
    return { error: 'Missing Authorization header - not a valid Forge request', status: 401 };
  }

  try {
    // Validate the context token using Forge's JWKS with the configured app ID
    const token = await validateContextToken(jwt, forgeAppId);

    // forgeOAuthUser header is present and will be used as-is without validation
    return { apiBaseUrl: token.apiBaseUrl }; // Return the apiBaseUrl for use in the main function

  } catch (error) {
    console.error('Forge request validation error:', error);
    return { error: 'Forge request validation failed', status: 401 };
  }
}

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
