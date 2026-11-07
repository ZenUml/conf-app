import uuidv4 from '@/utils/uuid';
import type { AnalyticsEventName, MacroTypeValue } from './catalog';
import type { AnalyticsProperties } from './types';

type Attempt = { id: string; initialType: MacroTypeValue; currentType: MacroTypeValue; startedAt: number; index: number; ended: boolean };
let attempt: Attempt | null = null;

const lifecycleEvents = new Set<AnalyticsEventName>([
  'macro_create_started', 'macro_type_changed', 'macro_publish_requested',
  'macro_publish_blocked', 'macro_save_failed', 'macro_create_succeeded',
  'macro_create_cancelled', 'macro_publish_completed',
]);

/**
 * Capture synchronously BEFORE tracker initialization/enrichment awaits. A fast
 * type switch or close must not rewrite the type/index on a queued earlier
 * event. No account/content/session data enters this module; the random token
 * is scoped to one authoring iframe, never persisted or reused across opens.
 */
export function captureCreationAttemptProperties(
  event: AnalyticsEventName,
  props: AnalyticsProperties,
): Partial<AnalyticsProperties> {
  if (event === 'macro_edit_started') {
    attempt = null;
    return {};
  }
  if (props.operation_mode === 'edit' || !lifecycleEvents.has(event)) return {};
  const macroType = props.to_macro_type ?? props.macro_type;
  if (event === 'macro_create_started') {
    attempt = {
      id: uuidv4(), initialType: macroType ?? 'none', currentType: macroType ?? 'none',
      startedAt: Date.now(), index: 0, ended: false,
    };
  }
  if (!attempt) return {};
  if (attempt.ended && event !== 'macro_publish_completed' && event !== 'macro_save_failed') return {};
  if (macroType) attempt.currentType = macroType;
  const snapshot = {
    creation_attempt_id: attempt.id,
    initial_macro_type: attempt.initialType,
    final_macro_type: attempt.currentType,
    creation_event_index: attempt.index++,
    creation_elapsed_ms: Math.max(0, Date.now() - attempt.startedAt),
  };
  if (event === 'macro_create_succeeded' || event === 'macro_create_cancelled') attempt.ended = true;
  return snapshot;
}

export function resetCreationAttemptTelemetry(): void {
  attempt = null;
}
