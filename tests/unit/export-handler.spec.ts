import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { asAppRequest, asUserRequest } = vi.hoisted(() => ({
  asAppRequest: vi.fn(),
  asUserRequest: vi.fn(),
}));

vi.mock('@forge/api', () => ({
  default: {
    asUser: () => ({ requestConfluence: asUserRequest }),
    asApp: () => ({ requestConfluence: asAppRequest }),
  },
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, s, i) => acc + s + String(values[i] ?? ''), ''),
}));

import { handler } from '../../src/export.js';

function mixpanelBodiesFromFetch(fetchMock: typeof fetch): unknown[] {
  const calls = vi.mocked(fetchMock).mock.calls;
  const rows: unknown[] = [];
  for (const call of calls) {
    const init = call[1] as RequestInit | undefined;
    const body = init?.body;
    if (typeof body !== 'string') continue;
    try {
      rows.push(...JSON.parse(body));
    } catch {
      // ignore
    }
  }
  return rows;
}

describe('Forge export resolver (src/export.js)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => '',
      })),
    );
    process.env.MIXPANEL_TOKEN = 'unit-test-token';
    asAppRequest.mockReset();
    asUserRequest.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MIXPANEL_TOKEN;
  });

  it('includes custom_content_id on macro_export_failed when catch runs (Word config path)', async () => {
    asAppRequest.mockRejectedValue(new Error('forced attachments failure'));

    const payload = {
      exportType: 'word',
      context: {
        cloudId: 'cloud-x',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SPACE',
        accountId: '557058:acc',
        content: { id: '111' },
        config: { customContentId: 'cc-word-export' },
      },
    };

    await handler(payload);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { failure_reason?: string; custom_content_id?: string; error_name?: string; error_message?: string; error_stack?: string };
    }>;
    const failed = rows.find((r) => r.event === 'macro_export_failed');
    expect(failed?.properties?.custom_content_id).toBe('cc-word-export');
    expect(failed?.properties?.failure_reason).toBe('unexpected_error:Error');
    expect(failed?.properties?.error_name).toBe('Error');
    expect(failed?.properties?.error_message).toBe('forced attachments failure');
    expect(failed?.properties?.error_stack).toContain('forced attachments failure');
  });

  it('includes custom_content_id on macro_export_failed when catch runs (PDF extensionPayload path)', async () => {
    asAppRequest.mockRejectedValue(new Error('forced attachments failure'));

    const payload = {
      context: {
        cloudId: 'cloud-y',
        siteUrl: 'https://acme.atlassian.net/wiki',
        spaceKey: 'SK',
        accountId: 'acc-2',
        extension: { content: { id: '222' } },
      },
      extensionPayload: {
        config: { customContentId: 'cc-pdf-export' },
      },
    };

    await handler(payload);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { failure_reason?: string; custom_content_id?: string; error_name?: string };
    }>;
    const failed = rows.find((r) => r.event === 'macro_export_failed');
    expect(failed?.properties?.custom_content_id).toBe('cc-pdf-export');
    expect(failed?.properties?.error_name).toBe('Error');
  });

  it('classifies NEEDS_AUTHENTICATION_ERR as needs_authentication', async () => {
    const authErr = Object.assign(new Error('Authentication Required'), {
      name: 'NEEDS_AUTHENTICATION_ERR',
      status: 401,
    });
    asAppRequest.mockRejectedValue(authErr);

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-z',
        siteUrl: 'https://example.atlassian.net',
        spaceKey: 'SP',
        accountId: 'acc-3',
        extension: { content: { id: '333' } },
      },
      extensionPayload: {
        config: { customContentId: 'cc-auth-test' },
      },
    };

    await handler(payload);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { failure_reason?: string; error_name?: string; error_stack?: string; http_status?: number };
    }>;
    const failed = rows.find((r) => r.event === 'macro_export_failed');
    expect(failed?.properties?.failure_reason).toBe('needs_authentication');
    expect(failed?.properties?.error_name).toBe('NEEDS_AUTHENTICATION_ERR');
    expect(failed?.properties?.http_status).toBe(401);
    expect(failed?.properties?.error_stack).toBeUndefined();
  });

  it('tracks macro_export_succeeded with custom_content_id when PDF export completes (extensionPayload path)', async () => {
    asAppRequest.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        results: [{ downloadLink: '/wiki/download/attachments/222/zenuml-cc-pdf-ok.png' }],
        _links: { base: 'https://acme.atlassian.net' },
      }),
    });

    const payload = {
      context: {
        cloudId: 'cloud-y',
        siteUrl: 'https://acme.atlassian.net/wiki',
        spaceKey: 'SK',
        accountId: 'acc-2',
        extension: { content: { id: '222' } },
      },
      extensionPayload: {
        config: { customContentId: 'cc-pdf-ok' },
      },
    };

    const result = await handler(payload);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { custom_content_id?: string };
    }>;
    const succeeded = rows.find((r) => r.event === 'macro_export_succeeded');
    expect(succeeded?.properties?.custom_content_id).toBe('cc-pdf-ok');

    expect(JSON.stringify(result)).toContain(
      'https://acme.atlassian.net/wiki/download/attachments/222/zenuml-cc-pdf-ok.png',
    );
  });

  it('falls back to asUser() when asApp() returns 404 and succeeds, with fallback telemetry', async () => {
    asAppRequest.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => '{"errors":[{"status":404,"code":"NOT_FOUND"}]}',
    });
    asUserRequest.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        results: [{ downloadLink: '/wiki/download/attachments/444/zenuml-cc-fallback.png' }],
        _links: { base: 'https://acme.atlassian.net' },
      }),
    });

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-fb',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SP',
        accountId: 'acc-fb',
        extension: { content: { id: '444' } },
      },
      extensionPayload: {
        config: { customContentId: 'cc-fallback' },
      },
    };

    const result = await handler(payload);

    expect(asAppRequest).toHaveBeenCalledTimes(1);
    expect(asUserRequest).toHaveBeenCalledTimes(1);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: {
        custom_content_id?: string;
        used_asuser_fallback?: boolean;
        fallback_http_status?: number;
        fallback_error_name?: string;
      };
    }>;
    const succeeded = rows.find((r) => r.event === 'macro_export_succeeded');
    expect(succeeded?.properties?.custom_content_id).toBe('cc-fallback');
    expect(succeeded?.properties?.used_asuser_fallback).toBe(true);
    expect(succeeded?.properties?.fallback_http_status).toBe(200);
    expect(succeeded?.properties?.fallback_error_name).toBeUndefined();
    expect(rows.find((r) => r.event === 'macro_export_failed')).toBeUndefined();

    expect(JSON.stringify(result)).toContain(
      'https://acme.atlassian.net/wiki/download/attachments/444/zenuml-cc-fallback.png',
    );
  });

  it('preserves asApp 404 failure_reason when asUser() fallback also fails, and tags telemetry', async () => {
    asAppRequest.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => '{"errors":[{"status":404,"code":"NOT_FOUND"}]}',
    });
    asUserRequest.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => '{"errors":[{"status":404,"code":"NOT_FOUND"}]}',
    });

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-fb2',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SP',
        accountId: 'acc-fb2',
        extension: { content: { id: '555' } },
      },
      extensionPayload: {
        config: { customContentId: 'cc-fallback-fail' },
      },
    };

    await handler(payload);

    expect(asAppRequest).toHaveBeenCalledTimes(1);
    expect(asUserRequest).toHaveBeenCalledTimes(1);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: {
        failure_reason?: string;
        http_status?: number;
        custom_content_id?: string;
        used_asuser_fallback?: boolean;
        fallback_http_status?: number;
      };
    }>;
    const failed = rows.find((r) => r.event === 'macro_export_failed');
    expect(failed?.properties?.failure_reason).toBe('attachments_api_404');
    expect(failed?.properties?.http_status).toBe(404);
    expect(failed?.properties?.custom_content_id).toBe('cc-fallback-fail');
    expect(failed?.properties?.used_asuser_fallback).toBe(true);
    expect(failed?.properties?.fallback_http_status).toBe(404);
  });

  it('tags telemetry with fallback_error_name when asUser() throws', async () => {
    asAppRequest.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'not found',
    });
    asUserRequest.mockRejectedValue(
      Object.assign(new Error('Authentication Required'), { name: 'NEEDS_AUTHENTICATION_ERR' }),
    );

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-fb3',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SP',
        accountId: 'acc-fb3',
        extension: { content: { id: '777' } },
      },
      extensionPayload: {
        config: { customContentId: 'cc-fb-throw' },
      },
    };

    await handler(payload);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: {
        failure_reason?: string;
        used_asuser_fallback?: boolean;
        fallback_http_status?: number;
        fallback_error_name?: string;
      };
    }>;
    const failed = rows.find((r) => r.event === 'macro_export_failed');
    expect(failed?.properties?.failure_reason).toBe('attachments_api_404');
    expect(failed?.properties?.used_asuser_fallback).toBe(true);
    expect(failed?.properties?.fallback_http_status).toBeUndefined();
    expect(failed?.properties?.fallback_error_name).toBe('NEEDS_AUTHENTICATION_ERR');
  });

  it('does not call asUser() and omits fallback telemetry when asApp() returns a non-404 error', async () => {
    asAppRequest.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'forbidden',
    });

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-403',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SP',
        accountId: 'acc-403',
        extension: { content: { id: '666' } },
      },
      extensionPayload: {
        config: { customContentId: 'cc-403' },
      },
    };

    await handler(payload);

    expect(asAppRequest).toHaveBeenCalledTimes(1);
    expect(asUserRequest).not.toHaveBeenCalled();

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: {
        failure_reason?: string;
        http_status?: number;
        used_asuser_fallback?: boolean;
      };
    }>;
    const failed = rows.find((r) => r.event === 'macro_export_failed');
    expect(failed?.properties?.failure_reason).toBe('needs_authentication');
    expect(failed?.properties?.http_status).toBe(403);
    expect(failed?.properties?.used_asuser_fallback).toBeUndefined();
  });
});
