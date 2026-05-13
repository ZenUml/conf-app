import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { requestConfluence } = vi.hoisted(() => ({
  requestConfluence: vi.fn(),
}));

vi.mock('@forge/api', () => ({
  default: {
    asUser: () => ({ requestConfluence }),
    asApp: () => ({ requestConfluence }),
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
    requestConfluence.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MIXPANEL_TOKEN;
  });

  it('includes custom_content_id on macro_export_failed when catch runs (Word config path)', async () => {
    requestConfluence.mockRejectedValue(new Error('forced attachments failure'));

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
    requestConfluence.mockRejectedValue(new Error('forced attachments failure'));

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
    requestConfluence.mockRejectedValue(authErr);

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
    requestConfluence.mockResolvedValue({
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
});
