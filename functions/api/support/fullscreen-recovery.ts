import { json } from '../../OkResponse';
import {
  authenticateRecoverySupport, decryptRecoveryField, emitFullscreenRecoveryEvent,
  getRecoveryCase, type FullscreenRecoveryRequestRow, type RecoveryEnv,
} from '../../service/fullscreenRecoveryService';
import type { RecoverySupportOutcome } from '../../../shared/fullscreenRecovery';

const NO_STORE = { 'Cache-Control': 'no-store' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTCOMES = new Set(['customer_replied', 'next_step_agreed', 'closed']);

async function present(row: FullscreenRecoveryRequestRow, key: string) {
  const [email, note] = await Promise.all([
    decryptRecoveryField(row.emailCiphertext, key),
    decryptRecoveryField(row.noteCiphertext, key),
  ]);
  return {
    id: row.id, cloudId: row.cloudId, accountId: row.accountId,
    scenarios: JSON.parse(row.scenariosJson), note, email,
    createdAt: row.createdAt, activatedAt: row.activatedAt, expiresAt: row.expiresAt,
    supportOutcome: row.supportOutcome, supportOutcomeAt: row.supportOutcomeAt,
  };
}
function auth(request: Request, env: RecoveryEnv) {
  if (!env.FULLSCREEN_RECOVERY_SUPPORT_TOKENS) return json({ error: 'unavailable' }, { status: 503, headers: NO_STORE });
  if (!authenticateRecoverySupport(request, env)) return json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  if (!env.DB || !env.FULLSCREEN_RECOVERY_ENCRYPTION_KEY)
    return json({ error: 'unavailable' }, { status: 503, headers: NO_STORE });
  return null;
}

export const onRequestGet: PagesFunction<RecoveryEnv> = async ({ request, env }) => {
  const rejected = auth(request, env);
  if (rejected) return rejected;
  const db = env.DB!, key = env.FULLSCREEN_RECOVERY_ENCRYPTION_KEY!;
  const id = new URL(request.url).searchParams.get('id');
  try {
    if (id) {
      if (!UUID.test(id)) return json({ error: 'invalid_id' }, { status: 400, headers: NO_STORE });
      const row = await getRecoveryCase(db, id);
      if (!row) return json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
      return json({ case: await present(row, key) }, { headers: NO_STORE });
    }
    const rows = await db.prepare(`SELECT * FROM FullscreenRecoveryRequest
      WHERE supportOutcome IS NULL ORDER BY createdAt ASC LIMIT 50`).all<FullscreenRecoveryRequestRow>();
    return json({ cases: await Promise.all(rows.results.map(row => present(row, key))) }, { headers: NO_STORE });
  } catch {
    return json({ error: 'unavailable' }, { status: 503, headers: NO_STORE });
  }
};

export const onRequestPost: PagesFunction<RecoveryEnv> = async ({ request, env, waitUntil }) => {
  const rejected = auth(request, env);
  if (rejected) return rejected;
  const actor = authenticateRecoverySupport(request, env)!;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ error: 'invalid_json' }, { status: 400, headers: NO_STORE }); }
  if (!body || (body.action !== 'extend' && body.action !== 'outcome')
    || typeof body.commandId !== 'string' || !UUID.test(body.commandId)
    || typeof body.requestId !== 'string' || !UUID.test(body.requestId)
    || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 2000
    || (body.action === 'outcome' && !OUTCOMES.has(String(body.supportOutcome))))
    return json({ error: 'invalid_command' }, { status: 400, headers: NO_STORE });
  const db = env.DB!;
  let existing: { requestId: string; action: string; oldExpiresAt: string | null; newExpiresAt: string | null; supportOutcome: string | null } | null;
  try {
    existing = await db.prepare('SELECT * FROM FullscreenRecoverySupportAction WHERE commandId = ?1')
      .bind(body.commandId).first();
  } catch {
    if (body.action === 'extend') emitFullscreenRecoveryEvent(env,
      'fullscreen_recovery_manual_extension_failed', `${body.commandId}:extend:failed:storage_unavailable`, actor.id,
      { surface: 'support_automation', recovery_request_id: body.requestId,
        support_command_id: body.commandId, failure_reason: 'storage_unavailable' }, waitUntil);
    return json({ error: 'unavailable' }, { status: 503, headers: NO_STORE });
  }
  if (existing) {
    if (existing.requestId !== body.requestId || existing.action !== body.action)
      return json({ error: 'command_conflict' }, { status: 409, headers: NO_STORE });
    return json({ outcome: 'already_applied', expiresAt: existing.newExpiresAt, supportOutcome: existing.supportOutcome }, { headers: NO_STORE });
  }
  let row: FullscreenRecoveryRequestRow | null;
  try { row = await getRecoveryCase(db, body.requestId); }
  catch {
    if (body.action === 'extend') emitFullscreenRecoveryEvent(env,
      'fullscreen_recovery_manual_extension_failed', `${body.commandId}:extend:failed:storage_unavailable`, actor.id,
      { surface: 'support_automation', recovery_request_id: body.requestId,
        support_command_id: body.commandId, failure_reason: 'storage_unavailable' }, waitUntil);
    return json({ error: 'unavailable' }, { status: 503, headers: NO_STORE });
  }
  if (!row) {
    if (body.action === 'extend') emitFullscreenRecoveryEvent(env,
      'fullscreen_recovery_manual_extension_failed', `${body.commandId}:extend:failed:not_found`, actor.id,
      { surface: 'support_automation', recovery_request_id: body.requestId,
        support_command_id: body.commandId, failure_reason: 'not_found' }, waitUntil);
    return json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
  }
  const nowIso = new Date().toISOString();
  try {
    if (body.action === 'extend') {
      if (!row.activatedAt || !row.expiresAt) {
        emitFullscreenRecoveryEvent(env, 'fullscreen_recovery_manual_extension_failed',
          `${body.commandId}:extend:failed:not_activated`, actor.id,
          { surface: 'support_automation', recovery_request_id: row.id,
            support_command_id: body.commandId, failure_reason: 'not_activated' }, waitUntil);
        return json({ error: 'not_activated' }, { status: 409, headers: NO_STORE });
      }
      // D1 batch is transactional. The INSERT computes from the current row so
      // parallel distinct commands each receive the latest expiry.
      const batch = await db.batch([
        db.prepare(`INSERT OR IGNORE INTO FullscreenRecoverySupportAction
          (commandId,requestId,action,actorId,reason,oldExpiresAt,newExpiresAt,createdAt)
          SELECT ?1,id,'extend',?2,?3,expiresAt,
            strftime('%Y-%m-%dT%H:%M:%fZ',
              CASE WHEN expiresAt > ?4 THEN expiresAt ELSE ?4 END, '+14 days'),?4
          FROM FullscreenRecoveryRequest WHERE id=?5 AND activatedAt IS NOT NULL`)
          .bind(body.commandId, actor.id, body.reason.trim(), nowIso, body.requestId),
        db.prepare(`UPDATE FullscreenRecoveryRequest SET expiresAt =
          (SELECT newExpiresAt FROM FullscreenRecoverySupportAction WHERE commandId=?1)
          WHERE id=?2 AND expiresAt IS
          (SELECT oldExpiresAt FROM FullscreenRecoverySupportAction WHERE commandId=?1 AND requestId=?2 AND action='extend')
          AND EXISTS (SELECT 1 FROM FullscreenRecoverySupportAction WHERE commandId=?1 AND requestId=?2 AND action='extend')`)
          .bind(body.commandId, body.requestId),
      ]);
      const action = await db.prepare('SELECT requestId,action,newExpiresAt FROM FullscreenRecoverySupportAction WHERE commandId=?1')
        .bind(body.commandId).first<{ requestId: string; action: string; newExpiresAt: string }>();
      if (!action) throw new Error('support_action_missing');
      if (action.requestId !== body.requestId || action.action !== 'extend')
        return json({ error: 'command_conflict' }, { status: 409, headers: NO_STORE });
      if (batch[0].meta.changes === 0)
        return json({ outcome: 'already_applied', expiresAt: action.newExpiresAt }, { headers: NO_STORE });
      emitFullscreenRecoveryEvent(env, 'fullscreen_recovery_manual_extension_completed',
        `${body.commandId}:extended`, actor.id,
        { surface: 'support_automation', recovery_request_id: row.id, recovery_grant_id: row.grantId, duration_days: 14,
          recovery_outcome: 'extended' }, waitUntil);
      return json({ outcome: 'extended', expiresAt: action.newExpiresAt }, { headers: NO_STORE });
    }
    const supportOutcome = body.supportOutcome as RecoverySupportOutcome;
    // D1 runs batch statements in one transaction on one connection. changes()
    // in the second statement is the row count of the preceding INSERT, so a
    // concurrent replay that loses INSERT OR IGNORE cannot overwrite a newer
    // outcome, even when supportOutcomeAt timestamps are equal.
    const batch = await db.batch([
      db.prepare(`INSERT OR IGNORE INTO FullscreenRecoverySupportAction
        (commandId,requestId,action,actorId,reason,supportOutcome,createdAt)
        VALUES (?1,?2,'outcome',?3,?4,?5,?6)`)
        .bind(body.commandId, body.requestId, actor.id, body.reason.trim(), supportOutcome, nowIso),
      db.prepare(`UPDATE FullscreenRecoveryRequest SET supportOutcome=?1,supportOutcomeAt=?2
        WHERE id=?3 AND changes() = 1
        AND (supportOutcomeAt IS NULL OR supportOutcomeAt <= ?2)
        AND EXISTS (SELECT 1 FROM FullscreenRecoverySupportAction
          WHERE commandId=?4 AND requestId=?3 AND action='outcome' AND supportOutcome=?1)`)
        .bind(supportOutcome, nowIso, body.requestId, body.commandId),
    ]);
    if (batch[0].meta.changes === 0)
      return json({ outcome: 'already_applied', supportOutcome }, { headers: NO_STORE });
    emitFullscreenRecoveryEvent(env, 'fullscreen_recovery_support_outcome_recorded',
      `${body.commandId}:outcome`, actor.id,
      { surface: 'support_automation', recovery_request_id: row.id, support_outcome: supportOutcome }, waitUntil);
    return json({ outcome: 'recorded', supportOutcome }, { headers: NO_STORE });
  } catch {
    if (body.action === 'extend') emitFullscreenRecoveryEvent(env,
      'fullscreen_recovery_manual_extension_failed', `${body.commandId}:extend:failed:storage_unavailable`, actor.id,
      { surface: 'support_automation', recovery_request_id: body.requestId,
        support_command_id: body.commandId, failure_reason: 'storage_unavailable' }, waitUntil);
    return json({ error: 'unavailable' }, { status: 503, headers: NO_STORE });
  }
};
