import {
  CORS,
  JSON_HEADERS,
  handleRenderRequest,
  type RenderEnv,
} from '../../functions/agent-link/renderMcp';
import { DIAGRAM_VIEW_ASSET_PATH } from '../../functions/agent-link/oauth/mcpApps';
import { json } from '../../functions/OkResponse';

export interface Env extends RenderEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Omitted only for isolated previews. Production has one public resource origin. */
  CANONICAL_ORIGIN?: string;
}

interface Context {
  waitUntil(work: Promise<unknown>): void;
}

const CANONICAL_ORIGIN = 'https://zenuml.com';
const PRODUCTION_HOSTS = new Set(['zenuml.com', 'conf-lite.zenuml.com']);
const ENDPOINTS = new Set(['/mcp', '/mcp/', '/mcp/render', '/mcp/render/']);
const BUILD_INFO_PATH = '/mcp-app/build-info.json';

function previewHost(host: string): boolean {
  return host.endsWith('.workers.dev') || host === 'localhost' || host === '127.0.0.1'
    || host === '[::1]' || host === 'test' || host.endsWith('.test');
}

function noStore(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const name of ['Cache-Control', 'CDN-Cache-Control', 'Cloudflare-CDN-Cache-Control']) {
    headers.set(name, 'no-store');
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function error(status: number, message: string): Response {
  return noStore(json({ error: message }, { status, headers: JSON_HEADERS }));
}

function methodNotAllowed(allowed = 'POST, OPTIONS'): Response {
  return noStore(json(
    { error: 'method_not_allowed', message: 'This MCP endpoint accepts POST.' },
    { status: 405, headers: { ...JSON_HEADERS, Allow: allowed } },
  ));
}

async function health(request: Request, env: Env, origin: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return noStore(json({ error: 'method_not_allowed' }, {
      status: 405, headers: { ...JSON_HEADERS, Allow: 'GET, HEAD' },
    }));
  }
  try {
    const asset = await env.ASSETS.fetch(new Request(`${origin}${BUILD_INFO_PATH}`));
    if (!asset.ok) return error(503, 'build_metadata_unavailable');
    const metadata = await asset.json() as Record<string, unknown>;
    if (typeof metadata.version !== 'string' || !/^[a-f0-9]{40}$/.test(String(metadata.commit))
      || typeof metadata.dirty !== 'boolean' || typeof metadata.builtAt !== 'string'
      || !/^[a-f0-9]{64}$/.test(String(metadata.viewSha256))) {
      return error(503, 'build_metadata_unavailable');
    }
    // Only known non-secret build fields escape this endpoint.
    const response = noStore(json({
      service: 'zenuml-render-mcp',
      version: metadata.version,
      commit: metadata.commit,
      dirty: metadata.dirty,
      builtAt: metadata.builtAt,
      viewSha256: metadata.viewSha256,
    }, { headers: JSON_HEADERS }));
    return response;
  } catch {
    return error(503, 'build_metadata_unavailable');
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    const url = new URL(request.url);
    const production = PRODUCTION_HOSTS.has(url.hostname);
    const configured = env.CANONICAL_ORIGIN !== undefined;
    if (!production && (configured || !previewHost(url.hostname))) {
      return error(421, 'unrecognized_host');
    }
    if (configured && env.CANONICAL_ORIGIN !== CANONICAL_ORIGIN) {
      return error(503, 'invalid_canonical_origin');
    }
    const origin = env.CANONICAL_ORIGIN ?? url.origin;

    // Dispatch health before deciding whether this request belongs to the
    // shared website origin. A missing health route must never look green.
    if (url.pathname === '/mcp/health') {
      const response = await health(request, env, origin);
      return request.method === 'HEAD' ? new Response(null, response) : response;
    }

    if (ENDPOINTS.has(url.pathname)) {
      if (request.method === 'OPTIONS') {
        return noStore(new Response(null, { headers: CORS }));
      }
      if (request.method !== 'POST') {
        const response = methodNotAllowed();
        return request.method === 'HEAD' ? new Response(null, response) : response;
      }
      // Both public aliases receive identical UI resource URLs and CSP.
      // Credentials are irrelevant: the shared handler never reads them and
      // exposes only the public rendering tool, never Confluence operations.
      const canonical = new Request(`${origin}/mcp`, request);
      try {
        return noStore(await handleRenderRequest(canonical, env, {
          waitUntil: (work) => ctx.waitUntil(work),
          fetchImpl: async (assetUrl) => {
            if (assetUrl !== `${origin}${DIAGRAM_VIEW_ASSET_PATH}`) {
              throw new Error('Unexpected MCP resource path');
            }
            // No public network fetch, origin recursion, or Pages SPA fallback.
            return env.ASSETS.fetch(new Request(assetUrl));
          },
        }));
      } catch {
        return noStore(json({
          jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal server error' },
        }, { status: 500, headers: JSON_HEADERS }));
      }
    }

    // conf-lite also serves authenticated Confluence MCP views. Its existing
    // /mcp-app and /drawio assets must continue to come from its Pages origin.
    const staticScope = url.hostname !== 'conf-lite.zenuml.com'
      && (url.pathname.startsWith('/mcp-app/') || url.pathname.startsWith('/drawio/'));
    if (staticScope) {
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      if (response.ok) {
        headers.set('Cache-Control', url.pathname.startsWith('/mcp-app/assets/')
          ? 'public, max-age=31536000, immutable' : 'no-cache');
      }
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }

    // Route-bound Worker fetch goes to the original Pages origin. Never build
    // a destination from query parameters, forwarding headers, or an env URL.
    // A workers.dev/local preview has no underlying website origin to fetch.
    return production ? fetch(request) : error(404, 'not_found');
  },
};
