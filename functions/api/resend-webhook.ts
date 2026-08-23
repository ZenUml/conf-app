import { OkResponse, response } from '../OkResponse';
import {
  parseResendLifecycleEvent,
  recordResendLifecycleEvent,
  ResendWebhookError,
  verifyResendWebhookSignature,
} from '../service/resendWebhook';

interface Env {
  DB: D1Database;
  RESEND_WEBHOOK_SECRET?: string;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== 'POST') return response(405, 'Method not allowed');
  if (!env.DB || !env.RESEND_WEBHOOK_SECRET) return response(503, 'Webhook is not configured');
  const rawBody = await request.text();
  try {
    const verified = await verifyResendWebhookSignature({
      rawBody,
      eventId: request.headers.get('svix-id'),
      timestamp: request.headers.get('svix-timestamp'),
      signature: request.headers.get('svix-signature'),
      secret: env.RESEND_WEBHOOK_SECRET,
    });
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return response(400, 'Invalid JSON body');
    }
    const event = parseResendLifecycleEvent(payload);
    if (!event) return OkResponse({ accepted: false, ignored: true });
    const result = await recordResendLifecycleEvent(env.DB, { ...event, eventId: verified.eventId });
    return OkResponse({ accepted: true, replay: result.replay });
  } catch (error) {
    if (error instanceof ResendWebhookError) return response(401, 'Invalid webhook signature');
    console.error('Resend webhook failed', {
      reason: error instanceof Error ? error.name : 'unknown_error',
    });
    return response(500, 'Internal server error');
  }
};

