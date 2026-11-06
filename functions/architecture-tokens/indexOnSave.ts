/**
 * Save-time maintenance of ArchitectureTokenOccurrence for ONE diagram.
 *
 * Why this exists: the table was populated only by the manual local pipeline
 * (tools/architecture-tokens/upload-index.mjs), which replaces a tenant's rows
 * per run. Between runs every edited diagram drifts, and service.ts fails the
 * lookup with `error_kind: 'stale_index'` when the live version no longer
 * matches the indexed one. Measured 2026-09-02 on one tenant: 98 of 98 lookup
 * failures were stale_index, from 2 actively edited diagrams; refreshing the
 * index took one of them from 43 failures to 8 successes / 0 failures in the
 * next hour, and the other drifted again within minutes of the refresh.
 *
 * Writing here means the indexed version is the version just saved, so the
 * stale branch cannot fire for content saved through Forge.
 *
 * NOT covered: content created through the Confluence REST API never reaches
 * the Forge save handler, so it still needs the batch pipeline.
 */
import { extractParticipants, extractZenUmlParticipants } from '../../tools/architecture-tokens/extract';
import {
  lexicalComparisonKey,
  lexicalGroupingToken,
} from '../../tools/architecture-tokens/pilot/participant-normalization.mjs';

export interface OccurrenceRow {
  cloudId: string;
  spaceId: string;
  contentId: string;
  pageId: string;
  contentVersion: number;
  actorId: string;
  rawLabel: string;
  comparisonKey: string;
  declKind: string;
  lineNumber: number;
  runId: string;
  indexedAt: string;
}

const segments = (key: string) => key.split('.').length;

/**
 * `extract-corpus.mjs` picks, per grouping token, the most segmented dotted form
 * across the WHOLE corpus (`miniappcli` -> `mini.app.cli`). A single save cannot
 * see the corpus, so the tenant's existing rows stand in for it: the grouping
 * token is recoverable from any stored key by removing the dots. Without this,
 * a save would write `miniappcli` next to the batch's `mini.app.cli` and the two
 * would stop grouping together, fragmenting the index with no error.
 *
 * Tie-break is copied from preferredDottedKeys: more segments wins, then
 * localeCompare, so both writers converge on the same key.
 */
export function preferComparisonKey(localKey: string, storedKeys: string[]): string {
  const token = localKey.split('.').join('');
  let best = localKey;
  for (const stored of storedKeys) {
    if (stored.split('.').join('') !== token) continue;
    if (segments(stored) > segments(best)
      || (segments(stored) === segments(best) && stored.localeCompare(best) < 0)) {
      best = stored;
    }
  }
  return best;
}

/** Diagram JSON as stored in CustomContent.body -> `$.raw.value` (a string). */
export function readDiagramSource(body: any): { diagramType: string; code: string } | null {
  const rawValue = body?.raw?.value;
  if (typeof rawValue !== 'string') return null;
  let parsed: any;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return null;
  }
  const diagramType = parsed?.diagramType;
  if (diagramType === 'mermaid' && typeof parsed?.mermaidCode === 'string') {
    return { diagramType, code: parsed.mermaidCode };
  }
  if (diagramType === 'sequence' && typeof parsed?.code === 'string') {
    return { diagramType, code: parsed.code };
  }
  return null;
}

export function buildOccurrenceRows(input: {
  cloudId: string; contentId: string; spaceId: string; pageId: string;
  contentVersion: number; runId: string; indexedAt: string;
  diagramType: string; code: string;
  preferred: Map<string, string>;
}): OccurrenceRow[] {
  const { diagramType, code } = input;
  const participants = diagramType === 'mermaid'
    ? extractParticipants(code)
    : extractZenUmlParticipants(code);

  // Same anchor de-duplication as extract-corpus.mjs: (sourceId, actorId,
  // lineNumber) is the occurrence primary key, and the last declaration wins to
  // match Mermaid actor-map semantics.
  const byAnchor = new Map<string, (typeof participants)[number]>();
  for (const p of participants) byAnchor.set(`${p.actorId} ${p.lineNumber}`, p);

  return [...byAnchor.values()].map((p) => {
    const localKey = lexicalComparisonKey(p.rawLabel);
    const stored = input.preferred.get(lexicalGroupingToken(p.rawLabel));
    return {
      cloudId: input.cloudId,
      spaceId: input.spaceId,
      contentId: input.contentId,
      pageId: input.pageId,
      contentVersion: input.contentVersion,
      actorId: p.actorId,
      rawLabel: p.rawLabel,
      comparisonKey: preferComparisonKey(localKey, stored ? [stored] : []),
      declKind: p.declKind,
      lineNumber: p.lineNumber,
      runId: input.runId,
      indexedAt: input.indexedAt,
    };
  });
}

export type IndexResult =
  | { indexed: true; rows: number }
  | { indexed: false; reason: 'no_cloud_id' | 'not_a_diagram' | 'write_failed'; detail?: string };

/**
 * Replace this diagram's rows. Never throws: the caller's save must not fail
 * because a derived index could not be written, since Confluence is the system
 * of record. The outcome is returned so the caller can log it.
 */
export async function indexDiagramOnSave(
  db: any, cloudId: string | null, content: any,
): Promise<IndexResult> {
  if (!cloudId) return { indexed: false, reason: 'no_cloud_id' };

  const contentId = String(content?.id ?? '');
  if (!contentId) return { indexed: false, reason: 'not_a_diagram' };

  const source = readDiagramSource(content?.body);
  const indexedAt = new Date().toISOString();
  const contentVersion = Number(content?.version?.number ?? 0);
  const runId = `save:${contentVersion}`;
  const common = {
    cloudId,
    contentId,
    spaceId: String(content?.spaceId ?? ''),
    pageId: String(content?.pageId ?? ''),
    contentVersion,
    runId,
    indexedAt,
  };

  let rows: OccurrenceRow[] = [];
  if (source) {
    const draft = buildOccurrenceRows({
      ...common,
      diagramType: source.diagramType,
      code: source.code,
      preferred: new Map(),
    });
    // One batched lookup of the tenant's existing forms for the tokens in THIS
    // diagram, so the key matches whatever the batch pipeline already chose.
    const tokens = [...new Set(draft.map((r) => r.comparisonKey.split('.').join('')))];
    const preferred = new Map<string, string>();
    if (tokens.length > 0) {
      try {
        const placeholders = tokens.map((_, i) => `?${i + 2}`).join(',');
        const { results } = await db
          .prepare(
            'SELECT DISTINCT comparisonKey FROM ArchitectureTokenOccurrence '
            + `WHERE cloudId = ?1 AND REPLACE(comparisonKey, '.', '') IN (${placeholders})`,
          )
          .bind(cloudId, ...tokens)
          .all();
        for (const row of results ?? []) {
          const stored = String((row as { comparisonKey: string }).comparisonKey);
          const token = stored.split('.').join('');
          preferred.set(token, preferComparisonKey(preferred.get(token) ?? stored, [stored]));
        }
      } catch (e) {
        // A failed preference lookup degrades the key choice only; the indexed
        // version is still correct, which is what stale_index turns on.
        console.warn('architecture-tokens: preferred-key lookup failed', e);
      }
    }
    rows = buildOccurrenceRows({
      ...common,
      diagramType: source.diagramType,
      code: source.code,
      preferred,
    });
  }

  // The DELETE runs even with zero rows: a diagram that stopped being a sequence
  // diagram must lose its stale rows rather than keep them forever.
  const statements = [
    db.prepare('DELETE FROM ArchitectureTokenOccurrence WHERE cloudId = ?1 AND contentId = ?2')
      .bind(cloudId, contentId),
  ];
  for (const r of rows) {
    statements.push(
      db.prepare(
        'INSERT INTO ArchitectureTokenOccurrence '
        + '(cloudId, spaceId, contentId, pageId, contentVersion, actorId, rawLabel, '
        + 'comparisonKey, declKind, lineNumber, runId, indexedAt) '
        + 'VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)',
      ).bind(
        r.cloudId, r.spaceId, r.contentId, r.pageId, r.contentVersion, r.actorId,
        r.rawLabel, r.comparisonKey, r.declKind, r.lineNumber, r.runId, r.indexedAt,
      ),
    );
  }

  try {
    await db.batch(statements);
    return { indexed: true, rows: rows.length };
  } catch (e) {
    return {
      indexed: false,
      reason: 'write_failed',
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
