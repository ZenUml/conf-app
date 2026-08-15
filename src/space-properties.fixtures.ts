/**
 * In-memory stand-in for the Confluence endpoints the byline visibility
 * sweeps touch, for specs.
 *
 * Not a stub that replays canned responses — a tiny model of the API's actual
 * contracts, so the specs fail when the code violates the parts that have
 * burned this feature before:
 *
 * - space property PUT REQUIRES `version.number` to be exactly current+1
 *   (answers 409 otherwise), and POST on an existing key answers 400 — the
 *   documented create/update split;
 * - the APP property endpoint stores the ENTIRE request body as the value
 *   (the behavior observed on staging 2026-08-15 that double-wrapped the
 *   first writer's envelope).
 */

export interface FakeSpaceProperty {
  id: string;
  key: string;
  value: unknown;
  version: number;
}

export interface FakeSite {
  /** Space ids on the site. */
  spaces: string[];
  /** `${spaceId}` -> properties on that space. */
  spaceProps: Map<string, FakeSpaceProperty[]>;
  /** App property store: propertyKey -> stored value. */
  appProps: Map<string, unknown>;
  /** Every request, for call-shape assertions. */
  calls: Array<{ method: string; url: string; body?: unknown }>;
}

export function makeSite(spaces: string[]): FakeSite {
  return { spaces, spaceProps: new Map(), appProps: new Map(), calls: [] };
}

/** Convenience for asserting/arranging state. */
export function propOn(site: FakeSite, spaceId: string, key: string): FakeSpaceProperty | undefined {
  return (site.spaceProps.get(spaceId) ?? []).find((p) => p.key === key);
}

export function setProp(site: FakeSite, spaceId: string, key: string, value: unknown, version = 1): void {
  const list = site.spaceProps.get(spaceId) ?? [];
  site.spaceProps.set(spaceId, [
    ...list.filter((p) => p.key !== key),
    { id: `prop-${spaceId}-${key}`, key, value, version },
  ]);
}

function res(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

/**
 * A `requestConfluence`-shaped function over `site`. Pass `pageSize` to force
 * the spaces listing to paginate with cursor links.
 */
export function fakeConfluence(site: FakeSite, opts: { pageSize?: number } = {}) {
  const pageSize = opts.pageSize ?? 1000;

  return async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    site.calls.push({ method, url, body });

    // --- app properties (whole body is the value; GET returns {key, value})
    const appProp = url.match(/^\/wiki\/api\/v2\/app\/properties\/([^/?]+)$/);
    if (appProp) {
      const key = appProp[1];
      if (method === 'GET') {
        if (!site.appProps.has(key)) return res(404);
        return res(200, { key, value: site.appProps.get(key) });
      }
      if (method === 'PUT') {
        const existed = site.appProps.has(key);
        site.appProps.set(key, body);
        return res(existed ? 200 : 201);
      }
      return res(405);
    }

    // --- spaces listing, paginated
    if (/^\/wiki\/api\/v2\/spaces\?/.test(url)) {
      const cursor = new URL(url, 'https://x.invalid').searchParams.get('cursor');
      const start = cursor ? Number(cursor) : 0;
      const slice = site.spaces.slice(start, start + pageSize);
      const next = start + pageSize < site.spaces.length ? start + pageSize : undefined;
      return res(200, {
        results: slice.map((id) => ({ id })),
        _links: next === undefined ? {} : { next: `/wiki/api/v2/spaces?limit=250&cursor=${next}` },
      });
    }

    // --- space properties
    const propById = url.match(/^\/wiki\/api\/v2\/spaces\/([^/]+)\/properties\/([^/?]+)$/);
    if (propById) {
      const [, spaceId, propId] = propById;
      const list = site.spaceProps.get(spaceId) ?? [];
      const hit = list.find((p) => p.id === propId);
      if (!hit) return res(404);
      if (method === 'PUT') {
        // The documented contract: version.number required, next-in-sequence.
        if (body?.version?.number !== hit.version + 1) return res(409);
        hit.value = body.value;
        hit.version += 1;
        return res(200, { id: hit.id, key: hit.key, value: hit.value, version: { number: hit.version } });
      }
      if (method === 'DELETE') {
        site.spaceProps.set(spaceId, list.filter((p) => p.id !== propId));
        return res(204);
      }
      return res(200, { id: hit.id, key: hit.key, value: hit.value, version: { number: hit.version } });
    }

    const propsOnSpace = url.match(/^\/wiki\/api\/v2\/spaces\/([^/]+)\/properties(\?|$)/);
    if (propsOnSpace) {
      const spaceId = propsOnSpace[1];
      if (!site.spaces.includes(spaceId)) return res(404);
      const list = site.spaceProps.get(spaceId) ?? [];
      if (method === 'GET') {
        const key = new URL(url, 'https://x.invalid').searchParams.get('key');
        const results = (key ? list.filter((p) => p.key === key) : list).map((p) => ({
          id: p.id,
          key: p.key,
          value: p.value,
          version: { number: p.version },
        }));
        return res(200, { results, _links: {} });
      }
      if (method === 'POST') {
        if (list.some((p) => p.key === body?.key)) return res(400);
        setProp(site, spaceId, String(body?.key), body?.value, 1);
        return res(201, { key: body?.key, value: body?.value, version: { number: 1 } });
      }
      return res(405);
    }

    return res(404);
  };
}
