/// <reference types="@cloudflare/workers-types" />

interface Env {
  KV_FEATURE_FLAGS: KVNamespace;
}

async function handleCustomerSuccessService(
  kvService: KVNamespace,
  clientDomainInQuery: string,
  result: Record<string, unknown>,
) {
  try {
    const customerSuccessService = await kvService.get('CUSTOMER_SUCCESS_SERVICE');
    if (!customerSuccessService) return;
    const customerSuccessServiceObj = JSON.parse(customerSuccessService);
    const ENABLED_DOMAINS = Object.keys(customerSuccessServiceObj);
    const client = ENABLED_DOMAINS.find((d) => d !== '' && clientDomainInQuery === d);
    if (client) {
      result.CUSTOMER_SUCCESS_SERVICE = customerSuccessServiceObj[client];
    }
  } catch (e) {
    console.error(e);
  }
}

/**
 * Lite paywall default-on exemption decision (docs/superpowers/specs/
 * 2026-08-04-lite-paywall-default-on-design.md). Reads `PAYWALL_EXEMPTIONS`
 * — a JSON object keyed by Confluence subdomain prefix, boolean values only,
 * with `"*"` as the fleet-wide kill switch. On any missing/unreadable/
 * malformed/non-object/non-boolean-valued input, leave `PAYWALL_EXEMPT`
 * ABSENT from the result rather than defaulting it to `false` — a missing
 * result is an unavailable decision, not evidence the tenant is safe to
 * restrict (the frontend composable turns an absent property into
 * `fail_open`, which disables the paywall).
 */
function isBooleanOnlyObject(value: unknown): value is Record<string, boolean> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === 'boolean');
}

async function handlePaywallExempt(
  kvService: KVNamespace,
  clientDomainInQuery: string,
  result: Record<string, unknown>,
) {
  try {
    const raw = await kvService.get('PAYWALL_EXEMPTIONS');
    if (!raw) return;
    const exemptions: unknown = JSON.parse(raw);
    if (!isBooleanOnlyObject(exemptions)) return;
    result.PAYWALL_EXEMPT = exemptions['*'] === true || exemptions[clientDomainInQuery] === true;
  } catch (e) {
    console.error(e);
  }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const client = url.searchParams.get('client') || '';
  const featuresParam = url.searchParams.get('features') || '';
  const queryAll = url.searchParams.get('queryAll') === 'true';

  if (!client) return new Response('Invalid client field', { status: 400, headers: CORS_HEADERS });
  if (!featuresParam) return new Response('Invalid features field', { status: 400, headers: CORS_HEADERS });

  const features = featuresParam.split(',');
  const kvService = env.KV_FEATURE_FLAGS;
  const result: Record<string, unknown> = {};

  for (const feat of features) {
    if (queryAll || feat === 'CUSTOMER_SUCCESS_SERVICE') {
      await handleCustomerSuccessService(kvService, client, result);
    }
    if (queryAll || feat === 'PAYWALL_EXEMPT') {
      await handlePaywallExempt(kvService, client, result);
    }
  }

  return Response.json(result, { headers: CORS_HEADERS });
}
