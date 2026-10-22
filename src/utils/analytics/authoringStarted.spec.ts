import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  trackAnalyticsEvent: vi.fn(),
}))
const forgeGlobalMock = vi.hoisted(() => ({ forgeContext: undefined as any }))
vi.mock('@/model/globals/forgeGlobal', () => ({ default: forgeGlobalMock }))

vi.mock('./trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: h.trackAnalyticsEvent,
}))

import { trackAuthoringStarted } from './authoringStarted'
import { _resetCreationFlowForTesting } from './creationFlow'

describe('trackAuthoringStarted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetCreationFlowForTesting()
    forgeGlobalMock.forgeContext = undefined
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
      creation_origin: 'page_editor',
      creation_flow_id: expect.any(String),
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

describe('trackAuthoringStarted creation origin (#614)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetCreationFlowForTesting()
    forgeGlobalMock.forgeContext = undefined
  })

  it('stamps creation_origin and creation_flow_id on a create, defaulting to page_editor', () => {
    trackAuthoringStarted({ macroType: 'asyncapi', entryPoint: 'page_editor' })
    expect(h.trackAnalyticsEvent).toHaveBeenCalledWith(
      'macro_create_started',
      expect.objectContaining({
        creation_origin: 'page_editor',
        creation_flow_id: expect.any(String),
      }),
    )
  })

  it('carries a dashboard origin handed over through the modal context', () => {
    forgeGlobalMock.forgeContext = { extension: { modal: { macroMode: 'editor', creationOrigin: 'dashboard' } } }
    trackAuthoringStarted({ macroType: 'asyncapi', entryPoint: 'dashboard' })
    expect(h.trackAnalyticsEvent.mock.calls[0][1]).toMatchObject({ creation_origin: 'dashboard' })
  })

  it('leaves edits untouched', () => {
    trackAuthoringStarted({ macroType: 'asyncapi', entryPoint: 'macro_toolbar', customContentId: 'cc-1' })
    const props = h.trackAnalyticsEvent.mock.calls[0][1]
    expect(props).not.toHaveProperty('creation_origin')
    expect(props).not.toHaveProperty('creation_flow_id')
  })
})
