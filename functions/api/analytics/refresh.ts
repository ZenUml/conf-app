import { response } from '../../OkResponse';
import { refreshAnalyticsAggregates } from '../../utils/analytics';

interface Env {
  DB: D1Database;
  CRON_SECRET?: string;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== 'POST') {
    return response(405, 'Method Not Allowed');
  }

  const secret = request.headers.get('x-cron-secret');
  if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
    return response(401, 'Unauthorized');
  }

  await refreshAnalyticsAggregates(env.DB);
  return Response.json({ ok: true });
};
