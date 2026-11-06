// "Where diagrams are used" for the Plan and usage page: per space, the pages
// that hold the site's stored diagrams, read as the VIEWER through Forge's
// requestConfluence so Confluence applies the viewer's own space and page
// permissions. Nothing here calls our backend or acts with the app token,
// which also keeps guests and anonymous viewers (no Forge user token, see
// CLAUDE.md) on the same path as everyone else.
//
// What is listed: each diagram's custom-content record and the page that
// record is parented to — the page the diagram was created on. A macro that
// embeds a diagram stored on another page (the Embed macro, or a page copy
// that kept the macro's customContentId) is a placement, not a record, and is
// not enumerated: no viewer-side API lists macro placements without scanning
// page bodies. So a count here is always a count of STORED diagrams.
//
// Cost model: nothing is fetched until a space is opened. One space batch is
// one custom-content page (`limit` records, raw body so the diagram type can
// be read) plus one bulk page lookup per 250 distinct parent ids; "Load more"
// follows Confluence's own `_links.next` cursor, one content type at a time.
import { forgeRequest } from '@/utils/requestUtil';
import { ForgeRequestError } from '@/utils/forgeRequestError';
import { DiagramType } from '@/model/Diagram/Diagram';
import { toMacroType } from '@/utils/byline/pageDiagrams';

/** GET a `/api/v2/...` path (no `/wiki` prefix) as the viewer. */
export type ConfluenceGet = (url: string) => Promise<any>;

/** Production getter: non-2xx throws ForgeRequestError carrying `.status`. */
export const confluenceGet: ConfluenceGet = (url) =>
  forgeRequest(`/wiki${url}`, 'GET', undefined, { throwOnHttpError: true });

export interface SpaceRef {
  id: string;
  key: string;
  name: string;
}

/** One space as `/api/plan-usage` reports it: the KV-stored diagram count and its stamp. */
export interface SpaceSummary {
  spaceKey: string;
  macroCount: number;
  lastUpdated: string | null;
}

export type ContainerKind = 'page' | 'blogpost' | 'space' | 'unknown';

export interface DiagramLocationRow {
  contentId: string;
  diagramTitle: string;
  spaceKey: string;
  spaceName: string;
  /** The stored `diagramType`, or DiagramType.Unknown when the body is unreadable. */
  diagramType: string;
  /** Catalog `macro_type` value for analytics. */
  macroType: string;
  containerKind: ContainerKind;
  /** Page or blog post id, null for space-parented content. */
  pageId: string | null;
  pageTitle: string | null;
  /** Absolute URL when the viewer can read the container, else null. */
  pageUrl: string | null;
  /** `version.createdAt` of the stored diagram, i.e. its last save. */
  updatedAt: string | null;
}

/** Where the next batch continues: the content type index and Confluence's own next link. */
export interface LocationsCursor {
  typeIndex: number;
  nextUrl: string | null;
}

/**
 * `ok` listed at least one row; `empty` found nothing the viewer can list;
 * `forbidden` means Confluence refused the space's custom content for this
 * viewer (403 / 404) — an answer, not a failure. Failures throw.
 */
export type LocationsOutcome = 'ok' | 'empty' | 'forbidden';

export interface LocationsBatch {
  outcome: LocationsOutcome;
  rows: DiagramLocationRow[];
  /** Records whose page the viewer cannot read (or that no longer exists). */
  hiddenCount: number;
  next: LocationsCursor | null;
  /** ISO timestamp of this fetch, for the freshness line. */
  fetchedAt: string;
}

export const DEFAULT_BATCH_SIZE = 25;
const BULK_LOOKUP_SIZE = 250;

function isRefusal(e: unknown): boolean {
  return e instanceof ForgeRequestError && (e.status === 403 || e.status === 404);
}

const SPACE_LOOKUP_SIZE = 250;

/**
 * Resolve space keys to ids and names as the viewer, in the caller's order.
 * Confluence filters the listing to spaces the viewer can see, so a key that
 * comes back missing is simply absent from the result — never named, never
 * counted — which is the permission rule the Diagram-locations screen relies
 * on. A 403 / 404 on the lookup itself resolves nothing; other errors throw.
 */
export async function resolveSpaces(get: ConfluenceGet, spaceKeys: string[]): Promise<SpaceRef[]> {
  const keys = [...new Set(spaceKeys.filter(Boolean))];
  const found = new Map<string, SpaceRef>();
  for (let i = 0; i < keys.length; i += SPACE_LOOKUP_SIZE) {
    const chunk = keys.slice(i, i + SPACE_LOOKUP_SIZE);
    const qs = chunk.map((k) => encodeURIComponent(k)).join(',');
    let res: any;
    try {
      res = await get(`/api/v2/spaces?keys=${qs}&limit=${SPACE_LOOKUP_SIZE}`);
    } catch (e) {
      if (isRefusal(e)) continue;
      throw e;
    }
    for (const s of Array.isArray(res?.results) ? res.results : []) {
      if (!s?.id || typeof s?.key !== 'string') continue;
      found.set(s.key, { id: String(s.id), key: s.key, name: String(s.name ?? '') });
    }
  }
  return keys.map((k) => found.get(k)).filter((s): s is SpaceRef => s !== undefined);
}

function stripWiki(url: string): string {
  return url.startsWith('/wiki') ? url.substring('/wiki'.length) : url;
}

function readDiagramType(item: any): string {
  const raw = item?.body?.raw?.value;
  if (typeof raw !== 'string' || !raw) return DiagramType.Unknown;
  try {
    const parsed = JSON.parse(raw);
    const type = parsed?.diagramType;
    return typeof type === 'string' && type ? type : DiagramType.Unknown;
  } catch {
    return DiagramType.Unknown;
  }
}

interface ContainerInfo {
  title: string;
  url: string | null;
}

/**
 * Bulk-read page (or blog post) titles and web links. The v2 bulk endpoints
 * silently omit ids the viewer cannot read, which is exactly the permission
 * filter this list relies on: an id missing from the map is a hidden row.
 */
async function lookupContainers(
  get: ConfluenceGet,
  kind: 'pages' | 'blogposts',
  ids: string[],
): Promise<Map<string, ContainerInfo>> {
  const found = new Map<string, ContainerInfo>();
  for (let i = 0; i < ids.length; i += BULK_LOOKUP_SIZE) {
    const qs = ids.slice(i, i + BULK_LOOKUP_SIZE).map((id) => `id=${encodeURIComponent(id)}`).join('&');
    const res: any = await get(`/api/v2/${kind}?${qs}&limit=${BULK_LOOKUP_SIZE}`);
    const base: string = typeof res?._links?.base === 'string' ? res._links.base : '';
    for (const p of res?.results ?? []) {
      if (!p?.id) continue;
      const webui: string | undefined = typeof p?._links?.webui === 'string' ? p._links.webui : undefined;
      // `_links.base` is the site's `/wiki` origin; without it fall back to a
      // site-relative path, which router.open still resolves inside Confluence.
      const url = webui ? `${base || '/wiki'}${webui}` : null;
      found.set(String(p.id), { title: String(p.title ?? ''), url });
    }
  }
  return found;
}

function customContentUrl(spaceId: string, type: string, limit: number): string {
  return `/api/v2/spaces/${encodeURIComponent(spaceId)}/custom-content?type=${encodeURIComponent(type)}&body-format=raw&limit=${limit}`;
}

/**
 * Fetch one batch of a space's stored diagrams, resolved to the pages they
 * were created on (their owning pages). `cursor` comes from the previous
 * batch's `next`; null starts from the first content type. A content type that answers with no
 * records is skipped within the same call so the caller never gets an empty
 * batch that still has a `next`.
 */
export async function loadDiagramLocations(
  get: ConfluenceGet,
  opts: {
    space: SpaceRef;
    types: string[];
    cursor?: LocationsCursor | null;
    limit?: number;
    now?: () => Date;
  },
): Promise<LocationsBatch> {
  const limit = opts.limit ?? DEFAULT_BATCH_SIZE;
  const now = opts.now ?? (() => new Date());
  const types = opts.types;
  const fetchedAt = now().toISOString();
  const done = (outcome: LocationsOutcome, rows: DiagramLocationRow[], hiddenCount: number, next: LocationsCursor | null): LocationsBatch =>
    ({ outcome, rows, hiddenCount, next, fetchedAt });

  if (types.length === 0) return done('empty', [], 0, null);

  let cursor: LocationsCursor = opts.cursor ?? { typeIndex: 0, nextUrl: null };
  let items: any[] = [];
  let next: LocationsCursor | null = null;

  // Walk forward until a page carries records or the types run out.
  while (cursor.typeIndex < types.length) {
    const url = cursor.nextUrl ?? customContentUrl(opts.space.id, types[cursor.typeIndex], limit);
    let res: any;
    try {
      res = await get(url);
    } catch (e) {
      if (isRefusal(e)) return done('forbidden', [], 0, null);
      throw e;
    }
    items = Array.isArray(res?.results) ? res.results : [];
    const nextLink = typeof res?._links?.next === 'string' && res._links.next ? stripWiki(res._links.next) : null;
    if (nextLink) {
      next = { typeIndex: cursor.typeIndex, nextUrl: nextLink };
    } else if (cursor.typeIndex + 1 < types.length) {
      next = { typeIndex: cursor.typeIndex + 1, nextUrl: null };
    } else {
      next = null;
    }
    if (items.length > 0 || next === null) break;
    cursor = next;
  }

  const pageIds = [...new Set(items.map((i) => i?.pageId).filter(Boolean).map(String))];
  const blogIds = [...new Set(items.map((i) => i?.blogPostId).filter(Boolean).map(String))];
  const [pages, blogs] = await Promise.all([
    pageIds.length ? lookupContainers(get, 'pages', pageIds) : Promise.resolve(new Map<string, ContainerInfo>()),
    blogIds.length ? lookupContainers(get, 'blogposts', blogIds) : Promise.resolve(new Map<string, ContainerInfo>()),
  ]);

  const rows: DiagramLocationRow[] = [];
  let hiddenCount = 0;
  for (const item of items) {
    if (!item?.id) continue;
    const diagramType = readDiagramType(item);
    const base = {
      contentId: String(item.id),
      diagramTitle: String(item.title ?? ''),
      spaceKey: opts.space.key,
      spaceName: opts.space.name,
      diagramType,
      macroType: toMacroType(diagramType),
      updatedAt: typeof item?.version?.createdAt === 'string' ? item.version.createdAt : null,
    };
    if (item.pageId) {
      const page = pages.get(String(item.pageId));
      if (!page) { hiddenCount++; continue; }
      rows.push({ ...base, containerKind: 'page', pageId: String(item.pageId), pageTitle: page.title, pageUrl: page.url });
    } else if (item.blogPostId) {
      const blog = blogs.get(String(item.blogPostId));
      if (!blog) { hiddenCount++; continue; }
      rows.push({ ...base, containerKind: 'blogpost', pageId: String(item.blogPostId), pageTitle: blog.title, pageUrl: blog.url });
    } else if (item.spaceId) {
      rows.push({ ...base, containerKind: 'space', pageId: null, pageTitle: null, pageUrl: null });
    } else {
      rows.push({ ...base, containerKind: 'unknown', pageId: null, pageTitle: null, pageUrl: null });
    }
  }

  const outcome: LocationsOutcome = rows.length > 0 ? 'ok' : 'empty';
  return done(outcome, rows, hiddenCount, next);
}

/** Short relative age for the freshness and "reported" lines; absolute past 30 days. */
export function describeAge(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'unknown';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'unknown';
  const seconds = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days <= 30) return `${days} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
