import { D1Database } from '@cloudflare/workers-types';
import { ForgeAppRequestBody } from '../RequestBody';
import { MixpanelTrackPayload } from '../service/mixpanelService';

export async function getAtlassianInstanceClientDomain(
  db: D1Database,
  cloudId?: string,
): Promise<string | null> {
  if (!cloudId) {
    return null;
  }

  const result = await db.prepare(
    `SELECT clientDomain FROM AtlassianInstance WHERE cloudId = ?1`
  )
    .bind(cloudId)
    .first<{ clientDomain?: string | null }>();

  return result?.clientDomain || null;
}

export async function upsertAtlassianInstance(
  db: D1Database,
  cloudId: string,
  clientDomain: string | null,
): Promise<void> {
  if (!cloudId || !clientDomain) {
    return;
  }

  const result = await db.prepare(
    `INSERT INTO AtlassianInstance (cloudId, clientDomain)
     VALUES (?1, ?2)
     ON CONFLICT(cloudId) DO UPDATE SET clientDomain = excluded.clientDomain`
  )
    .bind(cloudId, clientDomain)
    .run();

  console.log('DB AtlassianInstance Upsert Result:', result);
}

export async function getForgeInstallationClientDomain(
  db: D1Database,
  appId?: string,
  cloudId?: string,
) {
  if (!appId || !cloudId) {
    return null;
  }

  const normalizedAppId = appId.split("/").pop() || appId;

  const result = await db.prepare(
    `SELECT clientDomain
     FROM ForgeInstallation
     WHERE appId IN (?1, ?2)
       AND cloudId = ?3
       AND clientDomain IS NOT NULL
       AND clientDomain != ''
     ORDER BY createdAt DESC
     LIMIT 1`
  )
    .bind(appId, normalizedAppId, cloudId)
    .first<{ clientDomain?: string | null }>();

  return result?.clientDomain || null;
}

async function upsertForgeApp(db: D1Database, body: ForgeAppRequestBody) {
  const result = await db.prepare(
    `INSERT INTO ForgeApp (
      appId, name, ownerAccountId, version, createdAt
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(appId) DO UPDATE SET
      appId = excluded.appId,
      name = excluded.name,
      ownerAccountId = excluded.ownerAccountId,
      version = excluded.version,
      createdAt = excluded.createdAt`
  ).bind(
    body.app.id,
    body.app.name,
    body.app.ownerAccountId,
    body.app.version,
    new Date().toISOString()
  ) .run();

  console.log('DB ForgeApp Upsert Result:', result);
}

export async function upsertForgeInstallation(db: D1Database, body: ForgeAppRequestBody) {
  await upsertForgeApp(db, body);

  let cloudId: string | null = null;
  if (body.context) {
    const match = body.context.match(/ari:cloud:confluence::site\/([a-f0-9-]+)/);
    if (match) {
      cloudId = match[1];
    }
  }

  const instanceDomain = await getAtlassianInstanceClientDomain(db, cloudId || undefined);
  const clientDomain = instanceDomain
    || await getForgeInstallationClientDomain(db, body.app.id, cloudId || undefined);

  // Only upsert AtlassianInstance if the domain came from the ForgeInstallation fallback
  if (cloudId && clientDomain && !instanceDomain) {
    await upsertAtlassianInstance(db, cloudId, clientDomain);
  }

  const result = await db.prepare(
    `INSERT INTO ForgeInstallation (
      installationId, context, installerAccountId, eventType, appId, environmentId, permissions, cloudId, clientDomain, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(installationId) DO UPDATE SET
      installationId = excluded.installationId,
      context = excluded.context,
      installerAccountId = excluded.installerAccountId,
      eventType = excluded.eventType,
      appId = excluded.appId,
      environmentId = excluded.environmentId,
      permissions = excluded.permissions,
      cloudId = excluded.cloudId,
      clientDomain = COALESCE(excluded.clientDomain, ForgeInstallation.clientDomain),
      createdAt = excluded.createdAt`
  ).bind(
    body.id,
    body.context,
    body.installerAccountId,
    body.eventType,
    body.app.id,
    body.environment.id,
    JSON.stringify(body.permissions),
    cloudId,
    clientDomain,
    new Date().toISOString()
  ) .run();

  console.log('DB ForgeInstallation Upsert Result:', result);
}

export async function insertUserBehaviorEvent(
  db: D1Database,
  event: MixpanelTrackPayload,
): Promise<void> {
  const result = await db.prepare(
    `INSERT INTO UserBehaviorEvent (cloudId, userAccountId, contentId, action, clientDomain, spaceKey, payload)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  )
    .bind(
      event.cloud_id || 'unknown_cloud_id',
      event.user_account_id || 'unknown_user',
      event.content_id || 'unknown_content',
      event.action,
      event.client_domain || null,
      event.space_key || event.confluence_space || null,
      JSON.stringify(event),
    )
    .run();

  console.log('DB UserBehaviorEvent Insert Result:', result);
}

export async function aggregateDailyCounters(db: D1Database): Promise<void> {
  const result = await db.prepare(
    `INSERT INTO DailyBehaviorCounter (date, cloudId, clientDomain, spaceKey, action, eventCount, uniqueUsers, uniquePages, updatedAt)
     SELECT
       DATE(createdAt) as date,
       cloudId,
       clientDomain,
       spaceKey,
       action,
       COUNT(*) as eventCount,
       COUNT(DISTINCT userAccountId) as uniqueUsers,
       COUNT(DISTINCT contentId) as uniquePages,
       CURRENT_TIMESTAMP
     FROM UserBehaviorEvent
     WHERE DATE(createdAt) < DATE('now')
     GROUP BY DATE(createdAt), cloudId, clientDomain, spaceKey, action
     ON CONFLICT(date, cloudId, spaceKey, action) DO UPDATE SET
       eventCount = excluded.eventCount,
       uniqueUsers = excluded.uniqueUsers,
       uniquePages = excluded.uniquePages,
       clientDomain = COALESCE(excluded.clientDomain, DailyBehaviorCounter.clientDomain),
       updatedAt = CURRENT_TIMESTAMP`
  ).run();

  console.log('DB DailyBehaviorCounter Aggregate Result:', result);
}

export async function purgeOldEvents(db: D1Database, retentionDays: number = 60): Promise<void> {
  const result = await db.prepare(
    `DELETE FROM UserBehaviorEvent WHERE createdAt < DATETIME('now', ?1)`
  )
    .bind(`-${retentionDays} days`)
    .run();

  console.log(`DB UserBehaviorEvent Purge (>${retentionDays} days):`, result);
}
