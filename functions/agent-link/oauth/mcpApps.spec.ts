import { describe, it, expect } from 'vitest';
import {
  UI_EXTENSION_ID,
  UI_MIME_TYPE,
  DIAGRAM_VIEW_URI,
  DIAGRAM_VIEW_ASSET_PATH,
  VIEW_TOOLS,
  RENDERABLE_TYPES,
  isRenderableType,
  uiCapability,
  uiMeta,
  withUiMeta,
  uiResourceList,
  readUiResource,
  withAbsoluteBase,
} from './mcpApps';

const ORIGIN = 'https://zenapi.zenuml.com';
const VIEW_HTML = '<!doctype html><html><body><div id="app"></div><script type="module" src="/assets/mcp-app-view-abc123.js"></script></body></html>';

function ok(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
}

describe('spec identifiers', () => {
  // These are the three strings a host matches on. A typo in any of them is a
  // silent non-render, so they are asserted literally rather than referenced.
  it('uses the extension id, MIME type and URI scheme the spec mandates', () => {
    expect(UI_EXTENSION_ID).toBe('io.modelcontextprotocol/ui');
    expect(UI_MIME_TYPE).toBe('text/html;profile=mcp-app');
    expect(DIAGRAM_VIEW_URI.startsWith('ui://')).toBe(true);
  });

  it('declares the capability in the shape initialize expects', () => {
    expect(uiCapability()).toEqual({
      'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] },
    });
  });

  it('advertises the resource with the app MIME type, not plain text/html', () => {
    const [entry] = uiResourceList();
    expect(entry.uri).toBe(DIAGRAM_VIEW_URI);
    expect(entry.mimeType).toBe(UI_MIME_TYPE);
  });
});

describe('withUiMeta', () => {
  const tools = [
    { name: 'list_sites' },
    { name: 'read_diagram' },
    { name: 'update_diagram' },
    { name: 'create_diagram' },
    { name: 'list_diagrams' },
    { name: 'get_status' },
  ];

  it('attaches the view only to the tools that have one', () => {
    const out = withUiMeta(tools, ORIGIN);
    const withView = out.filter((t) => '_meta' in t).map((t) => t.name);
    expect(withView.sort()).toEqual(['create_diagram', 'read_diagram', 'update_diagram']);
    expect([...VIEW_TOOLS].sort()).toEqual(withView.sort());
  });

  it('leaves list_diagrams alone — a table is already the right shape', () => {
    const listed = withUiMeta(tools, ORIGIN).find((t) => t.name === 'list_diagrams');
    expect(listed).not.toHaveProperty('_meta');
  });

  it('points _meta.ui at the view and allows this origin to serve the bundle', () => {
    const read = withUiMeta(tools, ORIGIN).find((t) => t.name === 'read_diagram') as
      { _meta: { ui: { resourceUri: string; csp: { resourceDomains: string[] } } } };
    expect(read._meta.ui.resourceUri).toBe(DIAGRAM_VIEW_URI);
    // The sandbox baseline is default-src 'none': an origin missing here loads
    // nothing at all, with no error.
    expect(read._meta.ui.csp.resourceDomains).toEqual([ORIGIN]);
  });

  it('grants no network reach the view does not need', () => {
    const meta = uiMeta(ORIGIN) as { ui: { csp: { connectDomains: string[]; frameDomains: string[] } } };
    expect(meta.ui.csp.connectDomains).toEqual([]);
    expect(meta.ui.csp.frameDomains).toEqual([]);
  });

  it('does not mutate the tools it was given', () => {
    const original = [{ name: 'read_diagram' }];
    withUiMeta(original, ORIGIN);
    expect(original[0]).not.toHaveProperty('_meta');
  });

  it('carries each deploy its own origin, so staging never advertises prod', () => {
    const stg = withUiMeta(tools, 'https://conf-stg-lite.zenuml.com').find((t) => t.name === 'read_diagram') as
      { _meta: { ui: { csp: { resourceDomains: string[] } } } };
    expect(stg._meta.ui.csp.resourceDomains).toEqual(['https://conf-stg-lite.zenuml.com']);
  });
});

describe('isRenderableType', () => {
  it('accepts the text-DSL family this view draws', () => {
    expect([...RENDERABLE_TYPES].sort()).toEqual(['mermaid', 'sequence']);
    expect(isRenderableType('sequence')).toBe(true);
    expect(isRenderableType('Mermaid')).toBe(true);
  });

  it('rejects the types that need a renderer this view does not bundle', () => {
    for (const t of ['plantuml', 'graph', 'OpenAPI', 'AsyncAPI', 'embed', '', undefined, 42]) {
      expect(isRenderableType(t)).toBe(false);
    }
  });
});

describe('withAbsoluteBase', () => {
  // Regression for the bug the first build surfaced: Vite writes relative asset
  // URLs, and inside the host's sandboxed frame those resolve against the frame,
  // not us — fetching nothing, silently, because the sandbox is default-src 'none'.
  it('inserts a base pointing at our origin, right after <head>', () => {
    const html = '<!doctype html><html><head><title>x</title></head><body></body></html>';
    expect(withAbsoluteBase(html, ORIGIN)).toBe(
      `<!doctype html><html><head><base href="${ORIGIN}/"><title>x</title></head><body></body></html>`,
    );
  });

  it('makes the real built markup resolve against our origin', () => {
    const built = '<!doctype html><html lang="en"><head><meta charset="utf-8" />'
      + '<script type="module" crossorigin src="./assets/mcp-app-view-mfuxWIL2.js"></script>'
      + '</head><body><div id="app"></div></body></html>';
    const out = withAbsoluteBase(built, ORIGIN);
    expect(out).toContain(`<base href="${ORIGIN}/">`);
    // The relative src is deliberately left alone — the base is what resolves it.
    expect(out).toContain('src="./assets/mcp-app-view-mfuxWIL2.js"');
    expect(out.indexOf('<base')).toBeLessThan(out.indexOf('<script'));
  });

  it('leaves an existing base alone rather than fighting it', () => {
    const html = '<html><head><base href="https://example.com/"></head></html>';
    expect(withAbsoluteBase(html, ORIGIN)).toBe(html);
  });

  it('still resolves a fragment with no head', () => {
    const out = withAbsoluteBase('<div id="app"></div><script src="./a.js"></script>', ORIGIN);
    expect(out.startsWith(`<base href="${ORIGIN}/">`)).toBe(true);
  });

  it('allows the base in the CSP, or the tag is refused', () => {
    const meta = uiMeta(ORIGIN) as { ui: { csp: { baseUriDomains: string[] } } };
    expect(meta.ui.csp.baseUriDomains).toEqual([ORIGIN]);
  });
});

describe('readUiResource', () => {
  it('serves the built view as the resource body', async () => {
    const res = await readUiResource(DIAGRAM_VIEW_URI, ORIGIN, async () => ok(VIEW_HTML));
    expect(res.ok).toBe(true);
    expect(res.ok && res.contents[0]).toEqual({
      uri: DIAGRAM_VIEW_URI,
      mimeType: UI_MIME_TYPE,
      text: withAbsoluteBase(VIEW_HTML, ORIGIN),
    });
  });

  it('fetches the asset from the requesting origin', async () => {
    const seen: string[] = [];
    await readUiResource(DIAGRAM_VIEW_URI, 'https://conf-stg-lite.zenuml.com', async (u) => {
      seen.push(u);
      return ok(VIEW_HTML);
    });
    expect(seen).toEqual([`https://conf-stg-lite.zenuml.com${DIAGRAM_VIEW_ASSET_PATH}`]);
  });

  it('refuses a URI it does not publish', async () => {
    const res = await readUiResource('ui://somebody-else/view', ORIGIN, async () => ok(VIEW_HTML));
    expect(res).toMatchObject({ ok: false, reason: 'unknown_uri' });
  });

  it('refuses a non-string URI without calling out', async () => {
    let called = false;
    const res = await readUiResource(undefined, ORIGIN, async () => {
      called = true;
      return ok(VIEW_HTML);
    });
    expect(res).toMatchObject({ ok: false, reason: 'unknown_uri' });
    expect(called).toBe(false);
  });

  it('reports fetch_failed on a non-2xx asset', async () => {
    const res = await readUiResource(DIAGRAM_VIEW_URI, ORIGIN, async () => new Response('', { status: 404 }));
    expect(res).toMatchObject({ ok: false, reason: 'fetch_failed' });
  });

  it('reports fetch_failed when Pages answers with the SPA shell instead of the view', async () => {
    // A deploy missing the entry returns index.html with a 200, which would hand
    // the host a page that renders nothing. The missing <script> is the tell.
    const res = await readUiResource(DIAGRAM_VIEW_URI, ORIGIN, async () =>
      ok('<!doctype html><html><body><div id="root"></div></body></html>'));
    expect(res).toMatchObject({ ok: false, reason: 'fetch_failed' });
    expect(res.ok === false && res.detail).toMatch(/mcp-app-view\.html/);
  });

  it('reports fetch_failed rather than throwing when the fetch itself dies', async () => {
    const res = await readUiResource(DIAGRAM_VIEW_URI, ORIGIN, async () => {
      throw new Error('ECONNRESET');
    });
    expect(res).toMatchObject({ ok: false, reason: 'fetch_failed', detail: 'ECONNRESET' });
  });
});
