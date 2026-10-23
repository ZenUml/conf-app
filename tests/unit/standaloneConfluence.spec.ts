import { describe, it, expect } from 'vitest';
import { standaloneRequest } from '@/dev/standaloneConfluence';
import sequence from '@/dev/fixtures/custom-content-by-id-v1-diagram-sequence.json';
import mermaid from '@/dev/fixtures/custom-content-by-id-v1-diagram-mermaid.json';
import plantuml from '@/dev/fixtures/custom-content-by-id-v1-diagram-plantuml.json';
import graph from '@/dev/fixtures/custom-content-by-id-v1-diagram-graph.json';
import openapi from '@/dev/fixtures/custom-content-by-id-v1-diagram-openapi.json';

describe('standalone Confluence fixture router', () => {
  it('stubs the current user', async () => {
    expect(await standaloneRequest('/rest/api/user/current', 'GET')).toEqual({
      accountId: 'fake:user-account-id',
      displayName: 'Local Dev User',
      publicName: 'Local Dev User',
      accountType: 'atlassian',
    });
  });

  it.each([
    ['sequence', sequence],
    ['mermaid', mermaid],
    ['plantuml', plantuml],
    ['graph', graph],
    ['openapi', openapi],
  ])('serves the %s v2 custom-content fixture', async (type, fixture) => {
    expect(await standaloneRequest(`/api/v2/custom-content/fake-content-id-diagram-${type}`, 'GET')).toEqual(fixture);
    expect(
      await standaloneRequest(`/api/v2/custom-content/fake-content-id-diagram-${type}?body-format=raw`, 'GET'),
    ).toEqual(fixture);
  });

  it('answers any GET /api/v2/pages/ with a current page', async () => {
    expect(await standaloneRequest('/api/v2/pages/12345?body-format=storage', 'GET')).toEqual({ status: 'current' });
    expect(await standaloneRequest('/api/v2/pages/abc', 'get')).toEqual({ status: 'current' });
  });

  it('returns undefined for unmatched routes', async () => {
    expect(await standaloneRequest('/api/v2/custom-content', 'POST', '{}')).toBeUndefined();
    expect(await standaloneRequest('/api/v2/custom-content/123', 'GET')).toBeUndefined();
    expect(await standaloneRequest('/api/v2/pages/1', 'POST')).toBeUndefined();
    expect(await standaloneRequest('/rest/api/search?cql=x', 'GET')).toBeUndefined();
  });
});
