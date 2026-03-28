import { D1Database } from '@cloudflare/workers-types';
import { ForgeAppRequestBody } from '../RequestBody';

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

export async function upsertClientInstallation(db: D1Database, body: any) {
  const clientDomain = new URL(body.baseUrl).hostname.split('.')[0];

  const result = await db.prepare(
    `INSERT INTO ClientInstallation (
      key, clientKey, publicKey, sharedSecret, serverVersion, pluginsVersion, baseUrl, clientDomain, productType, description, eventType, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(clientKey, key) DO UPDATE SET
      publicKey = excluded.publicKey,
      sharedSecret = excluded.sharedSecret,
      serverVersion = excluded.serverVersion,
      pluginsVersion = excluded.pluginsVersion,
      baseUrl = excluded.baseUrl,
      clientDomain = excluded.clientDomain,
      productType = excluded.productType,
      description = excluded.description,
      eventType = excluded.eventType,
      timestamp = excluded.timestamp`
  ).bind(
    body.key,
    body.clientKey,
    body.publicKey,
    body.sharedSecret,
    body.serverVersion,
    body.pluginsVersion,
    body.baseUrl,
    clientDomain,
    body.productType,
    body.description,
    body.eventType,
    new Date().toISOString()
  ).run();

  console.log('DB Upsert Result:', result);
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

  // Extract cloudId from context ARI (e.g., ari:cloud:confluence::site/{cloudId})
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
