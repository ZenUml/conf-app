import type { EntryPoint, MacroTypeValue } from './catalog'
import { trackAnalyticsEvent } from './trackAnalyticsEvent'

type AuthoringStartedInput = {
  macroType: MacroTypeValue
  entryPoint: EntryPoint
  customContentId?: string
}

/**
 * Emit the authoring lifecycle event from the editor iframe that owns the
 * interaction. Session Replay is forced by trackAnalyticsEvent for both start
 * events, so emitting from a viewer would record the wrong iframe.
 */
export function trackAuthoringStarted({
  macroType,
  entryPoint,
  customContentId,
}: AuthoringStartedInput): void {
  const isEdit = !!customContentId

  trackAnalyticsEvent(isEdit ? 'macro_edit_started' : 'macro_create_started', {
    feature_area: 'macro',
    surface: 'editor',
    macro_type: macroType,
    entry_point: entryPoint,
    operation_mode: isEdit ? 'edit' : 'create',
    ...(customContentId && { custom_content_id: customContentId }),
  })
}
