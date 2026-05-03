import { response } from '../../OkResponse';
import {
  purgeAnalyticsFactRetention,
  refreshAnalyticsAggregates,
  replayAnalyticsEventsFromR2,
} from '../../utils/analytics';

interface Env {
  DB: D1Database;
  CRON_SECRET?: string;
  EVENT_BUCKET?: R2Bucket;
}

interface OperationBody {
  action?: 'refresh' | 'purge' | 'replay';
  keepDays?: number;
  prefix?: string;
  limit?: number;
  cursor?: string;
  refreshAggregates?: boolean;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== 'POST') {
    return response(405, 'Method Not Allowed');
  }

  const secret = request.headers.get('x-cron-secret');
  if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
    return response(401, 'Unauthorized');
  }

  const body = await request.json<OperationBody>().catch(() => ({}));
  const action = body.action || 'refresh';

  if (action === 'refresh') {
    await refreshAnalyticsAggregates(env.DB);
    return Response.json({ ok: true, action });
  }

  if (action === 'purge') {
    const result = await purgeAnalyticsFactRetention(env.DB, Math.max(body.keepDays || 90, 1));
    return Response.json({ ok: true, action, ...result });
  }

  if (action === 'replay') {
    const result = await replayAnalyticsEventsFromR2(env.DB, env.EVENT_BUCKET, {
      prefix: body.prefix,
      limit: body.limit,
      cursor: body.cursor,
      refreshAggregates: body.refreshAggregates,
    });
    return Response.json({ ok: true, action, ...result });
  }

  return response(400, 'Unsupported analytics operation');
};
