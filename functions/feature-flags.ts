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
  }

  return Response.json(result, { headers: CORS_HEADERS });
}
