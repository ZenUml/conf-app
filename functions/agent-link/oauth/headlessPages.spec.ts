// The page tools. As with the diagram writes, the cases worth pinning are the
// refusals: a truncating body, a page someone edited after you read it, and a
// space you cannot write to.

import { describe, it, expect } from 'vitest';
import { callHeadlessTool, type HeadlessContext } from './headlessTools';
import { saveGrant, type GrantStore } from './tokenStore';
import type { FetchLike } from './atlassianClient';

const ACCOUNT = '712020:abc';
const CLOUD = 'cloud-1';
const BASE = 'https://one.atlassian.net/wiki';
/** Long enough to clear the guard's floor, so truncation is actually testable. */
const CURRENT_BODY = `<p>${'Some existing prose that the page already carries. '.repeat(6)}</p>`;

interface FakePage {
  id: string;
  title: string;
  version: number;
  spaceId: string;
  body: string;
  status?: string;
  parentId?: string;
}

interface FakeSite {
  pages: Map<string, FakePage>;
  nextId: number;
  force?: Record<string, number>;
}

function fakeConfluence(site: FakeSite) {
  const calls: Array<{ method: string; url: string; body: any }> = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const pageResponse = (page: FakePage, withBody: boolean) => ({
    id: page.id,
    title: page.title,
    spaceId: page.spaceId,
    status: page.status ?? 'current',
    version: { number: page.version },
    ...(withBody ? { body: { storage: { value: page.body } } } : {}),
    _links: {
      base: BASE,
      webui: `/spaces/DESIGN/pages/${page.id}/${encodeURIComponent(page.title)}`,
    },
  });

  const fetchImpl: FetchLike = async (url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    if (method !== 'GET') calls.push({ method, url, body });

    for (const [key, status] of Object.entries(site.force ?? {})) {
      const [m, fragment] = key.split(' ');
      if (m === method && url.includes(fragment)) {
        return json(status, status === 409 ? { message: 'Version must be incremented' } : { message: 'forced' });
      }
    }

    if (url === 'https://api.atlassian.com/oauth/token/accessible-resources') {
      return json(200, [{ id: CLOUD, name: 'One', url: 'https://one.atlassian.net', scopes: [] }]);
    }

    const readMatch = /\/wiki\/api\/v2\/pages\/([^?]+)/.exec(url);
    if (readMatch && method === 'GET') {
      const page = site.pages.get(readMatch[1]);
      return page ? json(200, pageResponse(page, url.includes('body-format=storage'))) : json(404, {});
    }
    if (readMatch && method === 'PUT') {
      const page = site.pages.get(readMatch[1]);
      if (!page) return json(404, {});
      page.title = body.title;
      page.body = body.body.value;
      page.version = body.version.number;
      return json(200, pageResponse(page, false));
    }
    if (method === 'POST' && url.endsWith('/wiki/api/v2/pages')) {
      // Confluence enforces title uniqueness within a space.
      if ([...site.pages.values()].some((p) => p.title === body.title && p.spaceId === body.spaceId)) {
        return json(400, { errors: [{ title: 'A page with this title already exists' }] });
      }
      const id = String(site.nextId++);
      const page: FakePage = {
        id,
        title: body.title,
        version: 1,
        spaceId: body.spaceId,
        body: body.body.value,
        status: body.status,
        parentId: body.parentId,
      };
      site.pages.set(id, page);
      return json(200, pageResponse(page, false));
    }
    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  };

  return { fetchImpl, calls };
}

function memoryStore(): GrantStore {
  const kv = new Map<string, string>();
  return {
    get: async (k) => kv.get(k) ?? null,
    put: async (k, v) => { kv.set(k, v); },
    delete: async (k) => { kv.delete(k); },
  };
}

async function contextFor(site: FakeSite) {
  const store = memoryStore();
  await saveGrant(store, 'grant-key', ACCOUNT, {
    accessToken: 'at-1',
    refreshToken: 'rt-1',
    accessTokenExpiresAtMs: Date.now() + 3_600_000,
    scope: 'write:page:confluence',
  });
  const { fetchImpl, calls } = fakeConfluence(site);
  const ctx: HeadlessContext = {
    store,
    secret: 'grant-key',
    app: { clientId: 'c', clientSecret: 's', redirectUri: 'https://x/cb' },
    fetchImpl,
    userId: ACCOUNT,
  };
  return { ctx, calls };
}

function oneParent(): FakeSite {
  return {
    nextId: 100,
    pages: new Map([
      ['page-1', { id: 'page-1', title: 'Design notes', version: 4, spaceId: 'space-1', body: CURRENT_BODY }],
    ]),
  };
}

describe('read_page', () => {
  it('returns the body, version and a URL a human can open', async () => {
    const site = oneParent();
    const { ctx } = await contextFor(site);
    const out = (await callHeadlessTool('read_page', { cloudId: CLOUD, pageId: 'page-1' }, ctx)) as any;
    expect(out.title).toBe('Design notes');
    expect(out.version).toBe(4);
    expect(out.spaceKey).toBe('DESIGN');
    expect(out.body).toBe(CURRENT_BODY);
    expect(out.url).toBe(`${BASE}/spaces/DESIGN/pages/page-1/Design%20notes`);
  });

  it('reports a missing page as not_found, not as an upstream error', async () => {
    const site = oneParent();
    const { ctx } = await contextFor(site);
    await expect(callHeadlessTool('read_page', { cloudId: CLOUD, pageId: 'nope' }, ctx)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('create_page', () => {
  it('creates a child page in the parent\'s space', async () => {
    const site = oneParent();
    const { ctx } = await contextFor(site);
    const out = (await callHeadlessTool(
      'create_page',
      { cloudId: CLOUD, parentPageId: 'page-1', title: 'API design', body: '<p>Hello</p>' },
      ctx,
    )) as any;
    expect(out.result).toBe('added');
    const created = site.pages.get(out.pageId)!;
    expect(created.spaceId).toBe('space-1'); // inherited, never asked for
    expect(created.parentId).toBe('page-1');
    expect(created.status).toBe('current');
    expect(created.body).toBe('<p>Hello</p>');
  });

  it('can leave the page as a draft for a human to publish', async () => {
    const site = oneParent();
    const { ctx } = await contextFor(site);
    const out = (await callHeadlessTool(
      'create_page',
      { cloudId: CLOUD, parentPageId: 'page-1', title: 'Draft idea', body: '<p>x</p>', draft: true },
      ctx,
    )) as any;
    expect(site.pages.get(out.pageId)!.status).toBe('draft');
  });

  it('explains a duplicate title rather than reporting a bare 400', async () => {
    const site = oneParent();
    const { ctx } = await contextFor(site);
    await expect(
      callHeadlessTool(
        'create_page',
        { cloudId: CLOUD, parentPageId: 'page-1', title: 'Design notes', body: '<p>x</p>' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'bad_params' });
  });

  it('reports a space the user cannot add pages to as forbidden', async () => {
    const site = oneParent();
    site.force = { 'POST /wiki/api/v2/pages': 403 };
    const { ctx } = await contextFor(site);
    await expect(
      callHeadlessTool('create_page', { cloudId: CLOUD, parentPageId: 'page-1', title: 'X', body: '<p>x</p>' }, ctx),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses before writing when the parent cannot be read', async () => {
    const site = oneParent();
    const { ctx, calls } = await contextFor(site);
    await expect(
      callHeadlessTool('create_page', { cloudId: CLOUD, parentPageId: 'ghost', title: 'X', body: '<p>x</p>' }, ctx),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(calls).toHaveLength(0);
  });
});

describe('update_page', () => {
  it('replaces the body and publishes one version naming the agent', async () => {
    const site = oneParent();
    const { ctx } = await contextFor(site);
    const next = `${CURRENT_BODY}<p>And one more paragraph.</p>`;
    const out = (await callHeadlessTool(
      'update_page',
      { cloudId: CLOUD, pageId: 'page-1', body: next, summary: 'add a section' },
      ctx,
    )) as any;
    expect(out.result).toBe('updated');
    expect(out.version).toBe(5);
    const page = site.pages.get('page-1')!;
    expect(page.body).toBe(next);
    expect(page.version).toBe(5);
  });

  it('keeps the current title unless a new one is given', async () => {
    const site = oneParent();
    const { ctx } = await contextFor(site);
    await callHeadlessTool('update_page', { cloudId: CLOUD, pageId: 'page-1', body: CURRENT_BODY }, ctx);
    expect(site.pages.get('page-1')!.title).toBe('Design notes');

    await callHeadlessTool(
      'update_page',
      { cloudId: CLOUD, pageId: 'page-1', body: CURRENT_BODY, title: 'Design notes v2' },
      ctx,
    );
    expect(site.pages.get('page-1')!.title).toBe('Design notes v2');
  });

  it('refuses a body that looks like accidental truncation', async () => {
    const site = oneParent();
    const { ctx, calls } = await contextFor(site);
    await expect(
      callHeadlessTool('update_page', { cloudId: CLOUD, pageId: 'page-1', body: '<p>Just my new bit.</p>' }, ctx),
    ).rejects.toMatchObject({ code: 'guardrail_rejected' });
    expect(calls).toHaveLength(0);
    expect(site.pages.get('page-1')!.body).toBe(CURRENT_BODY);
  });

  it('refuses when the caller\'s version is stale, before writing', async () => {
    const site = oneParent();
    const { ctx, calls } = await contextFor(site);
    // The caller read v3; the page is at v4 — somebody edited in between, and
    // writing now would silently overwrite an edit they never saw.
    await expect(
      callHeadlessTool(
        'update_page',
        { cloudId: CLOUD, pageId: 'page-1', body: `${CURRENT_BODY}<p>more</p>`, version: 3 },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(calls).toHaveLength(0);
    expect(site.pages.get('page-1')!.version).toBe(4);
  });

  it('accepts a version that still matches', async () => {
    const site = oneParent();
    const { ctx } = await contextFor(site);
    const out = (await callHeadlessTool(
      'update_page',
      { cloudId: CLOUD, pageId: 'page-1', body: `${CURRENT_BODY}<p>more</p>`, version: 4 },
      ctx,
    )) as any;
    expect(out.version).toBe(5);
  });

  it('reports a concurrent edit found at write time as a conflict', async () => {
    const site = oneParent();
    site.force = { 'PUT /wiki/api/v2/pages/page-1': 409 };
    const { ctx } = await contextFor(site);
    await expect(
      callHeadlessTool('update_page', { cloudId: CLOUD, pageId: 'page-1', body: `${CURRENT_BODY}<p>x</p>` }, ctx),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('reports a read-only user as forbidden', async () => {
    const site = oneParent();
    site.force = { 'PUT /wiki/api/v2/pages/page-1': 403 };
    const { ctx } = await contextFor(site);
    await expect(
      callHeadlessTool('update_page', { cloudId: CLOUD, pageId: 'page-1', body: `${CURRENT_BODY}<p>x</p>` }, ctx),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
