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
  /** At most PAGES_SHOWN distinct pages, nearest first; one page can hold several diagrams. */
  related: RelatedPage[];
  /** Every page the index holds for this name; the circle shows this, `related` is a slice. */
  relatedTotal: number;
}

export interface RelatedResponse {
  lookup_outcome?: 'indexed' | 'index_miss';
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
  spaceId?: string;
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
/** Ceiling on one lookup's live-version and CQL work. */
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
 * Choose at most `limit` distinct ids while giving every key another candidate in each
 * round. With one key this can backfill through the whole lookup budget; with fifteen it
 * gives each key twenty attempts. Rows stay in the original nearest-first order.
 */
function roundRobinIds(
  candidates: OccurrenceRow[],
  idOf: (candidate: OccurrenceRow) => string,
  limit: number,
): string[] {
  const idsByKey = new Map<string, string[]>();
  const seenByKey = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    let ids = idsByKey.get(candidate.comparisonKey);
    let seen = seenByKey.get(candidate.comparisonKey);
    if (!ids || !seen) {
      idsByKey.set(candidate.comparisonKey, (ids = []));
      seenByKey.set(candidate.comparisonKey, (seen = new Set()));
    }
    const id = idOf(candidate);
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  const selected: string[] = [];
  const selectedSet = new Set<string>();
  const positions = new Map<string, number>();
  let progressed = true;
  while (selected.length < limit && progressed) {
    progressed = false;
    for (const [key, ids] of idsByKey) {
      let position = positions.get(key) ?? 0;
      while (position < ids.length && selectedSet.has(ids[position])) position += 1;
      positions.set(key, position);
      if (position >= ids.length) continue;
      const id = ids[position];
      positions.set(key, position + 1);
      selectedSet.add(id);
      selected.push(id);
      progressed = true;
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

/**
 * At most PAGE_BUDGET diagrams have their live version read. Every occurrence row for a
 * selected diagram stays, so the label returned for it is not changed by the budget.
 * Cover a distinct indexed page for every key before spending remaining slots on extra
 * diagrams from an already-covered page; otherwise duplicate pageIds can consume a key's
 * whole share before later page positions have a chance to pass the live filters.
 */
function budgetedCandidates(candidates: OccurrenceRow[]): OccurrenceRow[] {
  const pagesByKey = new Map<string, Array<{ contentIds: string[]; seen: Set<string> }>>();
  const pageGroupsByKey = new Map<string, Map<string, { contentIds: string[]; seen: Set<string> }>>();
  for (const candidate of candidates) {
    let pages = pagesByKey.get(candidate.comparisonKey);
    let groups = pageGroupsByKey.get(candidate.comparisonKey);
    if (!pages || !groups) {
      pagesByKey.set(candidate.comparisonKey, (pages = []));
      pageGroupsByKey.set(candidate.comparisonKey, (groups = new Map()));
    }
    let group = groups.get(candidate.pageId);
    if (!group) {
      group = { contentIds: [], seen: new Set() };
      groups.set(candidate.pageId, group);
      pages.push(group);
    }
    if (!group.seen.has(candidate.contentId)) {
      group.seen.add(candidate.contentId);
      group.contentIds.push(candidate.contentId);
    }
  }

  const selectedIds: string[] = [];
  const selected = new Set<string>();
  const pagePositions = new Map<string, number>();
  let visitedPage = true;
  while (selectedIds.length < PAGE_BUDGET && visitedPage) {
    visitedPage = false;
    for (const [key, pages] of pagesByKey) {
      const position = pagePositions.get(key) ?? 0;
      if (position >= pages.length) continue;
      visitedPage = true;
      pagePositions.set(key, position + 1);
      const id = pages[position].contentIds.find((contentId) => !selected.has(contentId));
      if (id) {
        selected.add(id);
        selectedIds.push(id);
      }
      if (selectedIds.length >= PAGE_BUDGET) break;
    }
  }

  if (selectedIds.length < PAGE_BUDGET) {
    const remaining = candidates.filter((candidate) => !selected.has(candidate.contentId));
    for (const id of roundRobinIds(
      remaining,
      (candidate) => candidate.contentId,
      PAGE_BUDGET - selectedIds.length,
    )) {
      selected.add(id);
      selectedIds.push(id);
    }
  }
  return candidates.filter((candidate) => selected.has(candidate.contentId));
}

/**
 * Only PAGE_BUDGET distinct live pages reach the as-user permission filter. The per-key
 * share is selected before this call, but the five-page slice is taken only after it.
 */
function budgetedPageIds(candidates: OccurrenceRow[]): string[] {
  return roundRobinIds(candidates, (candidate) => candidate.pageId, PAGE_BUDGET);
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
        results?: Array<{
          id?: string;
          pageId?: string;
          spaceId?: string;
          version?: { number?: number };
        }>;
      };
      for (const result of body.results ?? []) {
        const id = String(result?.id ?? '');
        const version = Number(result?.version?.number);
        const pageId = String(result?.pageId ?? '');
        const spaceId = String(result?.spaceId ?? '');
        if (!id || !Number.isFinite(version) || !pageId) continue;
        out.set(id, { version, pageId, ...(spaceId && { spaceId }) });
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
    return {
      lookup_outcome: 'index_miss',
      indexedAt: null,
      contentVersion: null,
      participants: [],
    };
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

  // A bounded read covers this diagram and the nearest candidates: a row whose live
  // version differs from the indexed one describes a diagram that has changed since, so it
  // is dropped rather than shown. The response also carries where each diagram sits now,
  // which is the page the reader should open. The budget is shared across keys, and the
  // display slice is taken only after version and permission filtering so invalid nearer
  // candidates can be backfilled.
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

  const current = usableCandidates(
    nearest
      .filter((candidate) => {
        const now = live.get(candidate.contentId);
        return now !== undefined && now.version === candidate.contentVersion;
      })
      .map((candidate) => ({
        ...candidate,
        pageId: live.get(candidate.contentId)!.pageId,
        spaceId: live.get(candidate.contentId)!.spaceId ?? candidate.spaceId,
      })),
    self.spaceId ?? own[0].spaceId,
    ownPageId ?? self.pageId,
  );
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
    const seenContent = new Set<string>();
    const includedPages = new Set<string>();
    const related: RelatedPage[] = [];
    for (const candidate of current) {
      if (
        candidate.comparisonKey !== occurrence.comparisonKey
        || seenContent.has(candidate.contentId)
      ) {
        continue;
      }
      // where the diagram sits now, not where it sat when the index was built
      const pageId = live.get(candidate.contentId)!.pageId;
      const page = pages.get(pageId);
      if (!page) continue;

      if (!includedPages.has(pageId) && includedPages.size >= PAGES_SHOWN) continue;
      includedPages.add(pageId);
      seenContent.add(candidate.contentId);
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

  return { lookup_outcome: 'indexed', indexedAt, contentVersion, participants };
}
