import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callRemote, forgeRequest, loadPaginatedDataUntil } from './requestUtil';
import { ForgeRequestError, templateUrl } from './forgeRequestError';

const mockRequestConfluence = vi.fn();
const mockInvokeRemote = vi.fn();
vi.mock('@forge/bridge', () => ({
  requestConfluence: (...args: any[]) => mockRequestConfluence(...args),
  invokeRemote: (...args: any[]) => mockInvokeRemote(...args),
}));

describe('callRemote', () => {
  it('preserves a real denial status for attachment failure classification', async () => {
    mockInvokeRemote.mockResolvedValue({ status: 403, body: { error: 'no_user_credential' } });
    await expect(callRemote('/forge-upload-attachment', 'POST', {})).rejects.toMatchObject({
      status: 403,
      message: 'HTTP 403: {"error":"no_user_credential"}',
    });
  });
});

describe('loadPaginatedDataUntil', () => {
  const pages: Record<string, any> = {
    '/start': { results: [1, 2, 3], _links: { next: '/wiki/p2' } },
    '/p2': { results: [4, 5, 6], _links: { next: '/wiki/p3' } },
    '/p3': { results: [7], _links: {} },
  };

  it('stops paginating once shouldStop() returns true', async () => {
    const requestFunc = vi.fn(async (url: string) => pages[url]);
    let count = 0;
    await loadPaginatedDataUntil(requestFunc, '/start', (d: any) => { count += d.results.length; }, () => count >= 4);
    // page1 (3) → not stop → page2 (6) → stop; page3 never fetched
    expect(requestFunc).toHaveBeenCalledTimes(2);
    expect(count).toBe(6);
  });

  it('exhausts all pages when shouldStop() never returns true', async () => {
    const requestFunc = vi.fn(async (url: string) => pages[url]);
    let count = 0;
    await loadPaginatedDataUntil(requestFunc, '/start', (d: any) => { count += d.results.length; }, () => false);
    expect(requestFunc).toHaveBeenCalledTimes(3);
    expect(count).toBe(7);
  });
});

describe('forgeRequest', () => {
  beforeEach(() => {
    mockRequestConfluence.mockReset();
    // jsdom has window.self === window.top, which forgeRequest reads as the
    // standalone (MockAp) environment. Pretend to be inside the Forge iframe.
    vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window);
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns a JSON body on success', async () => {
    mockRequestConfluence.mockResolvedValue(new Response('{"results":[1]}', {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    await expect(forgeRequest('/wiki/api/v2/pages/1')).resolves.toEqual({ results: [1] });
  });

  it('returns a JSON error envelope on a 4xx exactly as before', async () => {
    const envelope = { errors: [{ status: 404, code: 'NOT_FOUND', title: 'Not Found' }] };
    mockRequestConfluence.mockResolvedValue(new Response(JSON.stringify(envelope), {
      status: 404, headers: { 'content-type': 'application/json' },
    }));
    await expect(forgeRequest('/wiki/api/v2/custom-content/9?body-format=raw')).resolves.toEqual(envelope);
  });

  it('throws ForgeRequestError carrying the status for an HTML page', async () => {
    mockRequestConfluence.mockResolvedValue(new Response(
      '<!doctype html>\n<html><head><title>  Service\n Unavailable </title></head><body>down</body></html>',
      { status: 503, headers: { 'content-type': 'text/html;charset=UTF-8' } },
    ));
    const error = await forgeRequest('/wiki/api/v2/pages/123456/attachments?filename=a.png').catch(e => e);
    expect(error).toBeInstanceOf(ForgeRequestError);
    expect(error).toMatchObject({
      name: 'ForgeRequestError',
      status: 503,
      method: 'GET',
      endpoint: 'GET /wiki/api/v2/pages/{id}/attachments',
      contentType: 'text/html;charset=UTF-8',
      htmlTitle: 'Service Unavailable',
    });
    expect(error.bodyPrefix.startsWith('<!doctype html> <html>')).toBe(true);
    expect(error.message).toContain('HTTP 503');
  });

  it('keeps the Retry-After header of a 429 page, and none when absent', async () => {
    mockRequestConfluence.mockResolvedValueOnce(new Response('<html><title>HTTP Status 429 – Too Many Requests</title></html>', {
      status: 429, headers: { 'content-type': 'text/html;charset=utf-8', 'retry-after': '30' },
    }));
    expect(await forgeRequest('/wiki/api/v2/pages/1/attachments').catch(e => e)).toMatchObject({ status: 429, retryAfter: '30' });

    mockRequestConfluence.mockResolvedValueOnce(new Response('<html></html>', { status: 429 }));
    expect((await forgeRequest('/wiki/api/v2/pages/1/attachments').catch(e => e)).retryAfter).toBeUndefined();
  });

  it('throws ForgeRequestError for an empty body, keeping the method', async () => {
    mockRequestConfluence.mockResolvedValue(new Response(null, { status: 204 }));
    const error = await forgeRequest('/wiki/rest/api/content/42/property/x', 'put', { a: 1 }).catch(e => e);
    expect(error).toBeInstanceOf(ForgeRequestError);
    expect(error).toMatchObject({ status: 204, endpoint: 'PUT /wiki/rest/api/content/{id}/property/x', contentType: '' });
    expect(error.htmlTitle).toBeUndefined();
  });

  describe('throwOnHttpError opt-in (#801)', () => {
    it('throws ForgeRequestError with the status for a JSON 403 body', async () => {
      const body = JSON.stringify({ statusCode: 403, message: 'com.atlassian.confluence.api.service.exceptions.PermissionException: nope' });
      mockRequestConfluence.mockResolvedValue(new Response(body, {
        status: 403, headers: { 'content-type': 'application/json' },
      }));
      const error = await forgeRequest('/wiki/rest/api/content/123456/child/attachment/att789', 'PUT', { a: 1 }, { throwOnHttpError: true }).catch(e => e);
      expect(error).toBeInstanceOf(ForgeRequestError);
      expect(error).toMatchObject({
        status: 403,
        method: 'PUT',
        endpoint: 'PUT /wiki/rest/api/content/{id}/child/attachment/{id}',
        contentType: 'application/json',
        nonJson: false,
      });
      expect(error.bodyPrefix).toContain('PermissionException');
      // A JSON body must not be described as non-JSON.
      expect(error.message).toContain('HTTP 403');
      expect(error.message).not.toContain('non-JSON');
    });

    it('throws for a JSON 500 body', async () => {
      mockRequestConfluence.mockResolvedValue(new Response('{"message":"boom"}', {
        status: 500, headers: { 'content-type': 'application/json' },
      }));
      await expect(forgeRequest('/wiki/x', 'PUT', {}, { throwOnHttpError: true }))
        .rejects.toMatchObject({ name: 'ForgeRequestError', status: 500, nonJson: false });
    });

    it('still returns the parsed body on a 200', async () => {
      mockRequestConfluence.mockResolvedValue(new Response('{"id":"att789"}', {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
      await expect(forgeRequest('/wiki/x', 'PUT', {}, { throwOnHttpError: true })).resolves.toEqual({ id: 'att789' });
    });

    it('marks a non-JSON body as nonJson', async () => {
      mockRequestConfluence.mockResolvedValue(new Response('<html></html>', { status: 502, headers: { 'content-type': 'text/html' } }));
      await expect(forgeRequest('/wiki/x', 'GET'))
        .rejects.toMatchObject({ status: 502, nonJson: true });
    });

    it('is off by default: a JSON 403 body is still returned', async () => {
      const envelope = { statusCode: 403 };
      mockRequestConfluence.mockImplementation(async () => new Response(JSON.stringify(envelope), {
        status: 403, headers: { 'content-type': 'application/json' },
      }));
      await expect(forgeRequest('/wiki/x', 'PUT', {})).resolves.toEqual(envelope);
      await expect(forgeRequest('/wiki/x', 'PUT', {}, {})).resolves.toEqual(envelope);
    });
  });
});

describe('templateUrl', () => {
  it('replaces numeric and uuid segments and drops the query', () => {
    expect(templateUrl('/wiki/api/v2/custom-content/123?body-format=raw')).toBe('/wiki/api/v2/custom-content/{id}');
    expect(templateUrl('/x/3f2b8c1e-1a2b-4c3d-8e9f-0123456789ab/y')).toBe('/x/{id}/y');
    expect(templateUrl('/wiki/api/v2/pages/12/attachments')).toBe('/wiki/api/v2/pages/{id}/attachments');
    expect(templateUrl('/wiki/rest/api/content/12/child/attachment/att345')).toBe('/wiki/rest/api/content/{id}/child/attachment/{id}');
  });
});
