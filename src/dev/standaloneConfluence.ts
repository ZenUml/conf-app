import sequence from './fixtures/custom-content-by-id-v1-diagram-sequence.json';
import mermaid from './fixtures/custom-content-by-id-v1-diagram-mermaid.json';
import plantuml from './fixtures/custom-content-by-id-v1-diagram-plantuml.json';
import graph from './fixtures/custom-content-by-id-v1-diagram-graph.json';
import openapi from './fixtures/custom-content-by-id-v1-diagram-openapi.json';

/**
 * Tiny Confluence REST v2 fixture router for standalone local dev
 * (`pnpm start:local`, test-viewer.html, stories rendered as the top frame).
 * Only forgeRequest() calls it, and only when no Forge bridge exists.
 *
 * `url` is the request path without the leading `/wiki`. Resolves to the
 * parsed response body, or `undefined` for a route with no fixture.
 */
const CUSTOM_CONTENT_PREFIX = '/api/v2/custom-content/fake-content-id-diagram-';

const DIAGRAM_FIXTURES: Record<string, unknown> = { sequence, mermaid, plantuml, graph, openapi };

// Fresh copy per call, as a JSON round trip gives: callers may mutate.
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export async function standaloneRequest(url: string, method: string, _body?: string): Promise<unknown> {
  if (url === '/rest/api/user/current') {
    return {
      accountId: 'fake:user-account-id',
      displayName: 'Local Dev User',
      publicName: 'Local Dev User',
      accountType: 'atlassian',
    };
  }

  if (url.startsWith(CUSTOM_CONTENT_PREFIX)) {
    const type = Object.keys(DIAGRAM_FIXTURES).find((t) => url.startsWith(CUSTOM_CONTENT_PREFIX + t));
    if (type) return clone(DIAGRAM_FIXTURES[type]);
  }

  // Default for GET /api/v2/pages/...: ApWrapper2.getCustomContentForCurrentPage()
  // reads `page.status` unguarded, and the sandbox harness uses a non-numeric content id.
  if (method.toLowerCase() === 'get' && url.startsWith('/api/v2/pages/')) {
    return { status: 'current' };
  }

  return undefined;
}
