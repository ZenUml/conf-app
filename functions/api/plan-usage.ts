/// <reference types="@cloudflare/workers-types" />

// Site-level usage summary for the "Plan and usage" globalPage (Lite paywall
// redesign phase 2). Reads the SAME KV aggregate the daily
// `lite-macro-count-daily` scheduled trigger already writes (metricsKey in
// functions/admin/metrics-inspect/index.ts) — no new data pipeline, just a
// tenant-facing read of data that already exists for internal debugging.
//
// Auth: unauthenticated, same trust level as functions/feature-flags.ts (a
// client-supplied `client` domain, no Forge context-token check). This is
// deliberate, not an oversight: macro counts are usage telemetry, not
// financial/PII data — the same trust level this codebase already gives
// feature-flag reads. Do NOT reuse this pattern for anything that gates a
// payment or license decision (see space-status.ts's validateContextToken
// for that stricter bar).
//
// KNOWN GAP (documented, not fixed here): macro-count snapshots are known to
// jump between reads (see docs/... paywall skill note on count-source
// mismatches) — the response's `lastUpdated` / `ageHours` let the caller show
// a staleness hint rather than presenting the number as an exact live count.

interface SpaceMetrics {
  space: string;
  total: number;
  isLite: boolean;
  lastUpdated?: string;
}

interface DomainData {
  domain: string;
  spaces: Record<string, SpaceMetrics>;
}

interface Env {
  confluence_plugin_features: KVNamespace;
}

const MACROS_LIMIT = 100;
const STALE_THRESHOLD_HOURS = 24;

function metricsKey(domain: string): string {
  return `metrics:${domain}:lite`;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { headers: CORS_HEADERS });
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const domain = url.searchParams.get('client') || '';

  if (!domain) {
    return new Response(JSON.stringify({ error: 'missing client domain' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  let domainData: DomainData | null = null;
  try {
    domainData = (await env.confluence_plugin_features.get(metricsKey(domain), 'json')) as DomainData | null;
  } catch (e) {
    console.error('plan-usage: KV read failed', e);
  }

  const spaces = domainData ? Object.values(domainData.spaces) : [];
  const totalMacros = spaces.reduce((sum, s) => sum + (s.total || 0), 0);
  const overLimitSpaces = spaces
    .filter((s) => s.total >= MACROS_LIMIT)
    .map((s) => ({ spaceKey: s.space, macroCount: s.total }))
    .sort((a, b) => b.macroCount - a.macroCount);
  const lastUpdated = spaces
    .map((s) => s.lastUpdated)
    .filter((s): s is string => Boolean(s))
    .sort()
    .pop() || null;
  const ageHours = lastUpdated
    ? (Date.now() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60)
    : null;

  return new Response(
    JSON.stringify({
      domain,
      hasData: domainData !== null,
      totalMacros,
      spaceCount: spaces.length,
      macrosLimit: MACROS_LIMIT,
      overLimitSpaces,
      lastUpdated,
      isStale: ageHours === null ? null : ageHours > STALE_THRESHOLD_HOURS,
    }),
    { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
  );
};
