import api, { route } from '@forge/api';

/**
 * Space-property maintenance shared by the two byline visibility sweeps
 * (src/byline-visibility.ts writes `zenuml-byline-lite` from the Lite app,
 * src/full-presence.ts writes `zenuml-full-active` from the Full app).
 *
 * v2 space properties are the mechanism the byline `displayConditions` reads,
 * and they differ from the app-properties API this feature used first in two
 * ways that shaped this module:
 *
 * - The write contract is DOCUMENTED and versioned: POST `{key, value}` to
 *   create, PUT `{key, value, version: {number}}` on the property id to
 *   update, `version.number` required on update. No body-is-the-value
 *   surprise — the envelope is the schema.
 * - Properties are per space and site-global across creators: the list
 *   endpoint "returns all properties for the given space" regardless of which
 *   app wrote them. That is what lets the LITE app's display condition react
 *   to a marker written by the FULL app.
 */

/** One page of /wiki/api/v2 results. */
interface Page<T> {
  results?: T[];
  _links?: { next?: unknown };
}

interface SpaceRecord {
  id?: unknown;
}

interface SpacePropertyRecord {
  id?: unknown;
  key?: unknown;
  value?: unknown;
  version?: { number?: unknown };
}

/**
 * Cursor for the next page, or undefined when done. Same contract as
 * macro-count-snapshot's pagination: `_links.next` is a relative URL whose
 * `cursor` query param is the token.
 */
function nextCursor(page: Page<unknown>): string | undefined {
  const link = page._links?.next;
  if (typeof link !== 'string' || !link) return undefined;
  try {
    return new URL(link, 'https://confluence.invalid').searchParams.get('cursor') ?? undefined;
  } catch {
    return undefined;
  }
}

async function readJson(res: { text(): Promise<string> }): Promise<unknown> {
  const body = await res.text().catch(() => '');
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/**
 * Every space id on the site, across pages.
 *
 * Throws on a non-2xx page rather than returning a partial list: the callers
 * write fail-closed state per space, and a silently truncated list would read
 * as "the other spaces are settled" instead of "we don't know".
 */
export async function listSpaceIds(): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  // Page count bound, not space count: a runaway `_links.next` loop must not
  // spin a scheduled function for its whole timeout.
  for (let page = 0; page < 200; page++) {
    const res = await api
      .asApp()
      .requestConfluence(
        cursor
          ? route`/wiki/api/v2/spaces?limit=250&cursor=${cursor}`
          : route`/wiki/api/v2/spaces?limit=250`,
        { headers: { accept: 'application/json' } },
      );
    if (!res.ok) {
      throw new Error(`space listing failed: HTTP ${res.status}`);
    }
    const parsed = (await readJson(res)) as Page<SpaceRecord> | undefined;
    for (const s of parsed?.results ?? []) {
      if (s?.id !== undefined && s?.id !== null) ids.push(String(s.id));
    }
    cursor = parsed ? nextCursor(parsed) : undefined;
    if (!cursor) break;
  }
  return ids;
}

export interface SpacePropertyState {
  found: boolean;
  id?: string;
  value?: unknown;
  versionNumber?: number;
  status: number;
}

/** The property with `key` on `spaceId`, keyed lookup. */
export async function getSpaceProperty(spaceId: string, key: string): Promise<SpacePropertyState> {
  const res = await api
    .asApp()
    .requestConfluence(route`/wiki/api/v2/spaces/${spaceId}/properties?key=${key}`, {
      headers: { accept: 'application/json' },
    });
  if (!res.ok) return { found: false, status: res.status };
  const parsed = (await readJson(res)) as Page<SpacePropertyRecord> | undefined;
  const hit = (parsed?.results ?? []).find((p) => p?.key === key);
  if (!hit) return { found: false, status: res.status };
  const version = hit.version?.number;
  return {
    found: true,
    id: hit.id === undefined || hit.id === null ? undefined : String(hit.id),
    value: hit.value,
    versionNumber: typeof version === 'number' ? version : undefined,
    status: res.status,
  };
}

export type EnsureResult = 'created' | 'updated' | 'unchanged' | 'failed';

/**
 * Make the property on `spaceId` exist with exactly `value`.
 *
 * Read-first is not an optimisation: 'unchanged' is the expected steady state
 * of both sweeps, and without it every tick would PUT to every space on every
 * installation. Value comparison is by JSON serialisation — the values here
 * are small fixed objects the same code writes, not arbitrary user data.
 */
export async function ensureSpaceProperty(
  spaceId: string,
  key: string,
  value: unknown,
): Promise<EnsureResult> {
  const current = await getSpaceProperty(spaceId, key);
  if (current.found && JSON.stringify(current.value) === JSON.stringify(value)) {
    return 'unchanged';
  }
  if (!current.found) {
    const res = await api
      .asApp()
      .requestConfluence(route`/wiki/api/v2/spaces/${spaceId}/properties`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
    return res.ok ? 'created' : 'failed';
  }
  if (!current.id) return 'failed';
  const res = await api
    .asApp()
    .requestConfluence(route`/wiki/api/v2/spaces/${spaceId}/properties/${current.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        value,
        version: { number: (current.versionNumber ?? 0) + 1 },
      }),
    });
  return res.ok ? 'updated' : 'failed';
}

export type RemoveResult = 'deleted' | 'absent' | 'failed';

/** Remove the property from `spaceId`; absence reads as success. */
export async function removeSpaceProperty(spaceId: string, key: string): Promise<RemoveResult> {
  const current = await getSpaceProperty(spaceId, key);
  if (!current.found) return 'absent';
  if (!current.id) return 'failed';
  const res = await api
    .asApp()
    .requestConfluence(route`/wiki/api/v2/spaces/${spaceId}/properties/${current.id}`, {
      method: 'DELETE',
    });
  return res.ok ? 'deleted' : 'failed';
}

/** Tally of a sweep across spaces, for the one-line log each handler emits. */
export interface SweepTally {
  spaces: number;
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  absent: number;
  failed: number;
}

export function emptyTally(): SweepTally {
  return { spaces: 0, created: 0, updated: 0, unchanged: 0, deleted: 0, absent: 0, failed: 0 };
}

export function formatTally(t: SweepTally): string {
  return (
    `spaces=${t.spaces} created=${t.created} updated=${t.updated} ` +
    `unchanged=${t.unchanged} deleted=${t.deleted} absent=${t.absent} failed=${t.failed}`
  );
}
