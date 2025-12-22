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
  lastUpdated?: string;
}

interface DomainData {
  domain: string;
  spaces: Record<string, SpaceMetrics>;
}

export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(request.url);
  const addonKey = url.searchParams.get('addonKey') || '';
  const { domain, space, metrics } = await request.json();

  if (!domain || !space || !metrics) {
    return new Response('Missing required fields', { status: 400 });
  }

  const isLite = addonKey.includes('-lite');
  const productType = isLite ? 'lite' : 'full';
  const key = `metrics:${domain}:${productType}`;

  // Read current domain data
  let domainData = await env.confluence_plugin_features.get(key, 'json') as DomainData | null;

  if (!domainData) {
    // Create new domain data
    domainData = {
      domain,
      spaces: {}
    };
  }

  // Update the specific space
  domainData.spaces[space] = {
    ...metrics,
    lastUpdated: new Date().toISOString()
  };

  // Write back with 365-day TTL (safety cleanup for abandoned domains)
  await env.confluence_plugin_features.put(
    key,
    JSON.stringify(domainData),
    { expirationTtl: 31536000 } // 365 days
  );

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
