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
  /** At most PAGES_SHOWN, nearest first. */
  related: RelatedPage[];
  /** Every page the index holds for this name; the circle shows this, `related` is a slice. */
  relatedTotal: number;
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

/** Where a diagram lives now, and which version of it that is. */
export interface LiveContent {
  version: number;
  pageId: string;
}

export type ContentResolver = (contentIds: string[]) => Promise<Map<string, LiveContent>>;

const CQL_BATCH = 100;
const CONTENT_BATCH = 100;

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
 * How many pages one participant lists. A generic name is the interesting case, not the
 * case to hide: `user` sits on 139 pages at the pilot tenant, `database` on 44. Listing
 * the nearest few and stating the remainder keeps the reader oriented and makes the
 * over-general name visible, which is what a person needs before giving it a real name.
 */
export const PAGES_SHOWN = 5;
/**
 * Candidates fetched per participant before the permission filter runs. The filter drops
 * pages the reader cannot open, so asking for exactly PAGES_SHOWN would leave short lists.
 */
const CANDIDATE_DEPTH = PAGES_SHOWN * 4;
/** Ceiling on one lookup's CQL work; CQL_BATCH ids per request. */
const PAGE_BUDGET = 300;

/**
 * Order the candidates: this page first, then this space, then the newest content. The
 * page ranks first because the viewer collapses same-page rows into one line and shows it
 * at the top — a slice taken without that order could cut the nearest position away.
 */
export function usableCandidates(
  candidates: OccurrenceRow[],
  ownSpaceId: string,
  ownPageId?: string,
): OccurrenceRow[] {
  const rank = (row: OccurrenceRow) =>
    (ownPageId && row.pageId === ownPageId ? 0 : row.spaceId === ownSpaceId ? 1 : 2);
  const recency = (row: OccurrenceRow) => {
    const value = Number(row.contentId);
    return Number.isFinite(value) ? value : 0;
  };
  return [...candidates].sort((a, b) => rank(a) - rank(b) || recency(b) - recency(a));
}

/** Distinct pages per comparison key — the number the circle shows. */
export function pageTotalsByKey(candidates: OccurrenceRow[]): Map<string, number> {
  const pages = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    let set = pages.get(candidate.comparisonKey);
    if (!set) pages.set(candidate.comparisonKey, (set = new Set()));
    set.add(candidate.pageId);
  }
  return new Map([...pages].map(([key, set]) => [key, set.size]));
}

/**
 * Only the nearest CANDIDATE_DEPTH diagrams per key have their live version read: a name
 * in 966 diagrams otherwise costs ten sequential 100-id reads (~6.4 s measured) and misses
 * the viewer's 8 s budget. Every row of a kept diagram stays, so the label shown for it is
 * the same one the unbudgeted list would have shown.
 */
function budgetedCandidates(candidates: OccurrenceRow[]): OccurrenceRow[] {
  const kept: OccurrenceRow[] = [];
  const takenByKey = new Map<string, Set<string>>();
  let distinct = 0;
  for (const candidate of candidates) {
    let taken = takenByKey.get(candidate.comparisonKey);
    if (!taken) takenByKey.set(candidate.comparisonKey, (taken = new Set()));
    if (!taken.has(candidate.contentId)) {
      if (taken.size >= CANDIDATE_DEPTH || distinct >= PAGE_BUDGET) continue;
      taken.add(candidate.contentId);
      distinct += 1;
    }
    kept.push(candidate);
  }
  return kept;
}

/**
 * Only the nearest CANDIDATE_DEPTH pages per key reach the CQL permission filter: a name
 * on 139 pages would otherwise cost 34 CQL round trips and miss the viewer's 8s budget.
 */
function budgetedPageIds(candidates: OccurrenceRow[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const perKey = new Map<string, number>();
  for (const candidate of candidates) {
    if (seen.has(candidate.pageId)) continue;
    const taken = perKey.get(candidate.comparisonKey) ?? 0;
    if (taken >= CANDIDATE_DEPTH) continue;
    perKey.set(candidate.comparisonKey, taken + 1);
    seen.add(candidate.pageId);
    ids.push(candidate.pageId);
    if (ids.length >= PAGE_BUDGET) break;
  }
  return ids;
}

/**
 * The index is rebuilt on a cadence, so a row can describe a diagram that has since been
 * edited: content 128483345 was indexed at version 2 and is live at version 56, and the
 * participant the row promised has not been in that diagram for 54 versions. One batched
 * v2 read gives both the current version and the page the diagram sits on now.
 */
export function confluenceContentResolver(
  apiBaseUrl: string,
  forgeOAuthUser: string,
  fetchImpl: typeof fetch = fetch,
): ContentResolver {
  return async (contentIds) => {
    const out = new Map<string, LiveContent>();
    for (let i = 0; i < contentIds.length; i += CONTENT_BATCH) {
      const ids = contentIds
        .slice(i, i + CONTENT_BATCH)
        .map((id) => id.replace(/\D/g, ''))
        .filter(Boolean);
      if (ids.length === 0) continue;

      const query = ids.map((id) => `id=${id}`).join('&');
      const response = await fetchImpl(
        `${apiBaseUrl}/api/v2/custom-content?${query}&limit=${CONTENT_BATCH}`,
        {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${forgeOAuthUser}` },
        },
      );
      if (!response.ok) throw new Error(`confluence custom-content ${response.status}`);

      const body = await response.json() as {
        results?: Array<{ id?: string; pageId?: string; version?: { number?: number } }>;
      };
      for (const result of body.results ?? []) {
        const id = String(result?.id ?? '');
        const version = Number(result?.version?.number);
        const pageId = String(result?.pageId ?? '');
        if (!id || !Number.isFinite(version) || !pageId) continue;
        out.set(id, { version, pageId });
      }
    }
    return out;
  };
}

export async function relatedDiagrams(
  db: D1Database,
  cloudId: string,
  contentId: string,
  resolve: PageResolver,
  resolveContent: ContentResolver,
  ownPageId?: string,
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
    ownPageId,
  );

  // One batched read covers this diagram and the nearest candidates: a row whose live
  // version differs from the indexed one describes a diagram that has changed since, so it
  // is dropped rather than shown. The response also carries where each diagram sits now,
  // which is the page the reader should open. Budgeted first — the full candidate set is
  // only ever counted, never read back from Confluence.
  const nearest = budgetedCandidates(candidates);
  let live: Map<string, LiveContent>;
  try {
    live = await resolveContent([contentId, ...new Set(nearest.map((c) => c.contentId))]);
  } catch {
    return { indexedAt, contentVersion, participants: [], error_kind: 'confluence_unavailable' };
  }

  // Counted before the version and permission filters: the circle answers "how widely is
  // this name used", which the index knows in full and one lookup cannot re-verify.
  const totals = pageTotalsByKey(candidates);

  const self = live.get(contentId);
  if (!self || self.version !== contentVersion) {
    // The index predates this diagram's current text; every row about it is unreliable.
    return { indexedAt, contentVersion, participants: [], error_kind: 'stale_index' };
  }

  const current = nearest.filter((candidate) => {
    const now = live.get(candidate.contentId);
    return now !== undefined && now.version === candidate.contentVersion;
  });
  const pageIds = budgetedPageIds(current.map((candidate) => ({
    ...candidate,
    pageId: live.get(candidate.contentId)!.pageId,
  })));

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
    for (const candidate of current) {
      if (
        candidate.comparisonKey !== occurrence.comparisonKey
        || seen.has(candidate.contentId)
      ) {
        continue;
      }
      // where the diagram sits now, not where it sat when the index was built
      const pageId = live.get(candidate.contentId)!.pageId;
      const page = pages.get(pageId);
      if (!page) continue;

      if (related.length >= PAGES_SHOWN) break;
      seen.add(candidate.contentId);
      related.push({
        contentId: candidate.contentId,
        pageId,
        pageTitle: page.title,
        spaceKey: page.spaceKey,
        rawLabelThere: candidate.rawLabel,
      });
    }
    participants.push({
      actorId,
      rawLabel: occurrence.rawLabel,
      related,
      relatedTotal: totals.get(occurrence.comparisonKey) ?? related.length,
    });
  }

  return { indexedAt, contentVersion, participants };
}
