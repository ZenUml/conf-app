import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('Forge export resolver — PlantUML attachment fallback', () => {
  beforeEach(() => {
    process.env.MIXPANEL_TOKEN = 'unit-test-token';
    asAppRequest.mockReset();
    asUserRequest.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MIXPANEL_TOKEN;
  });

  it('does not fetch PlantUML from the Forge backend when the attachment is missing', async () => {
    asAppRequest.mockImplementation(async (url: string) => {
      if (url.includes('/attachments')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ results: [], _links: { base: 'https://example.atlassian.net' } }),
        };
      }
      if (url.includes('/custom-content/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            body: { raw: { value: JSON.stringify({ diagramType: 'plantuml' }) } },
          }),
        };
      }
      throw new Error(`unexpected asApp() call: ${url}`);
    });

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('mixpanel')) {
        return { ok: true, status: 200, text: async () => '' };
      }
      throw new Error(`unexpected external fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await handler({
      exportType: 'pdf',
      context: {
        cloudId: 'cloud-1',
        siteUrl: 'https://example.atlassian.net',
        spaceKey: 'SP',
        accountId: 'account-1',
        extension: { content: { id: 'page-1' } },
      },
      extensionPayload: { config: { customContentId: 'content-1' } },
    });

    expect(JSON.stringify(result)).toContain('not yet generated');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('plantuml.com'))).toBe(false);
  });
});
