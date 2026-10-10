// list_diagrams on a site like zenuml.atlassian.net: several ZenUML apps
// installed, and pages carrying only Connect-era macros. It used to refuse
// there (2026-10-05), because it ran the create-time identity resolve to learn
// a variant the custom-content type already proves.

import { describe, it, expect } from 'vitest';
import { callHeadlessTool, type HeadlessContext } from './headlessTools';
import { saveGrant, type GrantStore } from './tokenStore';
import type { FetchLike } from './atlassianClient';

const ACCOUNT = '712020:abc';
const CLOUD = 'cloud-1';

const LITE_SEQ = 'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence';
const DIAGRAMLY = 'ac:gptdock-confluence:gpt-custom-content-key';

function memoryStore(): GrantStore {
  const kv = new Map<string, string>();
  return {
    get: async (k) => kv.get(k) ?? null,
    put: async (k, v) => {
      kv.set(k, v);
    },
    delete: async (k) => {
      kv.delete(k);
    },
  };
}

/** `content` maps a custom-content type to its rows; every page holds only a Connect-era macro. */
function fakeConfluence(content: Record<string, Array<Record<string, unknown>>>, failStatus?: number) {
  const calls: string[] = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    if (url === 'https://api.atlassian.com/oauth/token/accessible-resources') {
      return json(200, [{ id: CLOUD, name: 'One', url: 'https://one.atlassian.net', scopes: [] }]);
    }
    if (url.includes('/custom-content?type=')) {
      if (failStatus) return json(failStatus, {});
      const type = new URL(url).searchParams.get('type') ?? '';
      const rows = content[type];
      return rows ? json(200, { results: rows }) : json(404, {});
    }
    if (url.includes('/wiki/api/v2/pages/')) {
      const adf = {
        type: 'doc',
        content: [
          {
            type: 'extension',
            attrs: { extensionType: 'com.atlassian.confluence.macro.core', extensionKey: 'zenuml-sequence-macro-lite' },
          },
        ],
      };
      return json(200, { body: { atlas_doc_format: { value: JSON.stringify(adf) } } });
    }
    return new Response(`unexpected ${url}`, { status: 500 });
  };
  return { fetchImpl, calls };
}

async function contextFor(content: Record<string, Array<Record<string, unknown>>>, failStatus?: number) {
  const store = memoryStore();
  await saveGrant(store, 'grant-key', ACCOUNT, {
    accessToken: 'at-1',
    refreshToken: 'rt-1',
    accessTokenExpiresAtMs: Date.now() + 3_600_000,
    scope: 'read:custom-content:confluence',
  });
  const { fetchImpl, calls } = fakeConfluence(content, failStatus);
  const ctx: HeadlessContext = {
    store,
    secret: 'grant-key',
    app: { clientId: 'c', clientSecret: 's', redirectUri: 'https://x/cb' },
    fetchImpl,
    userId: ACCOUNT,
  };
  return { ctx, calls };
}

const row = (id: string, type: string, modified: string) => ({
  id,
  title: `Diagram ${id}`,
  type,
  pageId: `page-${id}`,
  version: { createdAt: modified },
});

describe('list_diagrams', () => {
  it('lists a site whose pages hold only Connect-era macros, without reading any page', async () => {
    const { ctx, calls } = await contextFor({ [LITE_SEQ]: [row('1', LITE_SEQ, '2026-10-01T00:00:00Z')] });
    const result = (await callHeadlessTool('list_diagrams', { cloudId: CLOUD }, ctx)) as any;
    expect(result.variants).toEqual(['lite']);
    expect(result.diagrams.map((d: any) => d.contentId)).toEqual(['1']);
    expect(calls.some((c) => c.includes('/wiki/api/v2/pages/'))).toBe(false);
  });

  it('lists every installed variant, newest first across them', async () => {
    const { ctx } = await contextFor({
      [LITE_SEQ]: [row('1', LITE_SEQ, '2026-10-01T00:00:00Z')],
      [DIAGRAMLY]: [row('2', DIAGRAMLY, '2026-10-04T00:00:00Z')],
    });
    const result = (await callHeadlessTool('list_diagrams', { cloudId: CLOUD }, ctx)) as any;
    expect(result.variants).toEqual(['lite', 'diagramly']);
    expect(result.diagrams.map((d: any) => d.contentId)).toEqual(['2', '1']);
  });

  it('asks Confluence for the most recently modified rows', async () => {
    const { ctx, calls } = await contextFor({ [LITE_SEQ]: [row('1', LITE_SEQ, '2026-10-01T00:00:00Z')] });
    await callHeadlessTool('list_diagrams', { cloudId: CLOUD, limit: 10 }, ctx);
    const listing = calls.filter((c) => c.includes('limit=10'));
    expect(listing.length).toBeGreaterThan(0);
    for (const url of listing) expect(url).toContain('sort=-modified-date');
  });

  it('says the site has no diagrams when no ZenUML content exists', async () => {
    const { ctx } = await contextFor({});
    await expect(callHeadlessTool('list_diagrams', { cloudId: CLOUD }, ctx)).rejects.toMatchObject({
      message: expect.stringMatching(/No ZenUML diagrams were found/),
    });
  });

  it('reports a Confluence failure as retryable, not as an empty site', async () => {
    const { ctx } = await contextFor({}, 403);
    await expect(callHeadlessTool('list_diagrams', { cloudId: CLOUD }, ctx)).rejects.toMatchObject({
      message: expect.stringMatching(/Could not reach Confluence.*403/),
    });
  });
});
