import { response } from '../../OkResponse';
import { buildExploreQuery } from '../../utils/analyticsQueries';

interface Env {
  DB: D1Database;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== 'GET') {
    return response(405, 'Method Not Allowed');
  }

  const url = new URL(request.url);

  try {
    const { sql, params } = buildExploreQuery({
      metric: (url.searchParams.get('metric') || 'count') as never,
      groupBy: (url.searchParams.get('groupBy') || undefined) as never,
      startDate: url.searchParams.get('startDate') || undefined,
      endDate: url.searchParams.get('endDate') || undefined,
      event: url.searchParams.get('event') || undefined,
      clientDomain: url.searchParams.get('clientDomain') || undefined,
      confluenceSpace: url.searchParams.get('confluenceSpace') || undefined,
      diagramType: url.searchParams.get('diagramType') || undefined,
      eventCategory: url.searchParams.get('eventCategory') || undefined,
      isLite: url.searchParams.get('isLite') || undefined,
      limit: Number(url.searchParams.get('limit') || '100'),
    });

    const results = await env.DB.prepare(sql).bind(...params).all<Record<string, unknown>>();
    return Response.json({
      rows: results.results || [],
    });
  } catch (error) {
    return response(400, error instanceof Error ? error.message : 'Invalid analytics query');
  }
};
