import { D1Database } from '@cloudflare/workers-types';
import { ForgeAppRequestBody } from '../RequestBody';

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
    "SELECT clientDomain FROM ForgeInstallation WHERE appId = ?1 AND cloudId = ?2"
  )
    .bind(normalizedAppId, cloudId)
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

  const result = await db.prepare(
    `INSERT INTO ForgeInstallation (
      installationId, context, installerAccountId, eventType, appId, environmentId, permissions, cloudId, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(installationId) DO UPDATE SET
      installationId = excluded.installationId,
      context = excluded.context,
      installerAccountId = excluded.installerAccountId,
      eventType = excluded.eventType,
      appId = excluded.appId,
      environmentId = excluded.environmentId,
      permissions = excluded.permissions,
      cloudId = excluded.cloudId,
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
    new Date().toISOString()
  ) .run();

  console.log('DB ForgeInstallation Upsert Result:', result);
}
