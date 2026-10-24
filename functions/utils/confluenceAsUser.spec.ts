import { describe, it, expect, vi, afterEach } from 'vitest';
import { isContentId, readCustomContentAsUser } from './confluenceAsUser';

const BASE = 'https://api.atlassian.com/ex/confluence/cloud-1';

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isContentId', () => {
  it.each(['1', '1001', '9'.repeat(30)])('accepts %s', (id) => {
    expect(isContentId(id)).toBe(true);
  });

  it.each([['', 'empty'], ['abc', 'letters'], ['1001/../2002', 'a path'], ['9'.repeat(31), '31 digits'], [1001, 'a number'], [undefined, 'undefined']])(
    'rejects %s (%s)',
    (id) => {
      expect(isContentId(id)).toBe(false);
    },
  );
});

describe('readCustomContentAsUser', () => {
  it('reads the raw body as the viewer and returns the record', async () => {
    const fetchMock = stubFetch(async () => new Response(JSON.stringify({ id: '1001', title: 'T' }), { status: 200 }));

    const result = await readCustomContentAsUser(BASE, '1001', 'user-token');

    expect(result).toEqual({ ok: true, content: { id: '1001', title: 'T' } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/api/v2/custom-content/1001?body-format=raw`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer user-token');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('makes no request for an id that is not digits', async () => {
    const fetchMock = stubFetch(async () => new Response('{}'));

    expect(await readCustomContentAsUser(BASE, '1001/../2002', 'user-token')).toEqual({ ok: false, reason: 'invalid_content_id' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a record whose id is not the one requested', async () => {
    stubFetch(async () => new Response(JSON.stringify({ id: '2002' }), { status: 200 }));

    expect(await readCustomContentAsUser(BASE, '1001', 'user-token')).toEqual({ ok: false, reason: 'id_mismatch' });
  });

  it('reports an upstream error by status only, without its body', async () => {
    stubFetch(async () => new Response('secret upstream detail', { status: 403 }));

    expect(await readCustomContentAsUser(BASE, '1001', 'user-token')).toEqual({ ok: false, reason: 'http_403' });
  });

  it('refuses a body over the size cap', async () => {
    stubFetch(async () => new Response(JSON.stringify({ id: '1001', pad: 'x'.repeat(100) }), { status: 200 }));

    expect(await readCustomContentAsUser(BASE, '1001', 'user-token', { maxBytes: 50 })).toEqual({ ok: false, reason: 'oversize' });
  });

  it('reports a non-JSON body as invalid_json', async () => {
    stubFetch(async () => new Response('<html>', { status: 200 }));

    expect(await readCustomContentAsUser(BASE, '1001', 'user-token')).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('distinguishes a timeout from other network failures', async () => {
    stubFetch(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    });
    expect(await readCustomContentAsUser(BASE, '1001', 'user-token')).toEqual({ ok: false, reason: 'timeout' });

    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await readCustomContentAsUser(BASE, '1001', 'user-token')).toEqual({ ok: false, reason: 'network_error' });
  });
});
