import { D1Database } from '@cloudflare/workers-types';

export async function upsertClientInstallation(db: D1Database, body: any) {
  const clientDomain = new URL(body.baseUrl).hostname.split('.')[0];

  const result = await db.prepare(
    `INSERT INTO ClientInstallation (
      key, clientKey, publicKey, sharedSecret, serverVersion, pluginsVersion, baseUrl, clientDomain, productType, description, eventType, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(clientKey) DO UPDATE SET
      key = excluded.key,
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
