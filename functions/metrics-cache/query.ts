import type { ForgeRequestData } from '../utils/authenticate';
import {
  authenticateMetricsRequest,
  errorResponse,
  isSnapshotEnrolled,
  jsonResponse,
  metricsKvKey,
  readLatestPointer,
  type DomainMetrics,
  type SnapshotEnv,
} from './snapshot/common';

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
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'Method Not Allowed' }, 405);
    }
    const url = new URL(request.url);
    const space = url.searchParams.get('space');
    if (!space) return jsonResponse({ error: 'Missing space parameter' }, 400);

    const context = await authenticateMetricsRequest(request, env, {
      forgeContext: data.forgeContext,
    });
    const enrolled = await isSnapshotEnrolled(env, context);
    const latest = enrolled ? await readLatestPointer(env, context) : null;
    const mode = latest ? 'snapshot' : 'legacy';
    const domainData = await env.confluence_plugin_features.get(
      metricsKvKey(context),
      'json',
    ) as DomainMetrics | null;
    const metrics = domainData?.spaces?.[space] ?? null;

    if (url.searchParams.get('contract') === '2') {
      return jsonResponse({ mode, metrics });
    }
    if (!metrics) return new Response(null, { status: 404 });
    return jsonResponse(metrics);
  } catch (error) {
    return errorResponse(error);
  }
};
