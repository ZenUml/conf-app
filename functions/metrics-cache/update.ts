import type { ForgeRequestData } from '../utils/authenticate';
import {
  KV_EXPIRATION_TTL_SECONDS,
  assertCounts,
  authenticateMetricsRequest,
  errorResponse,
  isSnapshotEnrolled,
  jsonResponse,
  metricsKvKey,
  normalizeCounts,
  readLatestPointer,
  type DomainMetrics,
  type MacroCounts,
  type SnapshotEnv,
} from './snapshot/common';

interface LegacyUpdateBody extends Record<string, unknown> {
  domain?: string;
  space?: string;
  metrics?: MacroCounts & Record<string, unknown>;
}

export const onRequest = async ({
  request,
  env,
  data,
}: {
  request: Request;
  env: SnapshotEnv;
  data: ForgeRequestData;
}) => {
  try {
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method Not Allowed' }, 405);
    }
    let body: LegacyUpdateBody;
    try {
      body = await request.json<LegacyUpdateBody>();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }
    if (typeof body.space !== 'string' || !body.space || !body.metrics) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }

    const context = await authenticateMetricsRequest(request, env, {
      body,
      forgeContext: data.forgeContext,
    });
    const enrolled = await isSnapshotEnrolled(env, context);
    if (enrolled && await readLatestPointer(env, context)) {
      return jsonResponse({ success: true, ignored: 'snapshot-managed' });
    }

    assertCounts(body.metrics);
    const key = metricsKvKey(context);
    const domainData = await env.confluence_plugin_features.get(key, 'json') as DomainMetrics | null
      || { domain: context.clientDomain, spaces: {} };
    domainData.domain = context.clientDomain;
    domainData.spaces[body.space] = {
      space: body.space,
      // normalizeCounts, not a field-by-field copy: assertCounts tolerates an
      // absent bucket (a client predating it — the total-vs-buckets invariant
      // still holds), so copying raw would persist `undefined` for any bucket
      // the client omitted. Every bucket lands as a number or not at all.
      ...normalizeCounts(body.metrics),
      isLite: context.productType === 'lite',
      lastUpdated: new Date().toISOString(),
    };
    await env.confluence_plugin_features.put(key, JSON.stringify(domainData), {
      expirationTtl: KV_EXPIRATION_TTL_SECONDS,
    });
    return jsonResponse({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
};
