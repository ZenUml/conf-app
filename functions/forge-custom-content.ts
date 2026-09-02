import { response, OkResponse } from "./OkResponse";
import { getCustomContentFromConfluenceForForge } from "./utils/confluenceUtils";
import { upsertAtlassianInstance } from "./utils/dbUtils";
import { captureError } from "./utils/sentry";
import { indexDiagramOnSave } from "./architecture-tokens/indexOnSave";
import type { ForgeRequestData } from "./utils/authenticate";

export interface Env {
  DB: D1Database;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const onRequest = async ({
  request,
  env,
  data,
}: {
  request: Request;
  env: any;
  data: ForgeRequestData;
}) => {
  // Input validation — return parseable 4xx JSON, never throw into a generic 500.
  const forgeOAuthUser = request.headers.get('x-forge-oauth-user');
  if (!forgeOAuthUser) {
    return response(400, 'Missing x-forge-oauth-user header - not a valid Forge request');
  }

  let body: any;
  try {
    body = await request.json();
  } catch (e) {
    return response(400, 'Invalid JSON body');
  }

  const apiBaseUrl = data.forgeContext?.apiBaseUrl;
  const forgeAppId = data.forgeContext?.forgeAppId;
  console.log('Using apiBaseUrl from forge token:', apiBaseUrl);

  // Best-effort re-fetch of the just-saved custom content. Confluence is the
  // system of record; mirroring into D1 is telemetry only. If the re-fetch
  // fails (user OAuth grant missing/expired → 401/403, content already gone →
  // 404, or a transient upstream 5xx), that is NOT a server error: return a
  // parseable 2xx so the client's best-effort sync does not log a (previously
  // masked) error event. This is the expected, non-actionable case and was the
  // most likely trigger of the historical text/plain 500s (conf-app#267).
  let customContent: any;
  try {
    customContent = await getCustomContentFromConfluenceForForge(apiBaseUrl, body.contentId, forgeOAuthUser);
  } catch (e) {
    console.warn('Skipping custom-content sync; Confluence re-fetch failed:', e);
    return OkResponse({ synced: false, reason: 'content_fetch_failed', detail: errMessage(e) });
  }

  try {
    // Version insert is idempotent (skips when the version row is already
    // recorded); the CustomContent upsert must run unconditionally so the
    // macroUuid/diagramType backfill still happens on retries, and so we
    // recover from prior requests that inserted the version but failed
    // before completing the CustomContent write.
    await createVersion(env, customContent, forgeAppId);
    await createOrUpdateContent(
      env, customContent, forgeAppId, body.macroUuid, body.diagramType, cloudIdFrom(apiBaseUrl),
    );

    // Update ForgeInstallation with clientDomain if provided
    if (body.clientDomain) {
      await updateForgeInstallationClientDomain(env, forgeAppId, apiBaseUrl, body.clientDomain);
    }

    // Keep this diagram's architecture-token rows at the version just saved.
    // Deliberately outside the outer catch: the index is derived from content
    // Confluence already owns, so a failure here must not turn a successful
    // save into a 500. indexDiagramOnSave never throws; it reports instead.
    const indexResult = await indexDiagramOnSave(
      env.DB, cloudIdFrom(apiBaseUrl), customContent,
    );
    if (!indexResult.indexed && indexResult.reason === 'write_failed') {
      console.error('architecture-tokens: index write failed', indexResult.detail);
      captureError(new Error(`architecture-tokens index write failed: ${indexResult.detail}`));
    }

    return OkResponse();
  } catch (error) {
    // Unexpected failure (e.g. a D1 write) — unlike the benign re-fetch case
    // above, this is a real server-side defect. Surface it, but as parseable
    // JSON carrying the real message so the client's error event captures the
    // true cause instead of a generic content-type complaint.
    console.error('Error in forge-custom-content (D1 write):', error);
    captureError(error);
    return response(500, `Internal server error: ${errMessage(error)}`);
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

  // INSERT OR IGNORE makes this race-safe against concurrent duplicate
  // saves: if two requests for the same (contentId, versionNumber, appId)
  // pass the SELECT and both reach the INSERT, the loser becomes a silent
  // no-op instead of bubbling a unique-constraint error up to onRequest —
  // which would otherwise return 500 and skip the CustomContent backfill.
  const result = await env.DB.prepare( "INSERT OR IGNORE INTO CustomContentVersion (contentId, body, authorId, createdAt, versionNumber, appId, title, message, minorEdit) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)" )
  .bind(data.id, JSON.stringify(data.body), data.authorId, data.createdAt, data.version.number, appId, data.title || '', data.version.message || '', data.version.minorEdit ? 1 : 0)
  .run();
  console.log('create version result:', result);
  return result;
}

async function getContent(env, data, appId) {
  const { results } = await env.DB.prepare( "SELECT contentId FROM CustomContent WHERE contentId=?1 AND appId=?2" ).bind(data.id, appId).all();
  return results && results.length > 0;
}

/** `https://api.atlassian.com/ex/confluence/{cloudId}` — the only tenant id the save carries. */
export function cloudIdFrom(apiBaseUrl: string | undefined): string | null {
  const match = apiBaseUrl?.match(/\/ex\/confluence\/([a-f0-9-]+)/);
  return match ? match[1] : null;
}

async function createOrUpdateContent(env, data, appId, macroUuid, diagramType, cloudId) {
  if(await getContent(env, data, appId)) {
    // COALESCE(NULLIF(?, ''), existing) — backfill macroUuid/diagramType from
    // the request when non-empty, keep the existing value otherwise. Without
    // this, every UPDATE silently drops the identity payload sent by
    // Persistence.ts and existing rows stay misaligned with Mixpanel forever.
    const result = await env.DB.prepare(
      "UPDATE CustomContent SET latestVersionNumber=?1, body=?2, createdAt=?3, title=?4, status=?5, macroUuid = COALESCE(NULLIF(?6, ''), macroUuid), diagramType = COALESCE(NULLIF(?7, ''), diagramType), cloudId = COALESCE(?11, cloudId) WHERE contentId=?8 AND appId=?9 AND spaceId=?10"
    )
    .bind(data.version.number, JSON.stringify(data.body), data.createdAt, data.title || '', data.status || '', macroUuid || '', diagramType || '', data.id, appId, data.spaceId, cloudId || null)
    .run();
    console.log('update content result:', result);
    return;
  }

  const result = await env.DB.prepare( "insert into CustomContent (contentId, type, latestVersionNumber, body, createdAt, appId, spaceId, title, pageId, macroUuid, diagramType, status, cloudId) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)" )
  .bind(data.id, data.type, data.version.number, JSON.stringify(data.body), data.createdAt, appId, data.spaceId, data.title || '', data.pageId || '', macroUuid || '', diagramType || '', data.status || '', cloudId || null)
  .run();
  console.log('create content result:', result);
}

async function updateForgeInstallationClientDomain(env, appId, apiBaseUrl, clientDomain) {
  // Extract cloudId from apiBaseUrl (e.g., https://api.atlassian.com/ex/confluence/{cloudId})
  const cloudId = cloudIdFrom(apiBaseUrl);

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
