import { D1Database } from '@cloudflare/workers-types';
import { ForgeAppRequestBody } from '../RequestBody';

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
