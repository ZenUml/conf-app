import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerAnalyticsSuperProperties } from '@/utils/analytics/trackAnalyticsEvent'
import { mountFeedbackModal } from './mountFeedback'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  registerAnalyticsSuperProperties: vi.fn().mockResolvedValue(undefined),
  trackAnalyticsEvent: vi.fn(),
}))
vi.mock('@/model/store2', () => ({ default: { state: { diagram: {} } } }))
vi.mock('@/model/globals/forgeGlobal', () => ({ getView: vi.fn() }))
vi.mock('./feedbackTransport', () => ({ createFeedbackTransport: () => ({ submit: vi.fn(), handoff: vi.fn() }) }))

const feedbackContext = {
  surface: 'viewer', hostModule: 'zenuml-macro', userAccountId: 'account-example',
  clientDomain: 'example-tenant', macroUuid: 'macro-example', contentId: 'content-example',
  customContentId: 'custom-content-example',
}
const forgeContext = (modal: Record<string, unknown>) => ({ extension: { modal: { macroMode: 'feedback', feedbackContext, ...modal } } })

describe('mountFeedbackModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = '<div id="app"></div>'
  })
  afterEach(() => { document.body.innerHTML = '' })

  it('registers feedback_token and viewer_replay_id from the modal context', () => {
    expect(mountFeedbackModal(forgeContext({ feedbackToken: 'token-1', viewerReplayId: 'replay-1' }))).toBe(true)
    expect(registerAnalyticsSuperProperties).toHaveBeenCalledWith({ feedback_token: 'token-1', viewer_replay_id: 'replay-1' })
  })

  it('registers only the token when the viewer had no replay', () => {
    mountFeedbackModal(forgeContext({ feedbackToken: 'token-1' }))
    expect(registerAnalyticsSuperProperties).toHaveBeenCalledWith({ feedback_token: 'token-1' })
  })
})
