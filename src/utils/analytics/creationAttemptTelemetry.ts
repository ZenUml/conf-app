import { getEditJourneyId, startEditJourney } from '@/utils/journeyTracking';
import type { AnalyticsEventName, MacroTypeValue } from './catalog';
import type { AnalyticsProperties } from './types';

type Attempt = { id: string; initialType: MacroTypeValue; currentType: MacroTypeValue; startedAt: number; index: number; outcome?: 'saved' | 'cancelled' };
// Per-iframe history also covers late callbacks after the next editor journey
// starts. The iframe teardown releases it; no cross-window storage is used.
const attempts = new Map<string, Attempt>();

const lifecycleEvents = new Set<AnalyticsEventName>([
  'macro_create_started', 'macro_type_changed', 'macro_publish_requested',
  'macro_publish_blocked', 'macro_save_failed', 'macro_create_succeeded',
  'macro_create_cancelled', 'macro_publish_completed',
]);

/**
 * null suppresses duplicate start/success/cancel events, not retry events.
 * Capture synchronously BEFORE tracker initialization/enrichment awaits. A fast
 * type switch or close must not rewrite the type/index on a queued earlier
 * event. No account/content/session data enters this module; the random token
 * is scoped to one authoring iframe, never persisted or reused across opens.
 */
export function captureCreationAttemptProperties(
  event: AnalyticsEventName,
  props: AnalyticsProperties,
): Partial<AnalyticsProperties> | null {
  const lifecycle = lifecycleEvents.has(event) || event === 'macro_edit_started' || event === 'macro_save_succeeded' || event === 'macro_edit_cancelled';
  if (!lifecycle) return {};
  // Explicit null is a captured missing ID. Never attach a later editor's ID.
  let journeyId = props.journey_id !== undefined ? props.journey_id : getEditJourneyId();
  if (event === 'macro_create_started' && !journeyId) {
    // Some editor entrypoints do not preallocate a journey. Start one only at
    // a real start event, never fabricate identity for an orphan outcome.
    journeyId = startEditJourney(props.macro_uuid ?? '', 'macro');
  }
  const journeyProps: Partial<AnalyticsProperties> = {
    journey_id: journeyId,
    journey_tracking_version: 1,
    journey_link_status: journeyId ? 'linked' : 'missing_journey',
  };
  if (event === 'macro_edit_started' || props.operation_mode === 'edit') return journeyProps;
  const macroType = props.to_macro_type ?? props.macro_type;
  let attempt = journeyId ? attempts.get(journeyId) : undefined;
  if (event === 'macro_create_started') {
    if (attempt?.id === journeyId) return null;
    attempt = {
      id: journeyId!, initialType: macroType ?? 'none', currentType: macroType ?? 'none',
      startedAt: Date.now(), index: 0,
    };
    attempts.set(attempt.id, attempt);
  }
  if (!attempt || attempt.id !== journeyId) {
    return { ...journeyProps, journey_link_status: journeyId ? 'missing_start' : 'missing_journey' };
  }
  if (event === 'macro_create_succeeded' && attempt.outcome === 'saved') return null;
  if (event === 'macro_create_cancelled' && attempt.outcome) return null;
  if (attempt.outcome && event === 'macro_type_changed') return {};
  if (macroType) attempt.currentType = macroType;
  const snapshot = {
    ...journeyProps,
    creation_attempt_id: attempt.id,
    initial_macro_type: attempt.initialType,
    final_macro_type: attempt.currentType,
    creation_event_index: attempt.index++,
    creation_elapsed_ms: Math.max(0, Date.now() - attempt.startedAt),
  };
  if (event === 'macro_create_succeeded') attempt.outcome = 'saved';
  if (event === 'macro_create_cancelled') attempt.outcome = 'cancelled';
  return snapshot;
}

export function resetCreationAttemptTelemetry(): void {
  attempts.clear();
}
