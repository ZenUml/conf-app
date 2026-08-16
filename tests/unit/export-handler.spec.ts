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

    // 2 asApp() calls: macro_type lookup (custom-content GET), then the
    // attachments GET that 404s and triggers the asUser() fallback below.
    expect(asAppRequest).toHaveBeenCalledTimes(2);
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

    // 2 asApp() calls: macro_type lookup (custom-content GET), then the
    // attachments GET that 404s and triggers the asUser() fallback below.
    expect(asAppRequest).toHaveBeenCalledTimes(2);
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

  it('uses subdomain prefix as client_domain in analytics events', async () => {
    asAppRequest.mockRejectedValue(new Error('forced failure'));

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-sub',
        siteUrl: 'https://example-tenant.atlassian.net',
        spaceKey: 'SP',
        accountId: 'acc-sub',
        extension: { content: { id: '999' } },
      },
      extensionPayload: { config: { customContentId: 'cc-sub' } },
    };

    await handler(payload);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { client_domain?: string };
    }>;
    const failed = rows.find((r) => r.event === 'macro_export_failed');
    expect(failed?.properties?.client_domain).toBe('example-tenant');
  });

  it('#435: carries macro_type (resolved from custom content) on macro_export_succeeded', async () => {
    // First asApp() call = macro_type lookup (custom-content GET); second = attachments GET.
    asAppRequest
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ body: { raw: { value: JSON.stringify({ diagramType: 'mermaid' }) } } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          results: [{ downloadLink: '/wiki/download/attachments/888/zenuml-cc-mermaid.png' }],
          _links: { base: 'https://acme.atlassian.net' },
        }),
      });

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-mmd',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SP',
        accountId: 'acc-mmd',
        extension: { content: { id: '888' } },
      },
      extensionPayload: { config: { customContentId: 'cc-mermaid' } },
    };

    await handler(payload);

    expect(asAppRequest).toHaveBeenCalledTimes(2);
    expect(String(asAppRequest.mock.calls[0][0])).toContain('/custom-content/cc-mermaid');

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { macro_type?: string };
    }>;
    expect(rows.find((r) => r.event === 'macro_export_requested')?.properties?.macro_type).toBe('mermaid');
    expect(rows.find((r) => r.event === 'macro_export_succeeded')?.properties?.macro_type).toBe('mermaid');
  });

  it('#435: carries the resolved macro_type on macro_export_failed (attachment_not_found), so type-sized failure queries work', async () => {
    asAppRequest
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ body: { raw: { value: JSON.stringify({ diagramType: 'graph' }) } } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ results: [], _links: { base: 'https://acme.atlassian.net' } }),
      });

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-graph',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SP',
        accountId: 'acc-graph',
        extension: { content: { id: '890' } },
      },
      extensionPayload: { config: { customContentId: 'cc-graph' } },
    };

    await handler(payload);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { failure_reason?: string; macro_type?: string };
    }>;
    const failed = rows.find((r) => r.event === 'macro_export_failed');
    expect(failed?.properties?.failure_reason).toBe('attachment_not_found');
    expect(failed?.properties?.macro_type).toBe('graph');
  });

  it('#435: records macro_type "none" (not omitted) when the type genuinely cannot be determined — no customContentId', async () => {
    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-nocc',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SP',
        accountId: 'acc-nocc',
        extension: { content: { id: '891' } },
      },
      extensionPayload: { config: { customContentId: null } },
    };

    await handler(payload);

    expect(asAppRequest).not.toHaveBeenCalled();

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { failure_reason?: string; macro_type?: string };
    }>;
    const failed = rows.find((r) => r.event === 'macro_export_failed');
    expect(failed?.properties?.failure_reason).toBe('missing_custom_content_id');
    expect(failed?.properties?.macro_type).toBe('none');
  });

  it('#435: records macro_type "none" when the custom-content lookup itself fails (page restricted, content deleted, etc.)', async () => {
    asAppRequest
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => '' }) // macro_type lookup 404s
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          results: [{ downloadLink: '/wiki/download/attachments/892/zenuml-cc-unknown.png' }],
          _links: { base: 'https://acme.atlassian.net' },
        }),
      });

    const payload = {
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-unk',
        siteUrl: 'https://acme.atlassian.net',
        spaceKey: 'SP',
        accountId: 'acc-unk',
        extension: { content: { id: '892' } },
      },
      extensionPayload: { config: { customContentId: 'cc-unknown-type' } },
    };

    await handler(payload);

    const rows = mixpanelBodiesFromFetch(fetch) as Array<{
      event?: string;
      properties?: { macro_type?: string };
    }>;
    expect(rows.find((r) => r.event === 'macro_export_succeeded')?.properties?.macro_type).toBe('none');
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

    // 2 asApp() calls: macro_type lookup (custom-content GET), then the
    // attachments GET that 403s (non-404, so no asUser() fallback).
    expect(asAppRequest).toHaveBeenCalledTimes(2);
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
