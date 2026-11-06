import { utcDayStart } from './domain';

export interface DiagramAudienceScope {
  cloudId: string;
  forgeAppId: string;
  customContentId: string;
}

export async function countAudience(db: D1Database, scope: DiagramAudienceScope): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS audienceCount
     FROM DiagramAudience
     WHERE cloudId = ?1 AND forgeAppId = ?2 AND customContentId = ?3`,
  ).bind(scope.cloudId, scope.forgeAppId, scope.customContentId).first<{ audienceCount: number }>();
  return Number(row?.audienceCount ?? 0);
}

export async function isHistoricalContributor(
  db: D1Database,
  input: DiagramAudienceScope & { accountId: string },
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS found
     FROM CustomContentVersion
     WHERE contentId = ?1 AND appId = ?2 AND authorId = ?3
     LIMIT 1`,
  ).bind(input.customContentId, input.forgeAppId, input.accountId).first<{ found: number }>();
  return row?.found === 1;
}

export async function registerAudienceView(
  db: D1Database,
  input: DiagramAudienceScope & { accountId: string; now: Date },
): Promise<'new_unique' | 'repeat'> {
  const existing = await db.prepare(
    `SELECT lastViewedAt
     FROM DiagramAudience
     WHERE cloudId = ?1 AND forgeAppId = ?2 AND customContentId = ?3 AND accountId = ?4`,
  ).bind(input.cloudId, input.forgeAppId, input.customContentId, input.accountId).first<{ lastViewedAt: string }>();

  const nowIso = input.now.toISOString();
  const dayStart = utcDayStart(input.now);

  if (!existing) {
    const result = await db.prepare(
      `INSERT OR IGNORE INTO DiagramAudience (
         cloudId, forgeAppId, customContentId, accountId, firstViewedAt, lastViewedAt, viewDays
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)`,
    ).bind(
      input.cloudId,
      input.forgeAppId,
      input.customContentId,
      input.accountId,
      nowIso,
      nowIso,
    ).run();
    return result.meta.changes === 1 ? 'new_unique' : 'repeat';
  }

  // ISO timestamps sort lexically. A future value is also treated as a repeat
  // without a write, avoiding an accidental backwards clock update.
  if (existing.lastViewedAt >= dayStart) return 'repeat';

  await db.prepare(
    `UPDATE DiagramAudience
     SET lastViewedAt = ?1, viewDays = viewDays + 1
     WHERE cloudId = ?2 AND forgeAppId = ?3 AND customContentId = ?4 AND accountId = ?5
       AND lastViewedAt < ?6`,
  ).bind(
    nowIso,
    input.cloudId,
    input.forgeAppId,
    input.customContentId,
    input.accountId,
    dayStart,
  ).run();
  return 'repeat';
}
