/// <reference types="@cloudflare/workers-types" />

import { evaluatePaywallExemption } from './service/paywallPolicy';

interface Env {
  KV_FEATURE_FLAGS: KVNamespace;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Legacy unauthenticated `/feature-flags` endpoint retained only for `PAYWALL_EXEMPT`
 * while older cached frontends transition to reading `paywallExempt` from
 * authenticated `/api/space-status` (#1164). `CUSTOMER_SUCCESS_SERVICE` and
 * `queryAll` have been removed.
 */
export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const client = url.searchParams.get('client') || '';
  const featuresParam = url.searchParams.get('features') || '';

  if (!client) return new Response('Invalid client field', { status: 400, headers: CORS_HEADERS });
  if (!featuresParam) return new Response('Invalid features field', { status: 400, headers: CORS_HEADERS });

  const features = featuresParam.split(',');
  const result: Record<string, unknown> = {};

  if (features.includes('PAYWALL_EXEMPT')) {
    const exempt = await evaluatePaywallExemption(env.KV_FEATURE_FLAGS, client);
    if (typeof exempt === 'boolean') {
      result.PAYWALL_EXEMPT = exempt;
    }
  }

  return Response.json(result, { headers: CORS_HEADERS });
}
