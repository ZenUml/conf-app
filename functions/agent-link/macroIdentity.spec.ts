import { describe, it, expect } from 'vitest';
import {
  VARIANTS,
  customContentTypesFor,
  parseExtensionKey,
  macroKeyFor,
  extensionKeyFor,
  extensionNodesIn,
  resolveMacroIdentity,
  resolveMacroIdentityCached,
  identityCacheKey,
  IDENTITY_CACHE_TTL_SECONDS,
  type ConfluenceGet,
  type IdentityStore,
  type MacroIdentity,
} from './macroIdentity';

const LITE = VARIANTS.find((v) => v.variant === 'lite')!;
const FULL = VARIANTS.find((v) => v.variant === 'full')!;
const DIAGRAMLY = VARIANTS.find((v) => v.variant === 'diagramly')!;
const ASYNCAPI = VARIANTS.find((v) => v.variant === 'asyncapi')!;

const ENV_ID = '11111111-2222-3333-4444-555555555555';

function keyFor(appId: string, macroKey: string, envId = ENV_ID): string {
  return `${appId}/${envId}/static/${macroKey}`;
}

/** An ADF document holding one Forge macro node, in the shape buildMacroNode writes. */
function pageAdf(extensionKey: string, customContentId: string): string {
  return JSON.stringify({
    type: 'doc',
    version: 1,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'intro' }] },
      {
        type: 'extension',
        attrs: {
          layout: 'default',
          extensionType: 'com.atlassian.ecosystem',
          extensionKey,
          parameters: {
            layout: 'extension',
            extensionId: `ari:cloud:ecosystem::extension/${extensionKey}`,
            guestParams: { customContentId, updatedAt: '2026-09-19T00:00:00.000Z' },
          },
          localId: 'abc',
        },
      },
    ],
  });
}

/**
 * A fake site. `customContent` maps a fully-qualified type to its rows; `pages`
 * maps a pageId to its ADF string. Anything unlisted 404s, which is what
 * Confluence does for a custom-content type the site's app never registered.
 */
function fakeSite(opts: {
  customContent?: Record<string, Array<{ id: string; pageId: string }>>;
  pages?: Record<string, string>;
  fail?: (path: string) => number | undefined;
}): { get: ConfluenceGet; calls: string[] } {
  const calls: string[] = [];
  const get: ConfluenceGet = async (path) => {
    calls.push(path);
    const forced = opts.fail?.(path);
    if (forced) return { status: forced, body: null };

    if (path.startsWith('/wiki/api/v2/custom-content')) {
      const type = decodeURIComponent(new URL(path, 'https://x').searchParams.get('type') ?? '');
      const rows = opts.customContent?.[type];
      if (!rows) return { status: 404, body: null };
      return { status: 200, body: { results: rows } };
    }
    if (path.startsWith('/wiki/api/v2/pages/')) {
      const pageId = path.split('/wiki/api/v2/pages/')[1].split('?')[0];
      const adf = opts.pages?.[pageId];
      if (adf === undefined) return { status: 404, body: null };
      return { status: 200, body: { body: { atlas_doc_format: { value: adf } } } };
    }
    return { status: 404, body: null };
  };
  return { get, calls };
}

function memoryStore(): IdentityStore & { data: Map<string, string>; puts: number } {
  const data = new Map<string, string>();
  return {
    data,
    puts: 0,
    async get(key) {
      return data.get(key) ?? null;
    },
    async put(key, value) {
      this.puts += 1;
      data.set(key, value);
    },
  };
}

describe('variant table', () => {
  it('gives every variant a distinct appId and connect key', () => {
    const appIds = VARIANTS.map((v) => v.appId);
    const connectKeys = VARIANTS.map((v) => v.connectKey);
    expect(new Set(appIds).size).toBe(VARIANTS.length);
    expect(new Set(connectKeys).size).toBe(VARIANTS.length);
  });

  it('builds ac:<connectKey>:<contentKey> custom-content types', () => {
    expect(customContentTypesFor(LITE)).toEqual([
      'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence',
      'ac:com.zenuml.confluence-addon-lite:zenuml-content-graph',
    ]);
    expect(customContentTypesFor(ASYNCAPI)).toEqual(['ac:my-api:async-api-doc']);
    expect(customContentTypesFor(DIAGRAMLY)).toEqual(['ac:gptdock-confluence:gpt-custom-content-key']);
  });

  it('no two variants share a custom-content type', () => {
    // The whole discovery strategy rests on the type identifying the variant.
    const all = VARIANTS.flatMap(customContentTypesFor);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('parseExtensionKey', () => {
  it('splits a well-formed key', () => {
    expect(parseExtensionKey(keyFor(LITE.appId, 'zenuml-sequence-macro-lite'))).toEqual({
      appId: LITE.appId,
      environmentId: ENV_ID,
      macroKey: 'zenuml-sequence-macro-lite',
    });
  });

  it('rejects malformed keys rather than yielding half an identity', () => {
    // The lite->full conversion incident (addToPage.ts header) was a malformed
    // key that still got written. Each of these must be a null, not a partial.
    for (const bad of [
      '',
      'not-a-key',
      `${LITE.appId}/static/zenuml-sequence-macro`, // missing environmentId
      `${LITE.appId}/${ENV_ID}/zenuml-sequence-macro`, // missing /static/
      `ari:cloud:ecosystem::extension/${LITE.appId}/${ENV_ID}/static/x`, // the extensionId, not the key
      `${LITE.appId}/${ENV_ID}/static/`, // no macro key
      `/${LITE.appId}/${ENV_ID}/static/x`,
      `${LITE.appId}/not-a-uuid/static/x`,
      undefined,
      null,
      42,
    ]) {
      expect(parseExtensionKey(bad as unknown)).toBeNull();
    }
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseExtensionKey(`  ${keyFor(FULL.appId, 'zenuml-graph-macro')}  `)).not.toBeNull();
  });
});

describe('macroKeyFor', () => {
  const lite: MacroIdentity = { appId: LITE.appId, environmentId: ENV_ID, variant: 'lite' };
  const full: MacroIdentity = { appId: FULL.appId, environmentId: ENV_ID, variant: 'full' };
  const dia: MacroIdentity = { appId: DIAGRAMLY.appId, environmentId: ENV_ID, variant: 'diagramly' };
  const async: MacroIdentity = { appId: ASYNCAPI.appId, environmentId: ENV_ID, variant: 'asyncapi' };

  it('shares one macro across the text-DSL family', () => {
    for (const type of ['sequence', 'mermaid', 'plantuml']) {
      expect(macroKeyFor(lite, type)).toBe('zenuml-sequence-macro-lite');
      expect(macroKeyFor(full, type)).toBe('zenuml-sequence-macro');
    }
  });

  it('applies the -lite suffix only on lite', () => {
    expect(macroKeyFor(lite, 'graph')).toBe('zenuml-graph-macro-lite');
    expect(macroKeyFor(full, 'graph')).toBe('zenuml-graph-macro');
  });

  it('uses each variant own diagram macro', () => {
    expect(macroKeyFor(dia, 'sequence')).toBe('gpt-diagram-macro');
    expect(macroKeyFor(async, 'asyncapi')).toBe('zenuml-asyncapi-macro');
  });

  it('keeps openapi on asyncapi, because that variant ships both API editors', () => {
    // CLAUDE.md, Product variants: the asyncapi manifest strip keeps
    // zenuml-openapi-macro alongside the asyncapi macros.
    expect(macroKeyFor(async, 'openapi')).toBe('zenuml-openapi-macro');
    expect(macroKeyFor(lite, 'openapi')).toBe('zenuml-openapi-macro-lite');
  });

  it('returns null for a macro the variant does not ship', () => {
    expect(macroKeyFor(dia, 'graph')).toBeNull();
    expect(macroKeyFor(dia, 'openapi')).toBeNull();
    expect(macroKeyFor(async, 'graph')).toBeNull();
    expect(macroKeyFor(lite, 'asyncapi')).toBeNull();
    expect(macroKeyFor(lite, 'nonsense')).toBeNull();
  });

  it('folds case', () => {
    expect(macroKeyFor(lite, 'OpenAPI')).toBe('zenuml-openapi-macro-lite');
    expect(macroKeyFor(async, 'AsyncAPI')).toBe('zenuml-asyncapi-macro');
  });

  it('composes a full extensionKey that round-trips through parseExtensionKey', () => {
    const key = extensionKeyFor(lite, 'mermaid');
    expect(key).toBe(keyFor(LITE.appId, 'zenuml-sequence-macro-lite'));
    expect(parseExtensionKey(key)).toEqual({
      appId: LITE.appId,
      environmentId: ENV_ID,
      macroKey: 'zenuml-sequence-macro-lite',
    });
  });

  it('returns null rather than a half-built key for an unshipped macro', () => {
    expect(extensionKeyFor(dia, 'graph')).toBeNull();
  });
});

describe('extensionNodesIn', () => {
  it('finds a nested extension node and its customContentId', () => {
    const adf = {
      type: 'doc',
      content: [
        {
          type: 'layoutSection',
          content: [
            {
              type: 'layoutColumn',
              content: [
                {
                  type: 'extension',
                  attrs: {
                    extensionKey: keyFor(LITE.appId, 'zenuml-sequence-macro-lite'),
                    parameters: { guestParams: { customContentId: '999' } },
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    expect(extensionNodesIn(adf)).toEqual([
      { extensionKey: keyFor(LITE.appId, 'zenuml-sequence-macro-lite'), customContentId: '999' },
    ]);
  });

  it('reads the kebab spelling the create-test-page script writes', () => {
    const adf = {
      content: [
        {
          type: 'extension',
          attrs: {
            extensionKey: keyFor(FULL.appId, 'zenuml-graph-macro'),
            parameters: { guestParams: { 'custom-content-id': 123 } },
          },
        },
      ],
    };
    expect(extensionNodesIn(adf)[0].customContentId).toBe('123');
  });

  it('returns a node with no binding rather than skipping it', () => {
    // A key we can parse is useful even when the node names no custom content.
    const adf = { content: [{ type: 'extension', attrs: { extensionKey: 'x/y/static/z' } }] };
    expect(extensionNodesIn(adf)).toEqual([{ extensionKey: 'x/y/static/z', customContentId: undefined }]);
  });

  it('ignores non-extension nodes and malformed input', () => {
    expect(extensionNodesIn({ type: 'doc', content: [{ type: 'paragraph' }] })).toEqual([]);
    expect(extensionNodesIn(null)).toEqual([]);
    expect(extensionNodesIn('nonsense')).toEqual([]);
    expect(extensionNodesIn({ content: [{ type: 'extension', attrs: {} }] })).toEqual([]);
  });
});

describe('resolveMacroIdentity', () => {
  it('identifies a Lite site and lifts its environmentId', async () => {
    const { get } = fakeSite({
      customContent: {
        'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence': [{ id: '55', pageId: '77' }],
      },
      pages: { '77': pageAdf(keyFor(LITE.appId, 'zenuml-sequence-macro-lite'), '55') },
    });
    const result = await resolveMacroIdentity(get);
    expect(result).toEqual({
      ok: true,
      source: 'discovered',
      identity: { appId: LITE.appId, environmentId: ENV_ID, variant: 'lite' },
    });
  });

  it('identifies Diagramly, whose single content key would miss the lite/full probes', async () => {
    // #524: probing only the lite/full types returned nothing on Diagramly.
    const { get } = fakeSite({
      customContent: { 'ac:gptdock-confluence:gpt-custom-content-key': [{ id: '1', pageId: '2' }] },
      pages: { '2': pageAdf(keyFor(DIAGRAMLY.appId, 'gpt-diagram-macro'), '1') },
    });
    const result = await resolveMacroIdentity(get);
    expect(result.ok && result.identity.variant).toBe('diagramly');
  });

  it('identifies AsyncAPI under its inherited ac:my-api type', async () => {
    const { get } = fakeSite({
      customContent: { 'ac:my-api:async-api-doc': [{ id: '1', pageId: '2' }] },
      pages: { '2': pageAdf(keyFor(ASYNCAPI.appId, 'zenuml-asyncapi-macro'), '1') },
    });
    const result = await resolveMacroIdentity(get);
    expect(result.ok && result.identity.variant).toBe('asyncapi');
  });

  it('lifts the environmentId even when the sampled node is a different macro type', async () => {
    // The point of composing rather than lifting the macro key: a graph macro
    // on the page still tells us the appId and environmentId.
    const otherEnv = '99999999-8888-7777-6666-555555555555';
    const { get } = fakeSite({
      customContent: {
        'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence': [{ id: '5', pageId: '7' }],
      },
      pages: { '7': pageAdf(keyFor(LITE.appId, 'zenuml-graph-macro-lite', otherEnv), '5') },
    });
    const result = await resolveMacroIdentity(get);
    expect(result.ok && result.identity.environmentId).toBe(otherEnv);
    expect(result.ok && extensionKeyFor(result.identity, 'mermaid')).toBe(
      keyFor(LITE.appId, 'zenuml-sequence-macro-lite', otherEnv),
    );
  });

  it('refuses with no_macro_on_site when nothing is installed', async () => {
    const { get } = fakeSite({});
    expect(await resolveMacroIdentity(get)).toEqual({ ok: false, reason: 'no_macro_on_site' });
  });

  it('refuses with no_extension_node when custom content is orphaned', async () => {
    // ZEN-1170 territory: the content exists, but its page 404s or no macro
    // references it. Distinct from an empty site because the remedy differs.
    const { get } = fakeSite({
      customContent: {
        'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence': [{ id: '5', pageId: '7' }],
      },
      pages: { '7': JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }) },
    });
    const result = await resolveMacroIdentity(get);
    expect(result).toMatchObject({ ok: false, reason: 'no_extension_node' });
  });

  it('refuses with app_id_mismatch when the two signals disagree', async () => {
    // A Lite-typed custom content on a page whose macro node claims the Full
    // appId. Something is wrong with our assumptions; picking one would be a
    // guess, and a wrong guess publishes a broken macro.
    const { get } = fakeSite({
      customContent: {
        'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence': [{ id: '5', pageId: '7' }],
      },
      pages: { '7': pageAdf(keyFor(FULL.appId, 'zenuml-sequence-macro'), '5') },
    });
    const result = await resolveMacroIdentity(get);
    expect(result).toMatchObject({ ok: false, reason: 'app_id_mismatch' });
    expect(result.ok).toBe(false);
  });

  it('reports probe_failed rather than an empty site when Confluence errors', async () => {
    // A 403 across the board must never read as "this tenant has no diagrams" —
    // that is the difference between retrying and telling the user to go insert
    // a macro by hand.
    const { get } = fakeSite({ fail: (p) => (p.includes('custom-content') ? 403 : undefined) });
    const result = await resolveMacroIdentity(get);
    expect(result).toMatchObject({ ok: false, reason: 'probe_failed' });
  });

  it('treats a 404 on an unknown type as "not this variant", not a failure', async () => {
    // Only the asyncapi type resolves; the other probes 404. The site is still
    // identified rather than reported as a probe failure.
    const { get } = fakeSite({
      customContent: { 'ac:my-api:async-api-doc': [{ id: '1', pageId: '2' }] },
      pages: { '2': pageAdf(keyFor(ASYNCAPI.appId, 'zenuml-asyncapi-macro'), '1') },
    });
    const result = await resolveMacroIdentity(get);
    expect(result.ok).toBe(true);
  });

  it('samples past a dead hit to a live one', async () => {
    const { get } = fakeSite({
      customContent: {
        'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence': [
          { id: '1', pageId: 'gone' },
          { id: '2', pageId: 'alive' },
        ],
      },
      pages: { alive: pageAdf(keyFor(LITE.appId, 'zenuml-sequence-macro-lite'), '2') },
    });
    const result = await resolveMacroIdentity(get);
    expect(result.ok && result.identity.variant).toBe('lite');
  });

  it('stops probing once a variant resolves', async () => {
    const { get, calls } = fakeSite({
      customContent: {
        'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence': [{ id: '5', pageId: '7' }],
      },
      pages: { '7': pageAdf(keyFor(LITE.appId, 'zenuml-sequence-macro-lite'), '5') },
    });
    await resolveMacroIdentity(get);
    expect(calls.some((c) => c.includes('my-api'))).toBe(false);
    expect(calls.some((c) => c.includes('gptdock'))).toBe(false);
  });
});

describe('resolveMacroIdentityCached', () => {
  const site = () =>
    fakeSite({
      customContent: {
        'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence': [{ id: '5', pageId: '7' }],
      },
      pages: { '7': pageAdf(keyFor(LITE.appId, 'zenuml-sequence-macro-lite'), '5') },
    });

  it('resolves once, then serves from cache', async () => {
    const store = memoryStore();
    const first = site();
    const a = await resolveMacroIdentityCached(first.get, 'cloud-1', store);
    expect(a).toMatchObject({ ok: true, source: 'discovered' });

    const second = site();
    const b = await resolveMacroIdentityCached(second.get, 'cloud-1', store);
    expect(b).toMatchObject({ ok: true, source: 'cached' });
    expect(second.calls).toEqual([]);
  });

  it('keys the cache per cloudId', async () => {
    const store = memoryStore();
    await resolveMacroIdentityCached(site().get, 'cloud-1', store);
    const other = site();
    await resolveMacroIdentityCached(other.get, 'cloud-2', store);
    expect(other.calls.length).toBeGreaterThan(0);
    expect(store.data.has(identityCacheKey('cloud-1'))).toBe(true);
    expect(store.data.has(identityCacheKey('cloud-2'))).toBe(true);
  });

  it('writes with the documented TTL', async () => {
    const seen: Array<{ expirationTtl?: number }> = [];
    const store: IdentityStore = {
      async get() {
        return null;
      },
      async put(_k, _v, options) {
        seen.push(options ?? {});
      },
    };
    await resolveMacroIdentityCached(site().get, 'cloud-1', store);
    expect(seen[0]?.expirationTtl).toBe(IDENTITY_CACHE_TTL_SECONDS);
  });

  it('never caches a refusal', async () => {
    // 'no_macro_on_site' is fixed by the user inserting one diagram; caching it
    // would keep saying no for a month after they had.
    const store = memoryStore();
    const empty = fakeSite({});
    const result = await resolveMacroIdentityCached(empty.get, 'cloud-1', store);
    expect(result.ok).toBe(false);
    expect(store.data.size).toBe(0);

    const now = site();
    expect(await resolveMacroIdentityCached(now.get, 'cloud-1', store)).toMatchObject({ ok: true });
  });

  it('ignores a corrupt or stale cache entry and re-resolves', async () => {
    const store = memoryStore();
    store.data.set(identityCacheKey('cloud-1'), '{not json');
    const a = await resolveMacroIdentityCached(site().get, 'cloud-1', store);
    expect(a).toMatchObject({ ok: true, source: 'discovered' });

    // A well-formed blob whose appId does not belong to any known variant must
    // not be handed back for pasting into an extensionKey.
    store.data.set(
      identityCacheKey('cloud-2'),
      JSON.stringify({ appId: 'deadbeef', environmentId: ENV_ID, variant: 'lite' }),
    );
    const b = await resolveMacroIdentityCached(site().get, 'cloud-2', store);
    expect(b).toMatchObject({ ok: true, source: 'discovered' });
  });

  it('survives a store that throws', async () => {
    const broken: IdentityStore = {
      async get() {
        throw new Error('KV down');
      },
      async put() {
        throw new Error('KV down');
      },
    };
    const result = await resolveMacroIdentityCached(site().get, 'cloud-1', broken);
    expect(result).toMatchObject({ ok: true, source: 'discovered' });
  });
});
