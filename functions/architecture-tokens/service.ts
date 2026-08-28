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

/** At most PAGES_PER_KEY pages per comparison key, and one CQL batch overall. */
export const PAGES_PER_KEY = 24;
const PAGE_BUDGET = 100;

export function cappedPageIds(candidates: OccurrenceRow[]): string[] {
  const perKey = new Map<string, Set<string>>();
  const ordered: string[] = [];
  const taken = new Set<string>();
  for (const candidate of candidates) {
    let pages = perKey.get(candidate.comparisonKey);
    if (!pages) perKey.set(candidate.comparisonKey, (pages = new Set()));
    if (pages.size >= PAGES_PER_KEY || taken.has(candidate.pageId)) continue;
    pages.add(candidate.pageId);
    taken.add(candidate.pageId);
    ordered.push(candidate.pageId);
    if (ordered.length >= PAGE_BUDGET) break;
  }
  return ordered;
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
  const candidates = (await occurrencesForKeys(db, cloudId, keys))
    .filter((candidate) => candidate.contentId !== contentId);

  // A generic name recurs across a whole tenant: on lite-stg `order.controller` reaches
  // 3,388 pages, which is 34 CQL round trips and misses the viewer's 8s budget, so the
  // lookup times out and the reader sees nothing at all. Resolve at most one CQL batch,
  // taken per key so one common name cannot crowd out the rest.
  const pageIds = cappedPageIds(candidates);

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
