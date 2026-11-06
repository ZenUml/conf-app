import type { ForgeRequestData } from '../utils/authenticate';
import type { RecoveryRequestInput, RecoveryActivateInput } from '../../shared/fullscreenRecovery';
import { json } from '../OkResponse';
import {
  RecoveryError, activateRecovery, createRecoveryRequest, emitFullscreenRecoveryEvent,
  isRecoveryIdentity, parseRecoveryActivation, parseRecoveryRequest, recoverySnapshot,
  type RecoveryEnv,
} from '../service/fullscreenRecoveryService';

const NO_STORE = { 'Cache-Control': 'no-store' };

export const onRequestGet: PagesFunction<RecoveryEnv, string, ForgeRequestData> = async ({ request, env, data }) => {
  const fit = data.forgeContext;
  if (!fit || !isRecoveryIdentity(fit)) {
    return json({ snapshot: await recoverySnapshot(env, null) }, { headers: NO_STORE });
  }
  const spaceKey = new URL(request.url).searchParams.get('spaceKey') || undefined;
  return json({ snapshot: await recoverySnapshot(env, fit, new Date(), spaceKey) }, { headers: NO_STORE });
};

export const onRequestPost: PagesFunction<RecoveryEnv, string, ForgeRequestData> = async ({ request, env, data, waitUntil }) => {
  const fit = data.forgeContext;
  if (!fit || !isRecoveryIdentity(fit)) {
    return json({ error: 'not_eligible' }, { status: 403, headers: NO_STORE });
  }
  let body: unknown;
  try { body = await request.json(); }
  catch { return json({ error: 'invalid_json' }, { status: 400, headers: NO_STORE }); }
  try {
    const action = (body as { action?: unknown } | null)?.action;
    if (action === 'request') {
      const input: RecoveryRequestInput = parseRecoveryRequest(body);
      const result = await createRecoveryRequest(env, fit, input);
      if (result.outcome === 'created') emitFullscreenRecoveryEvent(env,
        'fullscreen_recovery_request_completed', `${result.snapshot.request!.id}:created`, fit.accountId,
        { recovery_outcome: 'created', recovery_request_id: result.snapshot.request!.id,
          recovery_grant_id: result.snapshot.grant!.id, attempt_id: input.attemptId,
          scenario_codes: input.scenarios, has_note: Boolean(input.note) }, waitUntil);
      return json(result, { headers: NO_STORE });
    }
    if (action === 'activate') {
      const input: RecoveryActivateInput = parseRecoveryActivation(body);
      const result = await activateRecovery(env, fit, input);
      if (result.outcome === 'activated') emitFullscreenRecoveryEvent(env,
        'fullscreen_recovery_activation_completed', `${input.requestId}:activated`, fit.accountId,
        { recovery_outcome: 'activated', recovery_request_id: input.requestId,
          recovery_grant_id: result.snapshot.grant!.id, duration_days: 7, attempt_id: input.attemptId }, waitUntil);
      return json(result, { headers: NO_STORE });
    }
    throw new RecoveryError('invalid_action');
  } catch (error) {
    if (error instanceof RecoveryError) return json({ error: error.code }, { status: error.status, headers: NO_STORE });
    console.error('[fullscreen-recovery] request failed', { reason: error instanceof Error ? error.name : 'unknown' });
    return json({ error: 'unavailable' }, { status: 503, headers: NO_STORE });
  }
};
