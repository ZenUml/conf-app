import { json } from '../../OkResponse';
import { authenticateRecoverySupport, emitFullscreenRecoveryEvent, getRecoveryCase } from '../../service/fullscreenRecoveryService';
import {
  dispatchFirstReply, getMailStatus, prepareFirstReply, previewFirstReply,
  publicMailStatus, RecoveryMailError, type MailEnv,
} from '../../service/fullscreenRecoveryMail';

interface Env extends MailEnv {
  FULLSCREEN_RECOVERY_SUPPORT_TOKENS?: string;
  MIXPANEL_TOKEN?: string;
}
const headers = { 'Cache-Control': 'no-store' };
const reply = (body: unknown, status = 200) => json(body, { status, headers });
const validId = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const onRequest: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const actor = authenticateRecoverySupport(request, env);
  if (!actor) return reply({ error: 'unauthorized' }, 401);
  if (!env.DB) return reply({ error: 'storage_unavailable' }, 503);
  try {
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const requestId = url.searchParams.get('requestId');
      if (!validId(requestId)) return reply({ error: 'invalid_request_id' }, 400);
      const row = await getRecoveryCase(env.DB, requestId);
      if (!row) return reply({ error: 'request_not_found' }, 404);
      if (url.searchParams.get('view') === 'status') {
        return reply({ requestId, mail: publicMailStatus(await getMailStatus(env.DB, requestId)) });
      }
      const timeZone = url.searchParams.get('timeZone') || 'UTC';
      return reply(await previewFirstReply(env, requestId, timeZone));
    }
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    let input: Record<string, unknown>;
    try { input = await request.json() as Record<string, unknown>; }
    catch { return reply({ error: 'invalid_json' }, 400); }
    if (!input || !validId(input.requestId)) return reply({ error: 'invalid_request_id' }, 400);
    const requestId = input.requestId;
    if (input.action === 'send') {
      if (typeof input.previewHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.previewHash)
        || typeof input.timeZone !== 'string') return reply({ error: 'invalid_preview_confirmation' }, 400);
      const before = await getMailStatus(env.DB, requestId);
      if (before?.state === 'failed') return reply({ error: 'use_explicit_retry_action' }, 409);
      const prepared = await prepareFirstReply(env, requestId, input.timeZone, input.previewHash, actor.id);
      if (!before) emitFullscreenRecoveryEvent(env, 'fullscreen_recovery_mail_status_changed',
        `${prepared.id}:mail:queued`, actor.id, { recovery_request_id: requestId,
          recovery_mail_id: prepared.id, mail_state: 'queued', template_version: prepared.templateVersion,
          surface: 'support_automation' }, waitUntil);
    } else if (input.action === 'retry') {
      const existing = await getMailStatus(env.DB, requestId);
      if (!existing) return reply({ error: 'outbox_missing' }, 404);
      if (existing.state !== 'failed' || !existing.retryable) return reply({ error: 'retry_requires_definite_temporary_failure' }, 409);
      if (existing.attemptCount >= existing.maxAttempts) return reply({ error: 'retry_limit_reached' }, 409);
    } else if (input.action === 'mark_unknown') {
      const existing = await getMailStatus(env.DB, requestId);
      if (!existing || existing.state !== 'sending') return reply({ error: 'not_sending' }, 409);
      if (!existing.lastAttemptAt || Date.now() - Date.parse(existing.lastAttemptAt) < 2 * 60_000)
        return reply({ error: 'claim_still_recent' }, 409);
      await env.DB.prepare(`UPDATE FullscreenRecoveryMailOutbox SET state='delivery_unknown',claimId=NULL,
        lastErrorCode='stale_claim_manual_review',retryable=0,updatedAt=?1,
        lastManualAction='mark_unknown',lastManualActor=?3,lastManualAt=?1 WHERE id=?2 AND state='sending'`)
        .bind(new Date().toISOString(), existing.id, actor.id).run();
      const current = (await getMailStatus(env.DB, requestId))!;
      if (current.state === 'delivery_unknown') emitFullscreenRecoveryEvent(env,
        'fullscreen_recovery_mail_status_changed', `${current.id}:mail:delivery_unknown`, actor.id,
        { recovery_request_id: requestId, recovery_mail_id: current.id,
          mail_state: 'delivery_unknown', template_version: current.templateVersion,
          surface: 'support_automation' }, waitUntil);
      return reply({ requestId, mail: publicMailStatus(current), action: 'manual_provider_review_required' });
    } else return reply({ error: 'invalid_action' }, 400);
    const before = await getMailStatus(env.DB, requestId);
    const current = await dispatchFirstReply(env, requestId, { actorId: actor.id });
    if (before?.state !== current.state && current.state !== 'sending') {
      const mailState = current.state === 'failed' && current.lastErrorCode?.startsWith('resend_http_429')
        ? 'failed' : current.state;
      emitFullscreenRecoveryEvent(env, 'fullscreen_recovery_mail_status_changed',
        `${current.id}:mail:${current.state}:${current.attemptCount}`, actor.id,
        { recovery_request_id: requestId, mail_state: mailState,
          template_version: current.templateVersion, recovery_mail_id: current.id,
          surface: 'support_automation' }, waitUntil);
    }
    return reply({ requestId, mail: publicMailStatus(current),
      action: current.state === 'delivery_unknown' ? 'manual_provider_review_required' : undefined });
  } catch (error) {
    if (error instanceof RecoveryMailError) return reply({ error: error.code }, error.status);
    console.error('[fullscreen-recovery-mail] request failed', { reason: error instanceof Error ? error.name : 'unknown' });
    return reply({ error: 'mail_unavailable' }, 503);
  }
};
