import { Env } from '../utils/KVEnv';

interface SpaceMetrics {
  space: string;
  total: number;
  sequence: number;
  graph: number;
  openapi: number;
  mermaid: number;
  plantuml: number;
  unknown: number;
  isLite: boolean;
  lastUpdated?: string;
}

interface DomainData {
  domain: string;
  spaces: Record<string, SpaceMetrics>;
}

type InspectStatus = 'ok' | 'stale' | 'no_data';

const STALE_THRESHOLD_HOURS = 24;

function computeAgeHours(lastUpdated: string | undefined): number {
  if (!lastUpdated) return Infinity;
  const updatedAt = new Date(lastUpdated).getTime();
  const now = Date.now();
  return Math.round((now - updatedAt) / (1000 * 60 * 60) * 10) / 10;
}

function computeStatus(spaceFound: boolean, ageHours: number): InspectStatus {
  if (!spaceFound) return 'no_data';
  if (ageHours >= STALE_THRESHOLD_HOURS) return 'stale';
  return 'ok';
}

function buildSpaceResponse(
  kvKey: string,
  domainData: DomainData | null,
  space: string
) {
  const kvHasData = domainData !== null;
  const domainSpaces = domainData ? Object.keys(domainData.spaces) : [];
  const spaceData = domainData?.spaces?.[space] ?? null;
  const spaceFound = spaceData !== null;
  const ageHours = spaceData ? computeAgeHours(spaceData.lastUpdated) : 0;
  const status = computeStatus(spaceFound, ageHours);

  return {
    status,
    data: spaceData,
    diagnosis: {
      kvKey,
      kvHasData,
      domainSpaces,
      spaceFound,
      lastUpdated: spaceData?.lastUpdated ?? null,
      ageHours: spaceFound ? ageHours : null,
      staleThresholdHours: STALE_THRESHOLD_HOURS,
    },
  };
}

function buildDomainResponse(
  kvKey: string,
  domainData: DomainData | null
) {
  if (!domainData || Object.keys(domainData.spaces).length === 0) {
    return {
      status: 'no_data' as InspectStatus,
      data: null,
      diagnosis: {
        kvKey,
        kvHasData: domainData !== null,
        domainSpaces: [],
        staleThresholdHours: STALE_THRESHOLD_HOURS,
      },
    };
  }

  const spaces: Record<string, ReturnType<typeof buildSpaceResponse>> = {};
  for (const spaceKey of Object.keys(domainData.spaces)) {
    spaces[spaceKey] = buildSpaceResponse(kvKey, domainData, spaceKey);
  }

  return {
    status: 'ok' as InspectStatus,
    spaces,
    diagnosis: {
      kvKey,
      kvHasData: true,
      domainSpaces: Object.keys(domainData.spaces),
      staleThresholdHours: STALE_THRESHOLD_HOURS,
    },
  };
}

export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
  const url = new URL(request.url);
  const domain = url.searchParams.get('domain');
  const space = url.searchParams.get('space');
  const addonKey = url.searchParams.get('addonKey') || '';

  if (!domain) {
    return new Response(JSON.stringify({ error: 'Missing domain parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const isLite = addonKey.includes('-lite');
  const productType = isLite ? 'lite' : 'full';
  const kvKey = `metrics:${domain}:${productType}`;

  const domainData = await env.confluence_plugin_features.get(kvKey, 'json') as DomainData | null;

  const result = space
    ? buildSpaceResponse(kvKey, domainData, space)
    : buildDomainResponse(kvKey, domainData);

  return new Response(JSON.stringify(result, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
};
