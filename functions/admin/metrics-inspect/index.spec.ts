import { describe, it, expect, vi } from 'vitest';
import { onRequest } from './index';

function makeRequest(url: string): Request {
  return new Request(url);
}

function makeEnv(kvData: Record<string, any> = {}) {
  return {
    confluence_plugin_features: {
      get: vi.fn(async (key: string) => kvData[key] ?? null),
    },
  };
}

const baseDomain = 'https://example.com';

describe('metrics-cache/inspect', () => {
  describe('missing parameters', () => {
    it('should return 400 when domain is missing', async () => {
      const res = await onRequest({
        request: makeRequest(`${baseDomain}/metrics-cache/inspect`),
        env: makeEnv(),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('domain');
    });
  });

  describe('single space query', () => {
    it('should return ok when space exists and is fresh', async () => {
      const now = new Date().toISOString();
      const kvData = {
        'metrics:test.atlassian.net:full': {
          domain: 'test.atlassian.net',
          spaces: {
            'DEV': {
              space: 'DEV', total: 10, sequence: 5, graph: 3,
              openapi: 1, mermaid: 1, plantuml: 0, unknown: 0,
              isLite: false, lastUpdated: now,
            },
          },
        },
      };

      const res = await onRequest({
        request: makeRequest(`${baseDomain}/metrics-cache/inspect?domain=test.atlassian.net&space=DEV`),
        env: makeEnv(kvData),
      });

      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.data.total).toBe(10);
      expect(body.diagnosis.kvHasData).toBe(true);
      expect(body.diagnosis.spaceFound).toBe(true);
      expect(body.diagnosis.ageHours).toBeLessThan(1);
    });

    it('should return stale when data is older than threshold', async () => {
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const kvData = {
        'metrics:test.atlassian.net:full': {
          domain: 'test.atlassian.net',
          spaces: {
            'DEV': {
              space: 'DEV', total: 10, sequence: 5, graph: 3,
              openapi: 1, mermaid: 1, plantuml: 0, unknown: 0,
              isLite: false, lastUpdated: oldDate,
            },
          },
        },
      };

      const res = await onRequest({
        request: makeRequest(`${baseDomain}/metrics-cache/inspect?domain=test.atlassian.net&space=DEV`),
        env: makeEnv(kvData),
      });

      const body = await res.json();
      expect(body.status).toBe('stale');
      expect(body.diagnosis.ageHours).toBeGreaterThanOrEqual(24);
    });

    it('should return no_data when space does not exist in domain', async () => {
      const kvData = {
        'metrics:test.atlassian.net:full': {
          domain: 'test.atlassian.net',
          spaces: {
            'DEV': { space: 'DEV', total: 5, sequence: 5, graph: 0, openapi: 0, mermaid: 0, plantuml: 0, unknown: 0, isLite: false },
          },
        },
      };

      const res = await onRequest({
        request: makeRequest(`${baseDomain}/metrics-cache/inspect?domain=test.atlassian.net&space=MISSING`),
        env: makeEnv(kvData),
      });

      const body = await res.json();
      expect(body.status).toBe('no_data');
      expect(body.diagnosis.spaceFound).toBe(false);
      expect(body.diagnosis.domainSpaces).toEqual(['DEV']);
    });

    it('should return no_data when domain has no KV entry', async () => {
      const res = await onRequest({
        request: makeRequest(`${baseDomain}/metrics-cache/inspect?domain=unknown.atlassian.net&space=DEV`),
        env: makeEnv(),
      });

      const body = await res.json();
      expect(body.status).toBe('no_data');
      expect(body.diagnosis.kvHasData).toBe(false);
      expect(body.diagnosis.domainSpaces).toEqual([]);
    });

    it('should use lite key when addonKey contains -lite', async () => {
      const env = makeEnv();
      await onRequest({
        request: makeRequest(`${baseDomain}/metrics-cache/inspect?domain=test.atlassian.net&space=DEV&addonKey=zenuml-lite`),
        env,
      });

      expect(env.confluence_plugin_features.get).toHaveBeenCalledWith(
        'metrics:test.atlassian.net:lite',
        'json'
      );
    });
  });

  describe('domain-wide query (no space)', () => {
    it('should return all spaces with individual statuses', async () => {
      const now = new Date().toISOString();
      const oldDate = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
      const kvData = {
        'metrics:test.atlassian.net:full': {
          domain: 'test.atlassian.net',
          spaces: {
            'DEV': { space: 'DEV', total: 5, sequence: 5, graph: 0, openapi: 0, mermaid: 0, plantuml: 0, unknown: 0, isLite: false, lastUpdated: now },
            'PROD': { space: 'PROD', total: 3, sequence: 3, graph: 0, openapi: 0, mermaid: 0, plantuml: 0, unknown: 0, isLite: false, lastUpdated: oldDate },
          },
        },
      };

      const res = await onRequest({
        request: makeRequest(`${baseDomain}/metrics-cache/inspect?domain=test.atlassian.net`),
        env: makeEnv(kvData),
      });

      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.spaces.DEV.status).toBe('ok');
      expect(body.spaces.PROD.status).toBe('stale');
      expect(body.diagnosis.domainSpaces).toEqual(['DEV', 'PROD']);
    });

    it('should return no_data when domain has no KV entry', async () => {
      const res = await onRequest({
        request: makeRequest(`${baseDomain}/metrics-cache/inspect?domain=unknown.atlassian.net`),
        env: makeEnv(),
      });

      const body = await res.json();
      expect(body.status).toBe('no_data');
    });
  });
});
