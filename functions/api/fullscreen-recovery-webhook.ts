import { json } from '../OkResponse';
import { emitFullscreenRecoveryEvent } from '../service/fullscreenRecoveryService';
import { MailWebhookError, parseMailWebhook, recordMailWebhook, verifyMailWebhook } from '../service/fullscreenRecoveryMailWebhook';

interface Env {
  DB?: D1Database;
  RESEND_WEBHOOK_SECRET?: string;
  MIXPANEL_TOKEN?: string;
}
const reply = (body: unknown, status = 200) => json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export const onRequest: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  if (!env.DB || !env.RESEND_WEBHOOK_SECRET) return reply({ error: 'webhook_unavailable' }, 503);
  const rawBody = await request.text();
  if (rawBody.length > 64_000) return reply({ error: 'payload_too_large' }, 413);
  let eventId: string;
  try {
    eventId = await verifyMailWebhook({ rawBody, id: request.headers.get('svix-id'),
      timestamp: request.headers.get('svix-timestamp'), signature: request.headers.get('svix-signature'),
      secret: env.RESEND_WEBHOOK_SECRET });
  } catch (error) {
    if (error instanceof MailWebhookError) return reply({ error: 'invalid_signature' }, 401);
    return reply({ error: 'webhook_unavailable' }, 503);
  }
  let payload: unknown;
  try { payload = JSON.parse(rawBody); }
  catch { return reply({ error: 'invalid_json' }, 400); }
  const event = parseMailWebhook(payload);
  if (!event) return reply({ ignored: true });
  try {
    const recorded = await recordMailWebhook(env.DB, { ...event, eventId });
    if (recorded.changed && recorded.outboxId && recorded.requestId && recorded.state) {
      emitFullscreenRecoveryEvent(env, 'fullscreen_recovery_mail_status_changed',
        `${recorded.outboxId}:mail:${recorded.state}`, recorded.requestId,
        { recovery_request_id: recorded.requestId, recovery_mail_id: recorded.outboxId,
          mail_state: recorded.state, template_version: 'requester-first-reply-v1',
          surface: 'support_automation' }, waitUntil);
    }
    return reply({ accepted: true, ignored: recorded.ignored, pending: recorded.pending, replay: recorded.replay });
  } catch (error) {
    console.error('[fullscreen-recovery-mail] webhook failed', { reason: error instanceof Error ? error.name : 'unknown' });
    return reply({ error: 'webhook_unavailable' }, 503);
  }
};
