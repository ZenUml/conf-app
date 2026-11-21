import { activateFullscreenRecovery } from '@/apis/fullscreenRecovery';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import type { RecoverySnapshot } from '../../../shared/fullscreenRecovery';

/**
 * The edit grant starts at the first successful save after the request (7 days, personal).
 * The recovery host registers the pending request when the editor opens; the save path calls
 * `activateEditRecoveryAfterSave()` once the content write is durable. Activation is best effort
 * and bounded: it must never fail or hold up a save. If it does not complete, the request stays
 * pending and the next save tries again.
 */
export interface PendingEditActivation {
  requestId: string;
  spaceKey: string;
  attemptId: string;
  onActivated?: (snapshot: RecoverySnapshot) => void;
}

/** A save closes the editor soon after it returns; do not hold it longer than this. */
const ACTIVATION_TIMEOUT_MS = 3_000;

let pending: PendingEditActivation | null = null;
let inFlight: Promise<void> | null = null;

export function registerEditActivation(next: PendingEditActivation): void { pending = next; }
export function clearEditActivation(): void { pending = null; inFlight = null; }

export function activateEditRecoveryAfterSave(): Promise<void> {
  const current = pending;
  if (!current) return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = run(current).finally(() => { inFlight = null; });
  return inFlight;
}

async function run(current: PendingEditActivation): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      activateFullscreenRecovery({
        action: 'activate', attemptId: current.attemptId, requestId: current.requestId,
        spaceKey: current.spaceKey, feature: 'edit',
      }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ACTIVATION_TIMEOUT_MS); }),
    ]);
    if (pending === current) pending = null;
    try { current.onActivated?.(result.snapshot); } catch { /* informational */ }
  } catch {
    try {
      trackAnalyticsEvent('fullscreen_recovery_activation_failed', {
        feature_area: 'upgrade', surface: 'editor', feature: 'edit', policy_version: 'edit-contact-v1',
        attempt_id: current.attemptId, recovery_request_id: current.requestId,
        failure_stage: 'confirmation', failure_reason: 'unavailable',
      });
    } catch { /* telemetry never affects a save */ }
  } finally { clearTimeout(timer); }
}
