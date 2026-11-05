import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from './graph-icon-proxy';
import { AUTHENTICATED_PATHS } from './_middleware';
import { readFileSync } from 'node:fs';

const ICON = 'https://icons.diagrams.net/assets/azure/1/Azure_Service_Bus_Queues.svg';
const ICON_B = 'https://icons.diagrams.net/assets/azure/1/Azure_Storage.svg';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
const ctx = { cloudId: 'tenant-a', forgeAppId: '8ad26115-211f-4216-971b-0540f606303d' };

let fetchMock: ReturnType<typeof vi.fn>;
const svgReply = (body: BodyInit = SVG, type = 'image/svg+xml') =>
  new Response(body, { status: 200, headers: { 'content-type': type } });
// Guest and anonymous viewers send a FIT and no x-forge-oauth-user: that is the
// default request here on purpose.
const request = (body: unknown, headers: Record<string, string> = {}, method = 'POST') =>
  new Request('https://backend.example/graph-icon-proxy', {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
const invoke = (body: unknown, context: any = ctx, headers: Record<string, string> = {}) =>
  onRequest({ request: request(body, headers), data: { forgeContext: context } as any });

beforeEach(() => {
  fetchMock = vi.fn(async () => svgReply());
  vi.stubGlobal('fetch', fetchMock);
});

describe('graph icon proxy', () => {
  it('is routed to the function and authenticated by the middleware', () => {
    expect(AUTHENTICATED_PATHS).toContain('/graph-icon-proxy');
    expect(JSON.parse(readFileSync('public/_routes.json', 'utf8')).include).toContain('/graph-icon-proxy');
  });

  it('returns each icon as a base64 data URL, without a user token (guest / anonymous viewer)', async () => {
    const res = await invoke({ urls: [ICON] });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.icons[ICON]).toBe(`data:image/svg+xml;base64,${btoa(SVG)}`);
    expect(body.failed).toEqual({});
    expect(fetchMock).toHaveBeenCalledWith(ICON, expect.objectContaining({ redirect: 'error' }));
  });

  it('answers 401 without an authenticated Forge context', async () => {
    for (const context of [null, {}, { cloudId: 'tenant-a' }, { forgeAppId: ctx.forgeAppId }]) {
      expect((await invoke({ urls: [ICON] }, context)).status).toBe(401);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 405 for a method other than POST', async () => {
    const res = await onRequest({ request: request(undefined, {}, 'GET'), data: { forgeContext: ctx } as any });
    expect(res.status).toBe(405);
  });

  it('rejects a host other than icons.diagrams.net before any fetch', async () => {
    for (const url of [
      'https://app.diagrams.net/img/lib/x.svg',
      'https://icons.diagrams.net.evil.example/a.svg',
      'https://evil.example/icons.diagrams.net/a.svg',
      'https://user:pw@icons.diagrams.net/a.svg',
      'https://icons.diagrams.net:8443/a.svg',
      'https://127.0.0.1/a.svg',
    ]) {
      const res = await invoke({ urls: [ICON, url] });
      expect(res.status, url).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects http and other schemes before any fetch', async () => {
    for (const url of ['http://icons.diagrams.net/a.svg', 'data:image/svg+xml;base64,AAAA', 'ftp://icons.diagrams.net/a.svg', 'not a url']) {
      expect((await invoke({ urls: [url] })).status, url).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed body, empty list, non-string entries and an oversized body', async () => {
    expect((await invoke({})).status).toBe(400);
    expect((await invoke({ urls: [] })).status).toBe(400);
    expect((await invoke({ urls: [1] })).status).toBe(400);
    expect((await invoke({ urls: ICON })).status).toBe(400);
    expect((await invoke({ urls: [`${ICON}?${'a'.repeat(200000)}`] })).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts 50 URLs and rejects 51', async () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => `https://icons.diagrams.net/assets/i${i}.svg`);
    expect((await invoke({ urls: make(50) })).status).toBe(200);
    fetchMock.mockClear();
    expect((await invoke({ urls: make(51) })).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches with redirect:error, and reports a redirecting icon as failed instead of following it', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === ICON) throw new TypeError('redirect mode is set to error');
      return svgReply();
    });
    const body: any = await (await invoke({ urls: [ICON, ICON_B] })).json();
    expect(body.icons[ICON]).toBeUndefined();
    expect(body.failed[ICON]).toBe('fetch_failed');
    expect(body.icons[ICON_B]).toMatch(/^data:image\/svg\+xml;base64,/);
    for (const call of fetchMock.mock.calls) expect(call[1]).toMatchObject({ redirect: 'error' });
  });

  it('treats a 3xx or redirected response as failed', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://evil.example/a.svg' } }));
    const body: any = await (await invoke({ urls: [ICON] })).json();
    expect(body.failed[ICON]).toBe('http_302');
  });

  it('reports an upstream HTTP error per icon', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 404, headers: { 'content-type': 'text/plain' } }));
    const body: any = await (await invoke({ urls: [ICON] })).json();
    expect(body.icons).toEqual({});
    expect(body.failed[ICON]).toBe('http_404');
  });

  it('accepts only image/svg+xml and image/png, ignoring parameters and case', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === ICON ? svgReply(SVG, 'IMAGE/SVG+XML; charset=utf-8') : svgReply('\x89PNG', 'image/png'));
    const ok: any = await (await invoke({ urls: [ICON, ICON_B] })).json();
    expect(ok.icons[ICON]).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(ok.icons[ICON_B]).toMatch(/^data:image\/png;base64,/);
    for (const type of ['text/html', 'image/jpeg', 'application/octet-stream', 'image/svg+xml-evil', '']) {
      fetchMock.mockResolvedValue(svgReply('x', type));
      const bad: any = await (await invoke({ urls: [ICON] })).json();
      expect(bad.icons, type).toEqual({});
      expect(bad.failed[ICON], type).toBe('bad_content_type');
    }
  });

  it('refuses an icon over 512 KB, including a body that lies about its length', async () => {
    const limit = 512 * 1024;
    fetchMock.mockResolvedValue(svgReply('a'.repeat(limit)));
    expect(((await (await invoke({ urls: [ICON] })).json()) as any).icons[ICON]).toBeDefined();
    fetchMock.mockResolvedValue(svgReply('a'.repeat(limit + 1)));
    expect(((await (await invoke({ urls: [ICON] })).json()) as any).failed[ICON]).toBe('too_large');
    const declared = new Response('a', { status: 200, headers: { 'content-type': 'image/svg+xml', 'content-length': String(limit + 1) } });
    fetchMock.mockResolvedValue(declared);
    expect(((await (await invoke({ urls: [ICON] })).json()) as any).failed[ICON]).toBe('too_large');
  });

  it('refuses a batch over 4 MB in total', async () => {
    const urls = Array.from({ length: 9 }, (_, i) => `https://icons.diagrams.net/assets/big${i}.svg`);
    fetchMock.mockImplementation(async () => svgReply('a'.repeat(500 * 1024)));
    const res = await invoke({ urls });
    expect(res.status).toBe(413);
    const under = await invoke({ urls: urls.slice(0, 8) });
    expect(under.status).toBe(200);
  });

  it('deduplicates repeated URLs into one upstream fetch', async () => {
    await invoke({ urls: [ICON, ICON, ICON_B] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
