import { describe, it, expect } from 'vitest';
import { confluenceReaderFor } from './confluenceReader';
import { saveGrant, type GrantStore } from './tokenStore';
import type { AtlassianAppConfig, AtlassianGrant, FetchLike } from './atlassianClient';
import { resolveMacroIdentity, VARIANTS } from '../macroIdentity';

const SECRET = 'worker-secret';
const NOW = 1_800_000_000_000;
const APP: AtlassianAppConfig = { clientId: 'c', clientSecret: 's', redirectUri: 'https://x/cb' };
const LITE = VARIANTS.find((v) => v.variant === 'lite')!;

function memoryStore(): GrantStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(k) {
      return data.get(k) ?? null;
    },
    async put(k, v) {
      data.set(k, v);
    },
    async delete(k) {
      data.delete(k);
    },
  };
}

function grant(over: Partial<AtlassianGrant> = {}): AtlassianGrant {
  return {
    accessToken: 'at-1',
    refreshToken: 'rt-1',
    accessTokenExpiresAtMs: Date.now() + 3600_000,
    scope: '',
    ...over,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('confluenceReaderFor', () => {
  it('routes through the api.atlassian.com gateway with the cloudId in the path', async () => {
    const store = memoryStore();
    await saveGrant(store, SECRET, 'u1', grant());
    const seen: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      seen.push(url);
      return json(200, { ok: true });
    };

    const read = confluenceReaderFor({ store, secret: SECRET, app: APP, fetchImpl, userId: 'u1', cloudId: 'cloud-9' });
    await read('/wiki/api/v2/custom-content?type=x');

    expect(seen[0]).toBe('https://api.atlassian.com/ex/confluence/cloud-9/wiki/api/v2/custom-content?type=x');
  });

  it('sends the access token as a bearer', async () => {
    const store = memoryStore();
    await saveGrant(store, SECRET, 'u1', grant({ accessToken: 'at-xyz' }));
    let headers: any;
    const fetchImpl: FetchLike = async (_u, init) => {
      headers = init?.headers;
      return json(200, {});
    };
    await confluenceReaderFor({ store, secret: SECRET, app: APP, fetchImpl, userId: 'u1', cloudId: 'c' })('/p');
    expect(headers.Authorization).toBe('Bearer at-xyz');
  });

  it('passes status and body through untouched', async () => {
    const store = memoryStore();
    await saveGrant(store, SECRET, 'u1', grant());
    const fetchImpl: FetchLike = async () => json(404, { errors: ['nope'] });
    const result = await confluenceReaderFor({
      store, secret: SECRET, app: APP, fetchImpl, userId: 'u1', cloudId: 'c',
    })('/p');
    expect(result).toEqual({ status: 404, body: { errors: ['nope'] } });
  });

  it('reports 401 when the user has no grant, without calling Confluence', async () => {
    const store = memoryStore();
    let called = false;
    const fetchImpl: FetchLike = async () => {
      called = true;
      return json(200, {});
    };
    const result = await confluenceReaderFor({
      store, secret: SECRET, app: APP, fetchImpl, userId: 'nobody', cloudId: 'c',
    })('/p');
    expect(result.status).toBe(401);
    expect(called).toBe(false);
  });

  it('reports 503 — not 401 — when a refresh fails transiently', async () => {
    // The resolver treats any non-2xx, non-404 as probe_failed, so both land
    // right; the distinction matters for the caller deciding whether to tell
    // the user to re-authorize.
    const store = memoryStore();
    await saveGrant(store, SECRET, 'u1', grant({ accessTokenExpiresAtMs: NOW - 1 }));
    const fetchImpl: FetchLike = async () => json(503, { error: 'service_unavailable' });
    const result = await confluenceReaderFor({
      store, secret: SECRET, app: APP, fetchImpl, userId: 'u1', cloudId: 'c',
    })('/p');
    expect(result.status).toBe(503);
  });

  it('turns a thrown fetch into a failed probe rather than letting it escape', async () => {
    const store = memoryStore();
    await saveGrant(store, SECRET, 'u1', grant());
    const fetchImpl: FetchLike = async () => {
      throw new Error('ECONNRESET');
    };
    const result = await confluenceReaderFor({
      store, secret: SECRET, app: APP, fetchImpl, userId: 'u1', cloudId: 'c',
    })('/p');
    expect(result.status).toBe(503);
  });

  it('tolerates a non-JSON body, keeping the status', async () => {
    const store = memoryStore();
    await saveGrant(store, SECRET, 'u1', grant());
    const fetchImpl: FetchLike = async () => new Response('<html>oops</html>', { status: 500 });
    const result = await confluenceReaderFor({
      store, secret: SECRET, app: APP, fetchImpl, userId: 'u1', cloudId: 'c',
    })('/p');
    expect(result).toEqual({ status: 500, body: null });
  });
});

describe('OAuth reader feeding the Phase 1 resolver', () => {
  it('resolves a site identity end to end over a grant', async () => {
    // The point of ConfluenceGet being an interface: the resolver that was
    // built and live-verified before OAuth existed runs unchanged here.
    const store = memoryStore();
    await saveGrant(store, SECRET, 'u1', grant());
    const extensionKey = `${LITE.appId}/11111111-2222-3333-4444-555555555555/static/zenuml-sequence-macro-lite`;

    const fetchImpl: FetchLike = async (url) => {
      if (url.includes('custom-content')) {
        const type = decodeURIComponent(new URL(url).searchParams.get('type') ?? '');
        if (type === 'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence') {
          return json(200, { results: [{ id: '5', pageId: '7' }] });
        }
        return json(404, null);
      }
      if (url.includes('/pages/7')) {
        return json(200, {
          body: {
            atlas_doc_format: {
              value: JSON.stringify({
                type: 'doc',
                content: [
                  {
                    type: 'extension',
                    attrs: { extensionKey, parameters: { guestParams: { customContentId: '5' } } },
                  },
                ],
              }),
            },
          },
        });
      }
      return json(404, null);
    };

    const read = confluenceReaderFor({
      store, secret: SECRET, app: APP, fetchImpl, userId: 'u1', cloudId: 'cloud-9',
    });
    const result = await resolveMacroIdentity(read);

    expect(result).toEqual({
      ok: true,
      source: 'discovered',
      identity: {
        appId: LITE.appId,
        environmentId: '11111111-2222-3333-4444-555555555555',
        variant: 'lite',
      },
    });
  });

  it('reports probe_failed, not an empty site, when the grant is missing', async () => {
    // A user who never authorized must not be told their tenant has no
    // diagrams — that would send them to insert a macro they already have.
    const store = memoryStore();
    const fetchImpl: FetchLike = async () => json(200, {});
    const read = confluenceReaderFor({
      store, secret: SECRET, app: APP, fetchImpl, userId: 'nobody', cloudId: 'c',
    });
    expect(await resolveMacroIdentity(read)).toMatchObject({ ok: false, reason: 'probe_failed' });
  });
});
