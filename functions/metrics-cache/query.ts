import { json } from '../OkResponse';
import type { ForgeRequestData } from '../utils/authenticate';
import {
  authenticateMetricsRequest,
  errorResponse,
  isSnapshotEnrolled,
  NO_STORE_HEADERS,
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
      return json({ error: 'Method Not Allowed' }, { status: 405, headers: NO_STORE_HEADERS });
    }
    const url = new URL(request.url);
    const space = url.searchParams.get('space');
    if (!space) return json({ error: 'Missing space parameter' }, { status: 400, headers: NO_STORE_HEADERS });

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
      return json({ mode, metrics }, { headers: NO_STORE_HEADERS });
    }
    if (!metrics) return new Response(null, { status: 404 });
    return json(metrics, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
};
