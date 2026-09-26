// The write half of the headless surface, where the interesting cases are all
// refusals: a truncating update, a page someone else just edited, a diagram
// already on the page, and a free space at its limit.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  callHeadlessTool,
  canonicalDiagramType,
  HeadlessToolError,
  spaceKeyFromLinks,
  type HeadlessContext,
} from './headlessTools';
import { checkCreateAllowed, MACROS_LIMIT, type GateEnv } from './headlessGate';
import { buildMacroNode, countExtensions, referencesCustomContent } from '../macroNode';
import { saveGrant, type GrantStore } from './tokenStore';
import { handleHeadlessRpc } from './headlessMcp';
import { issueAccessToken } from './asStore';
import { resourceFor } from './asMetadata';
import type { FetchLike } from './atlassianClient';

const ACCOUNT = '712020:abc';
const ORIGIN = 'https://conf-stg-lite.zenuml.com';
const CLOUD = 'cloud-1';
const LITE_APP_ID = '8ad26115-211f-4216-971b-0540f606303d';
const ENV_ID = '26ad8f7e-aa24-4afe-83a3-e8216f9e5220';
/** Long enough to clear the guard's DATA_LOSS_MIN_CURRENT_NONWS floor. */
const CURRENT_DSL = Array.from({ length: 20 }, (_, i) => `A${i}.method${i}()`).join('\n');

function memoryStore(): { store: GrantStore; kv: Map<string, string> } {
  const kv = new Map<string, string>();
  return {
    kv,
    store: {
      get: async (k) => kv.get(k) ?? null,
      put: async (k, v) => { kv.set(k, v); },
      delete: async (k) => { kv.delete(k); },
    },
  };
}

interface FakeSite {
  /** ADF of the target page, as stored. */
  pageAdf: { content: unknown[] };
  pageVersion: number;
  /** contentId -> stored body JSON. */
  content: Map<string, Record<string, unknown>>;
  contentVersion: Map<string, number>;
  /** contentId -> custom-content type; defaults to ours. */
  contentTypes?: Map<string, string>;
  /** Statuses to force, by "METHOD path-fragment". */
  force?: Record<string, number>;
}

function fakeAtlassian(site: FakeSite) {
  const writes: Array<{ method: string; url: string; body: unknown }> = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetchImpl: FetchLike = async (url, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    if (method !== 'GET') writes.push({ method, url, body });

    for (const [key, status] of Object.entries(site.force ?? {})) {
      const [m, fragment] = key.split(' ');
      if (m === method && url.includes(fragment)) return json(status, { error: 'forced' });
    }

    if (url === 'https://api.atlassian.com/oauth/token/accessible-resources') {
      return json(200, [{ id: CLOUD, name: 'One', url: 'https://one.atlassian.net', scopes: [] }]);
    }
    // macroIdentity's probe: one Lite row carrying a real extensionKey.
    if (url.includes('/custom-content?type=')) {
      if (!url.includes('zenuml-content-sequence')) return json(404, {});
      return json(200, {
        results: [
          {
            id: 'probe-1',
            type: 'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence',
            title: 'Probe',
            pageId: 'page-1',
          },
        ],
      });
    }
    if (url.includes('/pages/page-1/custom-content')) {
      return json(200, { results: [] });
    }
    if (url.includes('/pages/page-1?body-format=atlas_doc_format')) {
      return json(200, {
        id: 'page-1',
        title: 'Design notes',
        spaceId: 'space-1',
        version: { number: site.pageVersion },
        body: { atlas_doc_format: { value: JSON.stringify(site.pageAdf) } },
        // Where the space key comes from now: /wiki/api/v2/spaces/{id} needs a
        // scope we do not request and answers 401.
        _links: { webui: '/spaces/DESIGN/pages/page-1/Design+notes' },
      });
    }
    if (method === 'PUT' && url.includes('/pages/page-1')) {
      site.pageVersion = body.version.number;
      site.pageAdf = JSON.parse(body.body.value);
      return json(200, { id: 'page-1', version: { number: site.pageVersion } });
    }
    if (url.includes('/spaces/space-1')) return json(200, { id: 'space-1', key: 'DESIGN' });
    if (method === 'POST' && url.endsWith('/custom-content')) {
      site.content.set('new-1', body);
      return json(200, { id: 'new-1', type: body.type, title: body.title });
    }
    const contentMatch = /\/custom-content\/([^?]+)/.exec(url);
    if (contentMatch) {
      const id = contentMatch[1];
      const stored = site.content.get(id);
      if (!stored) return json(404, {});
      if (method === 'PUT') {
        site.content.set(id, body);
        site.contentVersion.set(id, body.version.number);
        return json(200, { id, version: { number: body.version.number } });
      }
      return json(200, {
        id,
        type: site.contentTypes?.get(id) ?? 'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence',
        status: 'current',
        pageId: 'page-1',
        title: stored.title ?? 'Diagram',
        version: { number: site.contentVersion.get(id) ?? 1 },
        body: { raw: { value: JSON.stringify(stored) } },
      });
    }
    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  };

  return { fetchImpl, writes };
}

async function contextFor(site: FakeSite, gateEnv: GateEnv = {}): Promise<{ ctx: HeadlessContext; writes: Array<{ method: string; url: string; body: unknown }> }> {
  const { store } = memoryStore();
  await saveGrant(store, 'grant-key', ACCOUNT, {
    accessToken: 'at-1',
    refreshToken: 'rt-1',
    accessTokenExpiresAtMs: Date.now() + 3_600_000,
    scope: 'write:page:confluence',
  });
  const { fetchImpl, writes } = fakeAtlassian(site);
  return {
    writes,
    ctx: {
      store,
      secret: 'grant-key',
      app: { clientId: 'c', clientSecret: 's', redirectUri: 'https://x/cb' },
      fetchImpl,
      userId: ACCOUNT,
      gateEnv,
    },
  };
}

/**
 * A page that already carries one ZenUML macro.
 *
 * Not decoration: `resolveMacroIdentity` learns the install's appId and
 * environmentId by reading an existing macro node off a page, so a site with
 * no macro at all has no identity to resolve — the same reason a brand-new
 * site cannot be written to headlessly until someone places one diagram.
 */
function emptyPage(): FakeSite {
  return {
    pageAdf: {
      content: [
        { type: 'paragraph', content: [] },
        buildMacroNode(`${LITE_APP_ID}/${ENV_ID}/static/zenuml-sequence-macro-lite`, 'probe-1'),
      ],
    },
    pageVersion: 4,
    content: new Map([['cc-1', { title: 'Checkout', code: CURRENT_DSL, diagramType: 'Sequence' }]]),
    contentVersion: new Map([['cc-1', 3]]),
  };
}

describe('update_diagram', () => {
  it('writes a new version and preserves fields it did not set', async () => {
    const site = emptyPage();
    site.content.set('cc-1', { title: 'Checkout', code: CURRENT_DSL, diagramType: 'Sequence', theme: 'dark' });
    const { ctx, writes } = await contextFor(site);
    const out = (await callHeadlessTool(
      'update_diagram',
      { cloudId: CLOUD, contentId: 'cc-1', dsl: `${CURRENT_DSL}\nB.extra()`, summary: 'add a step' },
      ctx,
    )) as { result: string; version: number };

    expect(out.result).toBe('updated');
    expect(out.version).toBe(4);
    const stored = site.content.get('cc-1') as { body: { value: string }; version: { message: string } };
    const written = JSON.parse(stored.body.value) as Record<string, unknown>;
    expect(written.code).toContain('B.extra()');
    expect(written.theme).toBe('dark');
    // §9.3: page history has to show an agent made this edit
    expect(stored.version.message).toContain('Agent Link');
    expect(stored.version.message).toContain('add a step');
    expect(writes.filter((w) => w.method === 'PUT')).toHaveLength(1);
  });

  it('refuses a change that would truncate the diagram, writing nothing', async () => {
    const site = emptyPage();
    const { ctx, writes } = await contextFor(site);
    await expect(
      callHeadlessTool('update_diagram', { cloudId: CLOUD, contentId: 'cc-1', dsl: 'A.one()' }, ctx),
    ).rejects.toMatchObject({ code: 'guardrail_rejected' });
    expect(writes).toHaveLength(0);
  });

  it('refuses a change that does not parse', async () => {
    const site = emptyPage();
    const { ctx, writes } = await contextFor(site);
    // An unclosed call, the same shape updateDiagramGuard.spec.ts uses.
    const broken = `${CURRENT_DSL}\nB.method(`;
    await expect(
      callHeadlessTool('update_diagram', { cloudId: CLOUD, contentId: 'cc-1', dsl: broken }, ctx),
    ).rejects.toBeInstanceOf(HeadlessToolError);
    expect(writes).toHaveLength(0);
  });

  it('reports a concurrent edit as conflict rather than forcing', async () => {
    const site = emptyPage();
    site.force = { 'PUT /custom-content/cc-1': 409 };
    const { ctx } = await contextFor(site);
    await expect(
      callHeadlessTool('update_diagram', { cloudId: CLOUD, contentId: 'cc-1', dsl: `${CURRENT_DSL}\nB.x()` }, ctx),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('reports a read-only user as forbidden', async () => {
    const site = emptyPage();
    site.force = { 'PUT /custom-content/cc-1': 403 };
    const { ctx } = await contextFor(site);
    await expect(
      callHeadlessTool('update_diagram', { cloudId: CLOUD, contentId: 'cc-1', dsl: `${CURRENT_DSL}\nB.x()` }, ctx),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('the three blockers found in review', () => {
  it('stores a diagramType the viewer actually recognises', async () => {
    const site = emptyPage();
    const { ctx } = await contextFor(site);
    // The casing an agent naturally sends, and the casing this tool used to ask for.
    await callHeadlessTool('create_diagram', { cloudId: CLOUD, pageId: 'page-1', type: 'Mermaid', dsl: 'graph TD\n A-->B' }, ctx);
    const created = site.content.get('new-1') as { body: { value: string } };
    const body = JSON.parse(created.body.value) as { diagramType: string };
    // DiagramType.Mermaid is 'mermaid'; every consumer compares with ===
    expect(body.diagramType).toBe('mermaid');
  });

  it('normalises the mixed-case enum values too, and refuses anything else', async () => {
    expect(canonicalDiagramType('OPENAPI')).toBe('OpenAPI');
    expect(canonicalDiagramType(' sequence ')).toBe('sequence');
    expect(canonicalDiagramType('PlantUml')).toBe('plantuml');
    expect(canonicalDiagramType('drawio')).toBeNull();

    const site = emptyPage();
    const { ctx, writes } = await contextFor(site);
    await expect(
      callHeadlessTool('create_diagram', { cloudId: CLOUD, pageId: 'page-1', type: 'drawio', dsl: 'x' }, ctx),
    ).rejects.toMatchObject({ code: 'bad_params' });
    expect(writes).toHaveLength(0);
  });

  it('reads the space key off the page, not from an endpoint we lack the scope for', async () => {
    const site = emptyPage();
    const { ctx, writes } = await contextFor(site, {
      // Keyed by the space the page's _links.webui names.
      confluence_plugin_features: { get: async () => ({ spaces: { DESIGN: { total: MACROS_LIMIT } } }) },
    });
    await expect(
      callHeadlessTool('create_diagram', { cloudId: CLOUD, pageId: 'page-1', type: 'sequence', dsl: 'A.b()' }, ctx),
    ).rejects.toMatchObject({ code: 'limit_reached' });
    expect(writes).toHaveLength(0);
    // and it never calls the endpoint that 401s on our scopes
    expect(spaceKeyFromLinks({ webui: '/spaces/DESIGN/pages/480411697/Test+page' })).toBe('DESIGN');
    expect(spaceKeyFromLinks(undefined)).toBe('');
  });

  it('refuses to rewrite custom content that is not a ZenUML diagram', async () => {
    const site = emptyPage();
    // A draw.io drawing, which sits in the same custom-content store.
    site.content.set('cc-2', { xml: '<mxGraphModel>…</mxGraphModel>' });
    site.contentVersion.set('cc-2', 5);
    site.contentTypes = new Map([['cc-2', 'ac:com.mxgraph.confluence.plugins.diagramly:drawio-diagram']]);
    const { ctx, writes } = await contextFor(site);
    await expect(
      callHeadlessTool('update_diagram', { cloudId: CLOUD, contentId: 'cc-2', dsl: CURRENT_DSL }, ctx),
    ).rejects.toMatchObject({ code: 'bad_params' });
    expect(writes).toHaveLength(0);
    expect(site.content.get('cc-2')).toEqual({ xml: '<mxGraphModel>…</mxGraphModel>' });
  });
});

describe('create_diagram', () => {
  it('stores the diagram, appends one macro, and publishes one page version', async () => {
    const site = emptyPage();
    const { ctx } = await contextFor(site);
    const out = (await callHeadlessTool(
      'create_diagram',
      { cloudId: CLOUD, pageId: 'page-1', type: 'Sequence', dsl: 'A.b()', title: 'Login' },
      ctx,
    )) as { result: string; contentId: string; pageVersion: number };

    expect(out.result).toBe('added');
    expect(out.contentId).toBe('new-1');
    expect(out.pageVersion).toBe(5);
    expect(countExtensions(site.pageAdf)).toBe(2); // the seeded one, plus ours
    // the node names the diagram, so the page renders it
    expect(referencesCustomContent(site.pageAdf, 'new-1', CLOUD)).toBe(true);
  });

  it('builds the extensionKey from the resolved install, not a guess', async () => {
    const site = emptyPage();
    const { ctx } = await contextFor(site);
    await callHeadlessTool('create_diagram', { cloudId: CLOUD, pageId: 'page-1', type: 'Sequence', dsl: 'A.b()' }, ctx);
    const nodes = (site.pageAdf.content as Array<Record<string, any>>).filter((n) => n.type === 'extension');
    const node = nodes[nodes.length - 1];
    expect(node.attrs.extensionKey).toBe(`${LITE_APP_ID}/${ENV_ID}/static/zenuml-sequence-macro-lite`);
  });

  it('refuses a diagram type the site\'s variant has no macro for', async () => {
    const site = emptyPage();
    const { ctx } = await contextFor(site);
    await expect(
      callHeadlessTool('create_diagram', { cloudId: CLOUD, pageId: 'page-1', type: 'AsyncApi', dsl: 'x' }, ctx),
    ).rejects.toMatchObject({ code: 'bad_params' });
  });

  it('loses to a human editor rather than overwriting the page', async () => {
    const site = emptyPage();
    site.force = { 'PUT /pages/page-1': 409 };
    const { ctx } = await contextFor(site);
    const out = (await callHeadlessTool(
      'create_diagram',
      { cloudId: CLOUD, pageId: 'page-1', type: 'Sequence', dsl: 'A.b()' },
      ctx,
    )) as { result: string };
    expect(out.result).toBe('conflict');
  });

  it('does not duplicate a diagram the page already carries', async () => {
    const site = emptyPage();
    // The page already places what the create will produce (a retry).
    site.pageAdf.content.push(buildMacroNode('app/env/static/zenuml-sequence-macro-lite', 'new-1'));
    const { ctx } = await contextFor(site);
    const out = (await callHeadlessTool(
      'create_diagram',
      { cloudId: CLOUD, pageId: 'page-1', type: 'Sequence', dsl: 'A.b()' },
      ctx,
    )) as { result: string };
    expect(out.result).toBe('already_present');
    expect(countExtensions(site.pageAdf)).toBe(2); // unchanged: the seeded macro and the retry's own
  });

  it('refuses when an unpaid space is at the limit, before creating anything', async () => {
    const site = emptyPage();
    const { ctx, writes } = await contextFor(site, {
      confluence_plugin_features: {
        get: async () => ({ spaces: { DESIGN: { total: MACROS_LIMIT } } }),
      },
    });
    await expect(
      callHeadlessTool('create_diagram', { cloudId: CLOUD, pageId: 'page-1', type: 'Sequence', dsl: 'A.b()' }, ctx),
    ).rejects.toMatchObject({ code: 'limit_reached' });
    expect(writes).toHaveLength(0);
  });

  it('allows creation in a licensed space that is over the limit', async () => {
    const site = emptyPage();
    const { ctx } = await contextFor(site, {
      SPACE_LICENSE_KV: {
        get: async (key: string) =>
          key === `license:${CLOUD}:DESIGN`
            ? JSON.stringify({ status: 'active', expiresAt: '2099-01-01T00:00:00Z' })
            : null,
      },
      confluence_plugin_features: { get: async () => ({ spaces: { DESIGN: { total: 500 } } }) },
    });
    const out = (await callHeadlessTool(
      'create_diagram',
      { cloudId: CLOUD, pageId: 'page-1', type: 'Sequence', dsl: 'A.b()' },
      ctx,
    )) as { result: string; gate: string };
    expect(out.result).toBe('added');
    expect(out.gate).toBe('paid');
  });
});

describe('write analytics', () => {
  /**
   * The gate's decision has to reach Mixpanel or the fail-open question (§9.1)
   * stays unanswerable: the frontend's paywall_gate_evaluated never fires on
   * this path, so `paywall_gate` here is the only record of whether the Lite
   * limit was applied or skipped.
   */
  // mixpanelService posts with the GLOBAL fetch, not the injected one, so the
  // only place to observe an emit is there.
  function captureEvents() {
    const events: Array<Record<string, any>> = [];
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: any, init: any) => {
      const href = String(url);
      if (href.includes('mixpanel.com')) {
        try {
          const parsed = JSON.parse(String(init?.body ?? '[]'));
          for (const e of Array.isArray(parsed) ? parsed : [parsed]) events.push(e);
        } catch {
          // the identify call posts a different shape; not what we are counting
        }
        return new Response('1', { status: 200 });
      }
      return original(url, init);
    });
    return events;
  }

  afterEach(() => vi.unstubAllGlobals());

  async function rpcCreate(site: FakeSite, gateEnv: GateEnv) {
    const { ctx } = await contextFor(site, gateEnv);
    const events = captureEvents();
    const fetchImpl = ctx.fetchImpl;
    const token = await issueAccessToken(
      ctx.store,
      {
        userId: ACCOUNT,
        clientId: 'client-A',
        scope: 'diagram.read diagram.write',
        resource: resourceFor(ORIGIN),
      },
      Date.now(),
    );
    const env = {
      ATLASSIAN_OAUTH_CLIENT_ID: 'c',
      ATLASSIAN_OAUTH_CLIENT_SECRET: 's',
      OAUTH_GRANT_KV: ctx.store,
      OAUTH_GRANT_SECRET: 'grant-key',
      MIXPANEL_TOKEN: 'mp-token',
      ...gateEnv,
    };
    const request = new Request(`${ORIGIN}/agent-link/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token.token}` },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_diagram',
          arguments: { cloudId: CLOUD, pageId: 'page-1', type: 'Sequence', dsl: 'A.b()' },
        },
      }),
    });
    const res = await handleHeadlessRpc(request, env, await request.clone().json(), { fetchImpl });
    return { res, events: events.filter((e) => String(e.event).startsWith('agent_link_diagram_')) };
  }

  it('records which gate branch allowed the create', async () => {
    const { res, events } = await rpcCreate(emptyPage(), {
      confluence_plugin_features: { get: async () => ({ spaces: { DESIGN: { total: 3 } } }) },
    });
    expect(res.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('agent_link_diagram_created');
    expect(events[0].properties.result).toBe('added');
    expect(events[0].properties.paywall_gate).toBe('under_limit');
  });

  it('records the fail-open path distinctly, so its volume is measurable', async () => {
    const { events } = await rpcCreate(emptyPage(), {
      confluence_plugin_features: { get: async () => null },
    });
    expect(events[0].properties.paywall_gate).toBe('count_unknown');
  });

  it('records a refusal when the gate actually bites', async () => {
    const { res, events } = await rpcCreate(emptyPage(), {
      confluence_plugin_features: { get: async () => ({ spaces: { DESIGN: { total: MACROS_LIMIT } } }) },
    });
    expect(res.status).toBe(200); // a tool-level refusal, not a transport error
    expect(events[0].properties.paywall_gate).toBe('limit_reached');
    expect(events[0].properties.reason).toBe('limit_reached');
  });
});

describe('the paywall gate itself', () => {
  const base = { variant: 'lite', cloudId: CLOUD, clientDomain: 'one.atlassian.net', spaceKey: 'DESIGN' };

  it('allows when the count is unknown, rather than blocking on a KV miss', async () => {
    const decision = await checkCreateAllowed({ confluence_plugin_features: { get: async () => null } }, base);
    expect(decision).toEqual({ allowed: true, reason: 'count_unknown' });
  });

  it('allows a non-Lite variant without consulting anything', async () => {
    let touched = false;
    const decision = await checkCreateAllowed(
      { confluence_plugin_features: { get: async () => { touched = true; return null; } } },
      { ...base, variant: 'full' },
    );
    expect(decision.allowed).toBe(true);
    expect(touched).toBe(false);
  });

  it('blocks exactly at the limit', async () => {
    const at = await checkCreateAllowed(
      { confluence_plugin_features: { get: async () => ({ spaces: { DESIGN: { total: MACROS_LIMIT } } }) } },
      base,
    );
    const under = await checkCreateAllowed(
      { confluence_plugin_features: { get: async () => ({ spaces: { DESIGN: { total: MACROS_LIMIT - 1 } } }) } },
      base,
    );
    expect(at.allowed).toBe(false);
    expect(under.allowed).toBe(true);
  });

  it('honours a user-scoped license as well as a space one', async () => {
    const decision = await checkCreateAllowed(
      {
        SPACE_LICENSE_KV: {
          get: async (key: string) =>
            key === `license:${CLOUD}:DESIGN:${ACCOUNT}`
              ? JSON.stringify({ status: 'active', expiresAt: '2099-01-01T00:00:00Z' })
              : null,
        },
        confluence_plugin_features: { get: async () => ({ spaces: { DESIGN: { total: 999 } } }) },
      },
      { ...base, accountId: ACCOUNT },
    );
    expect(decision).toEqual({ allowed: true, reason: 'paid' });
  });

  it('ignores an expired license', async () => {
    const decision = await checkCreateAllowed(
      {
        SPACE_LICENSE_KV: {
          get: async () => JSON.stringify({ status: 'active', expiresAt: '2020-01-01T00:00:00Z' }),
        },
        confluence_plugin_features: { get: async () => ({ spaces: { DESIGN: { total: 999 } } }) },
      },
      base,
    );
    expect(decision.allowed).toBe(false);
  });
});
