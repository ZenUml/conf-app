import {
  occurrencesForContent,
  occurrencesForKeys,
  type OccurrenceRow,
} from './repository';

export interface RelatedPage {
  contentId: string;
  pageId: string;
  pageTitle: string;
  spaceKey: string;
  rawLabelThere: string;
}

export interface RelatedParticipant {
  actorId: string;
  rawLabel: string;
  related: RelatedPage[];
}

export interface RelatedResponse {
  indexedAt: string | null;
  contentVersion: number | null;
  participants: RelatedParticipant[];
  error_kind?: string;
}

export interface ConfluencePageInfo {
  id: string;
  title: string;
  spaceKey: string;
}

export type PageResolver = (pageIds: string[]) => Promise<ConfluencePageInfo[]>;

const CQL_BATCH = 100;

/**
 * Permission filter, as the requesting user: one CQL `id in (...)` per 100 ids.
 * Confluence returns only pages the bearer can read, with titles. Nothing
 * about pages omitted from that response reaches the caller.
 */
export function confluencePageResolver(
  apiBaseUrl: string,
  forgeOAuthUser: string,
  fetchImpl: typeof fetch = fetch,
): PageResolver {
  return async (pageIds) => {
    const out: ConfluencePageInfo[] = [];
    for (let i = 0; i < pageIds.length; i += CQL_BATCH) {
      const ids = pageIds
        .slice(i, i + CQL_BATCH)
        .map((id) => id.replace(/\D/g, ''))
        .filter(Boolean);
      if (ids.length === 0) continue;

      const cql = `type = page AND id in (${ids.join(',')})`;
      const url = `${apiBaseUrl}/rest/api/search?cql=${encodeURIComponent(cql)}&limit=${CQL_BATCH}&expand=content.space`;
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${forgeOAuthUser}`,
        },
      });
      if (!response.ok) throw new Error(`confluence search ${response.status}`);

      const body = await response.json() as {
        results?: Array<{
          content?: {
            id?: string;
            title?: string;
            space?: { key?: string };
          };
        }>;
      };
      for (const result of body.results ?? []) {
        if (result.content?.id) {
          out.push({
            id: String(result.content.id),
            title: result.content.title ?? '',
            spaceKey: result.content.space?.key ?? '',
          });
        }
      }
    }
    return out;
  };
}

function byActor(rows: OccurrenceRow[]): Map<string, OccurrenceRow> {
  const declarations = new Map<string, OccurrenceRow>();
  for (const row of rows) {
    if (!declarations.has(row.actorId)) declarations.set(row.actorId, row);
  }
  return declarations;
}

/**
 * A name that recurs across a large part of the tenant carries no information about the
 * object — `DB`, `API`, `OrderController` land on hundreds of unrelated diagrams. Above
 * this many distinct pages the key is dropped whole: no rows, no circle, not counted.
 * Truncating such a key to a few rows would present noise as a relation.
 */
export const NOISE_PAGE_THRESHOLD = 50;
/** Ceiling on one lookup's CQL work; CQL_BATCH ids per request. */
const PAGE_BUDGET = 300;

/** Drop noisy keys, then order what remains: this space first, newest content first. */
export function usableCandidates(
  candidates: OccurrenceRow[],
  ownSpaceId: string,
): OccurrenceRow[] {
  const pagesByKey = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    let pages = pagesByKey.get(candidate.comparisonKey);
    if (!pages) pagesByKey.set(candidate.comparisonKey, (pages = new Set()));
    pages.add(candidate.pageId);
  }

  const rank = (row: OccurrenceRow) => (row.spaceId === ownSpaceId ? 0 : 1);
  const recency = (row: OccurrenceRow) => {
    const value = Number(row.contentId);
    return Number.isFinite(value) ? value : 0;
  };
  return candidates
    .filter((candidate) => (pagesByKey.get(candidate.comparisonKey)?.size ?? 0) <= NOISE_PAGE_THRESHOLD)
    .sort((a, b) => rank(a) - rank(b) || recency(b) - recency(a));
}

function budgetedPageIds(candidates: OccurrenceRow[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.pageId)) continue;
    seen.add(candidate.pageId);
    ids.push(candidate.pageId);
    if (ids.length >= PAGE_BUDGET) break;
  }
  return ids;
}

export async function relatedDiagrams(
  db: D1Database,
  cloudId: string,
  contentId: string,
  resolve: PageResolver,
): Promise<RelatedResponse> {
  const own = await occurrencesForContent(db, cloudId, contentId);
  if (own.length === 0) {
    return { indexedAt: null, contentVersion: null, participants: [] };
  }

  const indexedAt = own[0].indexedAt;
  const contentVersion = own[0].contentVersion;
  const keys = [...new Set(own.map((occurrence) => occurrence.comparisonKey))];
  const candidates = usableCandidates(
    (await occurrencesForKeys(db, cloudId, keys))
      .filter((candidate) => candidate.contentId !== contentId),
    own[0].spaceId,
  );
  const pageIds = budgetedPageIds(candidates);

  let pages: Map<string, ConfluencePageInfo>;
  try {
    pages = new Map((await resolve(pageIds)).map((page) => [page.id, page]));
  } catch {
    return {
      indexedAt,
      contentVersion,
      participants: [],
      error_kind: 'confluence_unavailable',
    };
  }

  const participants: RelatedParticipant[] = [];
  for (const [actorId, occurrence] of byActor(own)) {
    const seen = new Set<string>();
    const related: RelatedPage[] = [];
    for (const candidate of candidates) {
      if (
        candidate.comparisonKey !== occurrence.comparisonKey
        || seen.has(candidate.contentId)
      ) {
        continue;
      }
      const page = pages.get(candidate.pageId);
      if (!page) continue;

      seen.add(candidate.contentId);
      related.push({
        contentId: candidate.contentId,
        pageId: candidate.pageId,
        pageTitle: page.title,
        spaceKey: page.spaceKey,
        rawLabelThere: candidate.rawLabel,
      });
    }
    participants.push({ actorId, rawLabel: occurrence.rawLabel, related });
  }

  return { indexedAt, contentVersion, participants };
}
