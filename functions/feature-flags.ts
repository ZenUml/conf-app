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

async function handleLitePngExport(
  kvService: KVNamespace,
  client: string,
  result: Record<string, unknown>,
) {
  const litePngExportKeys = ['LITE_PNG_EXPORT_ENABLED', 'LITE_PNG_EXPORT_TRIAL', 'LITE_PNG_EXPORT_LOCKED'];
  for (const key of litePngExportKeys) {
    const raw = await kvService.get(key);
    const ENABLED_DOMAINS: string[] = raw?.split(',') || [];
    if (ENABLED_DOMAINS.some((d) => d !== '' && client === d)) {
      const flagType = key.split('_').pop();
      if (flagType) {
        result.LITE_PNG_EXPORT = { status: flagType };
        break;
      }
    }
  }
}

async function handleAiTitles(
  kvService: KVNamespace,
  client: string,
  result: Record<string, unknown>,
) {
  const raw = await kvService.get('AI_TITLE_ENABLED_DOMAINS');
  const ENABLED_DOMAINS: string[] = raw?.split(',') || [];
  result.AI_TITLE = { enabled: ENABLED_DOMAINS.some((d) => client.includes(d)) };
}

async function handlePersonaAwarePaywall(
  kvService: KVNamespace,
  client: string,
  result: Record<string, unknown>,
) {
  const raw = await kvService.get('PERSONA_AWARE_PAYWALL');
  const ENABLED_DOMAINS: string[] = raw?.split(',') || [];
  if (ENABLED_DOMAINS.some((d) => d !== '' && client === d)) {
    result.PERSONA_AWARE_PAYWALL = true;
  }
}

function handleTest(result: Record<string, unknown>) {
  result.TEST = { enabled: true, data: 'test data' };
}

export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
  const url = new URL(request.url);
  const client = url.searchParams.get('client') || '';
  const featuresParam = url.searchParams.get('features') || '';
  const queryAll = url.searchParams.get('queryAll') === 'true';

  if (!client) return new Response('Invalid client field', { status: 400 });
  if (!featuresParam) return new Response('Invalid features field', { status: 400 });

  const features = featuresParam.split(',');
  const kvService = env.KV_FEATURE_FLAGS;
  const result: Record<string, unknown> = {};

  for (const feat of features) {
    if (queryAll || feat === 'CUSTOMER_SUCCESS_SERVICE') {
      await handleCustomerSuccessService(kvService, client, result);
    }
    if (queryAll || feat === 'LITE_PNG_EXPORT') {
      await handleLitePngExport(kvService, client, result);
    }
    if (queryAll || feat === 'AI_TITLE') {
      await handleAiTitles(kvService, client, result);
    }
    if (queryAll || feat === 'PERSONA_AWARE_PAYWALL') {
      await handlePersonaAwarePaywall(kvService, client, result);
    }
    if (queryAll || feat === 'TEST') {
      handleTest(result);
    }
  }

  return Response.json(result);
}
