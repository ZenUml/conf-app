import { Env } from '../utils/KVEnv';

interface SpaceMetrics {
  space: string;
  total: number;
  sequence: number;
  graph: number;
  openapi: number;
  mermaid: number;
  unknown: number;
  isLite: boolean;
  lastUpdated: string;
}

interface DomainData {
  domain: string;
  spaces: Record<string, SpaceMetrics>;
}

export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  const url = new URL(request.url);
  const domain = url.searchParams.get('domain');
  const space = url.searchParams.get('space');
  const addonKey = url.searchParams.get('addonKey') || '';

  if (!domain || !space) {
    return new Response('Missing domain or space parameter', { status: 400 });
  }

  const isLite = addonKey.includes('-lite');
  const productType = isLite ? 'lite' : 'full';
  const key = `metrics:${domain}:${productType}`;
  const domainData = await env.confluence_plugin_features.get(key, 'json') as DomainData | null;

  if (!domainData || !domainData.spaces || !domainData.spaces[space]) {
    return new Response(null, { status: 404 });
  }

  return new Response(JSON.stringify(domainData.spaces[space]), {
    headers: { 'Content-Type': 'application/json' }
  });
};
