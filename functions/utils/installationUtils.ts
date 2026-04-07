export async function getForgeInstallationFromD1(db: D1Database, forgeCloudId: string) {
  return await db.prepare(
    `SELECT * FROM ForgeInstallation WHERE context like '%' || ?`
  ).bind(forgeCloudId).first();
}
