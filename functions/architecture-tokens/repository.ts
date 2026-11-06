export interface OccurrenceRow {
  contentId: string;
  pageId: string;
  spaceId: string;
  contentVersion: number;
  actorId: string;
  rawLabel: string;
  comparisonKey: string;
  lineNumber: number;
  indexedAt: string;
}

const COLS = 'contentId, pageId, spaceId, contentVersion, actorId, rawLabel, comparisonKey, lineNumber, indexedAt';

export async function occurrencesForContent(
  db: D1Database,
  cloudId: string,
  contentId: string,
): Promise<OccurrenceRow[]> {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM ArchitectureTokenOccurrence WHERE cloudId = ?1 AND contentId = ?2`)
    .bind(cloudId, contentId)
    .all<OccurrenceRow>();
  return results ?? [];
}

export async function occurrencesForKeys(
  db: D1Database,
  cloudId: string,
  keys: string[],
): Promise<OccurrenceRow[]> {
  if (keys.length === 0) return [];
  const placeholders = keys.map((_, i) => `?${i + 2}`).join(', ');
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM ArchitectureTokenOccurrence WHERE cloudId = ?1 AND comparisonKey IN (${placeholders})`)
    .bind(cloudId, ...keys)
    .all<OccurrenceRow>();
  return results ?? [];
}
