import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerAnalyticsSuperProperties } from '@/utils/analytics/trackAnalyticsEvent'
import { flushPromises } from '@vue/test-utils'
import { isDiagramCommentsEnabled } from '@/apis/aiTitleFeatureFlag'
import { publishCommentsContext, resetCommentsContext } from '@/features/diagramComments/commentsContextStore'
import { viewerAccountKind } from '@/utils/magic/viewerAccount'
import { installFeedbackHost, mountFeedbackModal } from './mountFeedback'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  registerAnalyticsSuperProperties: vi.fn().mockResolvedValue(undefined),
  trackAnalyticsEvent: vi.fn(),
}))
vi.mock('@/apis/aiTitleFeatureFlag', () => ({ isDiagramCommentsEnabled: vi.fn(async () => false) }))
vi.mock('@/utils/magic/viewerAccount', () => ({ viewerAccountKind: vi.fn(async () => 'licensed') }))
vi.mock('@/utils/ContextParameters/ContextParameters', () => ({ getClientDomain: () => 'example-tenant' }))
vi.mock('@/model/store2', () => ({ default: { state: { diagram: {} } } }))
vi.mock('@/model/globals/forgeGlobal', () => ({ getView: vi.fn(), openModal: vi.fn() }))
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

describe('installFeedbackHost and the Comments entry (#1047)', () => {
  const macroContext = (over: Record<string, unknown> = {}) => ({
    moduleKey: 'zenuml-mermaid-macro-lite', accountId: 'acc-me', localId: 'loc-1', siteUrl: 'https://example-tenant.atlassian.net',
    extension: { type: 'confluence:macro', content: { id: '42' }, location: 'https://example-tenant.atlassian.net/wiki/spaces/OP/pages/42/Checkout' },
    ...over,
  })
  const comments = () => document.querySelector('[data-testid="comments-trigger"]')
  const feedbackLabel = () => document.querySelector('[data-testid="feedback-trigger"]')?.textContent?.trim()

  beforeEach(() => {
    vi.clearAllMocks()
    resetCommentsContext()
    document.body.innerHTML = ''
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
  })
  afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals() })

  it('shows no Comments button while the flag is off, and the feedback button keeps its name', async () => {
    installFeedbackHost(macroContext())
    publishCommentsContext({ diagramId: 'cc-1' })
    await flushPromises()
    expect(comments()).toBeNull()
    expect(feedbackLabel()).toBe('Feedback')
  })

  it('shows Comments once the flag is on and the viewer has published the diagram id', async () => {
    vi.mocked(isDiagramCommentsEnabled).mockResolvedValueOnce(true)
    installFeedbackHost(macroContext())
    await flushPromises()
    expect(comments()).toBeNull()
    publishCommentsContext({ diagramId: 'cc-1' })
    await flushPromises()
    expect(comments()).not.toBeNull()
    expect(feedbackLabel()).toBe('Report a bug')
  })

  it('shows Comments to a guest', async () => {
    vi.mocked(isDiagramCommentsEnabled).mockResolvedValueOnce(true)
    vi.mocked(viewerAccountKind).mockResolvedValueOnce('guest')
    installFeedbackHost(macroContext())
    publishCommentsContext({ diagramId: 'cc-1' })
    await flushPromises()
    expect(comments()).not.toBeNull()
  })

  it('shows no Comments to an anonymous viewer', async () => {
    vi.mocked(isDiagramCommentsEnabled).mockResolvedValueOnce(true)
    installFeedbackHost(macroContext({ accountId: undefined }))
    publishCommentsContext({ diagramId: 'cc-1' })
    await flushPromises()
    expect(comments()).toBeNull()
    expect(feedbackLabel()).toBe('Feedback')
  })

  it('never installs a host, and so no Comments button, inside the comments modal', async () => {
    vi.mocked(isDiagramCommentsEnabled).mockResolvedValue(true)
    installFeedbackHost(macroContext({ extension: { type: 'confluence:macro', modal: { macroMode: 'comments' } } }))
    await flushPromises()
    expect(document.getElementById('zenuml-feedback-host')).toBeNull()
    vi.mocked(isDiagramCommentsEnabled).mockResolvedValue(false)
  })

  it('offers no Comments in Fullscreen', async () => {
    vi.mocked(isDiagramCommentsEnabled).mockResolvedValueOnce(true)
    installFeedbackHost(macroContext({ extension: { type: 'confluence:macro', content: { id: '42' }, modal: { macroMode: 'fullscreen' } } }))
    publishCommentsContext({ diagramId: 'cc-1' })
    await flushPromises()
    expect(comments()).toBeNull()
    expect(isDiagramCommentsEnabled).not.toHaveBeenCalled()
  })
})
