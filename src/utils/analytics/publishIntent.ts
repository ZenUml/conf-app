import { trackAnalyticsEvent } from './trackAnalyticsEvent';
import type { MacroTypeValue } from './catalog';
import type { AnalyticsProperties } from './types';

type PublishIntent = {
  macroType: MacroTypeValue;
  operationMode: 'create' | 'edit';
  titlePresent: boolean;
};

function properties(input: PublishIntent): AnalyticsProperties {
  return {
    feature_area: 'macro', surface: 'editor', macro_type: input.macroType,
    operation_mode: input.operationMode, title_present: input.titlePresent,
  };
}

/** Only call for an observed click/save message, before local validation. */
export function trackPublishRequested(input: PublishIntent): void {
  trackAnalyticsEvent('macro_publish_requested', properties(input));
}

export function trackPublishBlocked(
  reason: NonNullable<AnalyticsProperties['publish_block_reason']>,
  input: PublishIntent,
): void {
  trackAnalyticsEvent('macro_publish_blocked', { ...properties(input), publish_block_reason: reason });
}
