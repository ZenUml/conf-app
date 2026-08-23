import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  trackAnalyticsEvent: vi.fn(),
}))

vi.mock('./trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: h.trackAnalyticsEvent,
}))

import { trackAuthoringStarted } from './authoringStarted'

describe('trackAuthoringStarted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('tracks a create from the editor that owns the replay session', () => {
    trackAuthoringStarted({
      macroType: 'asyncapi',
      entryPoint: 'dashboard',
    })

    expect(h.trackAnalyticsEvent).toHaveBeenCalledWith('macro_create_started', {
      feature_area: 'macro',
      surface: 'editor',
      macro_type: 'asyncapi',
      entry_point: 'dashboard',
      operation_mode: 'create',
    })
  })

  it('tracks an edit and carries its custom-content id', () => {
    trackAuthoringStarted({
      macroType: 'asyncapi',
      entryPoint: 'macro_toolbar',
      customContentId: 'cc-123',
    })

    expect(h.trackAnalyticsEvent).toHaveBeenCalledWith('macro_edit_started', {
      feature_area: 'macro',
      surface: 'editor',
      macro_type: 'asyncapi',
      entry_point: 'macro_toolbar',
      operation_mode: 'edit',
      custom_content_id: 'cc-123',
    })
  })
})
