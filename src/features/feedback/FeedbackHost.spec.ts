import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FeedbackHost from './FeedbackHost.vue'
import feedbackHostSource from './FeedbackHost.vue?raw'
import type { FeedbackContext } from './feedbackSession'
import { reactive } from 'vue'
import { publishCommentsContext, resetCommentsContext } from '@/features/diagramComments/commentsContextStore'
import { getSessionReplayId, registerAnalyticsSuperProperties, trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
  getSessionReplayId: vi.fn().mockResolvedValue(undefined),
  registerAnalyticsSuperProperties: vi.fn().mockResolvedValue(undefined),
}))

const context: FeedbackContext = {
  surface: 'viewer', hostModule: 'zenuml-macro', diagramType: 'mermaid', diagramTitle: 'Example',
  userAccountId: 'account-example', clientDomain: 'example-tenant', spaceName: 'Example space',
  macroUuid: 'macro-example', contentId: 'content-example', customContentId: 'custom-content-example',
}
const wrappers: ReturnType<typeof mount>[] = []
function show(options: Parameters<typeof mount>[1]) {
  const wrapper = mount(FeedbackHost, options)
  wrappers.push(wrapper)
  return wrapper
}

describe('FeedbackHost', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.useRealTimers()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
  })
  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps an icon trigger visible and expands it on edge hover or keyboard focus', async () => {
    const wrapper = show({ props: { context, openViewModal: vi.fn() } })
    const trigger = wrapper.get('[data-testid="feedback-trigger"]')
    expect(trigger.classes()).toContain('edge-trigger')
    expect(trigger.get('svg path').attributes('d')).toContain('M8.625 12')
    expect(wrapper.get('[data-testid="feedback-edge"]').classes()).not.toContain('revealed')
    expect(trigger.attributes('aria-label')).toBe('Send feedback')
    await trigger.trigger('focusin')
    expect(wrapper.get('[data-testid="feedback-edge"]').classes()).toContain('revealed')
  })

  // jsdom has no layout or hit-testing and does not apply scoped SFC styles, so the hit-area
  // contract is asserted on the component source, the same way ConnectPanel.spec.ts does.
  it('limits the edge hit area to the visible trigger so clicks beside it reach the UI underneath', () => {
    const edgeRule = feedbackHostSource.match(/\.feedback-edge\s*\{([^}]*)\}/)?.[1] ?? ''
    const triggerRule = feedbackHostSource.match(/\.edge-trigger\s*\{([^}]*)\}/)?.[1] ?? ''

    // The fixed container must shrink to the collapsed 32px tab. A fixed container width keeps a
    // transparent strip beside the tab that still takes pointer events and reveals the wide tab.
    expect(triggerRule).toMatch(/(^|[;\s])width\s*:\s*32px/)
    expect(edgeRule).toMatch(/position\s*:\s*fixed/)
    expect(edgeRule).not.toMatch(/(^|[;\s])width\s*:/)
  })

  it('nudges open only once from 600ms until 2400ms', async () => {
    vi.useFakeTimers()
    const wrapper = show({ props: { context, openViewModal: vi.fn() } })
    const edge = wrapper.get('[data-testid="feedback-edge"]')
    expect(edge.classes()).not.toContain('nudging')

    await vi.advanceTimersByTimeAsync(600)
    expect(edge.classes()).toContain('nudging')
    await vi.advanceTimersByTimeAsync(1800)
    expect(edge.classes()).not.toContain('nudging')

    wrapper.unmount()
    const second = show({ props: { context, openViewModal: vi.fn() } })
    await vi.advanceTimersByTimeAsync(600)
    expect(second.get('[data-testid="feedback-edge"]').classes()).not.toContain('nudging')
  })

  it('does not nudge for reduced-motion users', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    const wrapper = show({ props: { context, openViewModal: vi.fn() } })
    await vi.advanceTimersByTimeAsync(2400)
    expect(wrapper.get('[data-testid="feedback-edge"]').classes()).not.toContain('nudging')
  })

  it('opens View feedback through the Forge modal boundary', async () => {
    const openViewModal = vi.fn().mockResolvedValue(undefined)
    const wrapper = show({ props: { context, openViewModal } })
    await wrapper.get('[data-testid="feedback-trigger"]').trigger('click')
    expect(openViewModal).toHaveBeenCalledWith(expect.objectContaining({
      size: 'medium',
      context: expect.objectContaining({ macroMode: 'feedback', feedbackContext: context }),
    }))
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('passes the viewer replay id and registers the feedback token before opening the modal', async () => {
    vi.mocked(getSessionReplayId).mockResolvedValueOnce('replay-viewer-1')
    const openViewModal = vi.fn().mockResolvedValue(undefined)
    const wrapper = show({ props: { context, openViewModal } })
    await wrapper.get('[data-testid="feedback-trigger"]').trigger('click')
    await flushPromises()
    const modalContext = openViewModal.mock.calls[0][0].context
    expect(modalContext.viewerReplayId).toBe('replay-viewer-1')
    expect(typeof modalContext.feedbackToken).toBe('string')
    expect(registerAnalyticsSuperProperties).toHaveBeenCalledWith({ feedback_token: modalContext.feedbackToken })
  })

  it('omits viewerReplayId when the viewer is not recording', async () => {
    const openViewModal = vi.fn().mockResolvedValue(undefined)
    const wrapper = show({ props: { context, openViewModal } })
    await wrapper.get('[data-testid="feedback-trigger"]').trigger('click')
    await flushPromises()
    expect(openViewModal.mock.calls[0][0].context).not.toHaveProperty('viewerReplayId')
  })

  it('starts feedback replay from the surface trigger with its macro context', async () => {
    const wrapper = show({
      props: { context, openViewModal: vi.fn().mockResolvedValue(undefined) },
    })

    await wrapper.get('[data-testid="feedback-trigger"]').trigger('click')

    expect(trackAnalyticsEvent).toHaveBeenCalledOnce()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('feedback_report_opened', {
      feature_area: 'feedback',
      surface: 'viewer',
      host_module: 'zenuml-macro',
      macro_type: 'mermaid',
      macro_uuid: 'macro-example',
      feedback_entry_label: 'feedback',
    })
  })

  it('tracks one feedback opening when an inline dialog mounts after the trigger click', async () => {
    const wrapper = show({
      props: { context: { ...context, surface: 'editor' } },
    })

    await wrapper.get('[data-testid="feedback-trigger"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="dialog"]').exists()).toBe(true)
    expect(trackAnalyticsEvent).toHaveBeenCalledTimes(1)
  })

  it('hides the default surface trigger while PNG Export provides its own trigger', async () => {
    const wrapper = show({
      props: { context, openViewModal: vi.fn() },
      attachTo: document.body,
    })
    const exportBackdrop = document.createElement('div')
    exportBackdrop.className = 'export-modal-backdrop'
    document.body.appendChild(exportBackdrop)

    await flushPromises()

    expect(wrapper.find('[data-testid="feedback-edge"]').exists()).toBe(false)
    wrapper.unmount()
    exportBackdrop.remove()
  })

  describe('Comments entry (#1047)', () => {
    const PAGE_URL = 'https://example.atlassian.net/wiki/spaces/OP/pages/42/Checkout'
    const entry = (over: Record<string, unknown> = {}) => reactive({
      enabled: true, pageId: '42', pageUrl: PAGE_URL, localId: 'loc-1', accountId: 'acc-me', viewerKind: 'licensed' as const,
      loadCount: vi.fn().mockResolvedValue(3), ...over,
    })
    const loaded = () => publishCommentsContext({
      diagramId: 'cc-1', diagramVersion: 4, diagramTitle: 'Checkout', lastModifierId: 'acc-editor', macroType: 'mermaid',
    })
    beforeEach(() => resetCommentsContext())

    it('shows Comments above Report a bug, relabelling the feedback button', async () => {
      loaded()
      const wrapper = show({ props: { context, comments: entry(), openViewModal: vi.fn() } })
      const buttons = wrapper.get('[data-testid="feedback-edge"]').findAll('button')
      expect(buttons.map(b => b.attributes('data-testid'))).toEqual(['comments-trigger', 'feedback-trigger'])
      expect(buttons[0].attributes('aria-label')).toBe('Comments')
      expect(buttons[0].text()).toBe('Comments')
      expect(buttons[1].attributes('aria-label')).toBe('Report a bug')
      expect(buttons[1].text()).toBe('Report a bug')
      expect(buttons[0].classes()).toContain('edge-trigger')
    })

    it('keeps the feedback button unchanged when Comments is not shown', async () => {
      const wrapper = show({ props: { context, comments: entry({ enabled: false }), openViewModal: vi.fn() } })
      expect(wrapper.find('[data-testid="comments-trigger"]').exists()).toBe(false)
      const trigger = wrapper.get('[data-testid="feedback-trigger"]')
      expect(trigger.attributes('aria-label')).toBe('Send feedback')
      expect(trigger.text()).toBe('Feedback')
    })

    it.each([
      ['the flag is off', { enabled: false }, undefined],
      ['the viewer is anonymous (no account id)', { accountId: undefined }, undefined],
      ['there is no page id', { pageId: '' }, undefined],
      ['this is not the viewer surface', {}, 'editor'],
    ])('hides Comments when %s', async (_label, over, surface) => {
      loaded()
      const ctx = surface ? { ...context, surface: surface as 'editor' } : context
      const wrapper = show({ props: { context: ctx, comments: entry(over), openViewModal: vi.fn() } })
      expect(wrapper.find('[data-testid="comments-trigger"]').exists()).toBe(false)
    })

    it('waits for the diagram id: hidden before the content loads, shown once the viewer publishes it', async () => {
      const wrapper = show({ props: { context, comments: entry(), openViewModal: vi.fn() } })
      expect(wrapper.find('[data-testid="comments-trigger"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="feedback-trigger"]').text()).toBe('Feedback')
      loaded()
      await flushPromises()
      expect(wrapper.find('[data-testid="comments-trigger"]').exists()).toBe(true)
      expect(wrapper.get('[data-testid="feedback-trigger"]').text()).toBe('Report a bug')
    })

    it('shows the entry to guests', async () => {
      loaded()
      const wrapper = show({ props: { context, comments: entry({ viewerKind: 'guest' }), openViewModal: vi.fn() } })
      expect(wrapper.find('[data-testid="comments-trigger"]').exists()).toBe(true)
    })

    it('opens a medium modal in comments mode, reading the context at click time', async () => {
      publishCommentsContext({ diagramId: 'cc-1', macroType: 'mermaid' })
      const openViewModal = vi.fn().mockResolvedValue(undefined)
      const wrapper = show({ props: { context, comments: entry(), openViewModal } })
      // The version, title and last editor arrive AFTER the host mounted.
      publishCommentsContext({ diagramVersion: 7, diagramTitle: 'Checkout', lastModifierId: 'acc-editor' })
      await wrapper.get('[data-testid="comments-trigger"]').trigger('click')
      await flushPromises()

      expect(openViewModal).toHaveBeenCalledTimes(1)
      const options = openViewModal.mock.calls[0][0]
      expect(options).toMatchObject({ resource: 'main', size: 'medium' })
      expect(options.context.macroMode).toBe('comments')
      expect(options.context.commentsContext).toEqual({
        pageId: '42', pageUrl: PAGE_URL, localId: 'loc-1', diagramId: 'cc-1', diagramVersion: 7,
        diagramTitle: 'Checkout', lastModifierId: 'acc-editor', currentAccountId: 'acc-me', macroType: 'mermaid',
      })
    })

    it('never opens a modal with empty fields: a click while the diagram id is unknown does nothing', async () => {
      loaded()
      const openViewModal = vi.fn().mockResolvedValue(undefined)
      const wrapper = show({ props: { context, comments: entry(), openViewModal } })
      const button = wrapper.get('[data-testid="comments-trigger"]')
      resetCommentsContext() // the viewer lost its diagram (reload) after the button rendered
      await button.trigger('click')
      await flushPromises()
      expect(openViewModal).not.toHaveBeenCalled()
      expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('diagram_comment_entry_clicked', expect.anything())
    })

    it('tracks the click with the viewer kind and no ids, text or names', async () => {
      loaded()
      const wrapper = show({ props: { context, comments: entry({ viewerKind: 'guest' }), openViewModal: vi.fn().mockResolvedValue(undefined) } })
      await wrapper.get('[data-testid="comments-trigger"]').trigger('click')
      await flushPromises()
      expect(trackAnalyticsEvent).toHaveBeenCalledWith('diagram_comment_entry_clicked', {
        feature_area: 'diagram_comments', surface: 'viewer', macro_type: 'mermaid', comment_viewer_kind: 'guest',
      })
      expect(JSON.stringify(vi.mocked(trackAnalyticsEvent).mock.calls)).not.toMatch(/acc-|cc-1|Checkout/)
    })

    it('reports unknown when the viewer kind has not resolved', async () => {
      loaded()
      const wrapper = show({ props: { context, comments: entry({ viewerKind: undefined }), openViewModal: vi.fn().mockResolvedValue(undefined) } })
      await wrapper.get('[data-testid="comments-trigger"]').trigger('click')
      await flushPromises()
      expect(vi.mocked(trackAnalyticsEvent).mock.calls.find(([n]) => n === 'diagram_comment_entry_clicked')?.[1])
        .toMatchObject({ comment_viewer_kind: 'unknown' })
    })

    it('tags feedback_report_opened with the label the reader saw', async () => {
      loaded()
      const wrapper = show({ props: { context, comments: entry(), openViewModal: vi.fn().mockResolvedValue(undefined) } })
      await wrapper.get('[data-testid="feedback-trigger"]').trigger('click')
      await flushPromises()
      expect(trackAnalyticsEvent).toHaveBeenCalledWith('feedback_report_opened', expect.objectContaining({ feedback_entry_label: 'report_a_bug' }))
    })

    it('loads the count lazily on first pointer entry, once, and shows it after the label', async () => {
      loaded()
      const comments = entry()
      const wrapper = show({ props: { context, comments, openViewModal: vi.fn() } })
      expect(comments.loadCount).not.toHaveBeenCalled()
      const edge = wrapper.get('[data-testid="feedback-edge"]')
      await edge.trigger('mouseenter')
      await edge.trigger('mouseleave')
      await edge.trigger('mouseenter')
      await flushPromises()
      expect(comments.loadCount).toHaveBeenCalledTimes(1)
      expect(comments.loadCount).toHaveBeenCalledWith('42', 'cc-1')
      expect(wrapper.get('[data-testid="comments-trigger"]').text()).toBe('Comments · 3')
    })

    it('reloads the count when the comments modal closes, so a new post shows', async () => {
      loaded()
      const loadCount = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1)
      const comments = entry({ loadCount })
      const openViewModal = vi.fn().mockImplementation(async (options: any) => { options.onClose?.(undefined) })
      const wrapper = show({ props: { context, comments, openViewModal } })
      await wrapper.get('[data-testid="feedback-edge"]').trigger('mouseenter')
      await flushPromises()
      expect(wrapper.get('[data-testid="comments-trigger"]').text()).toBe('Comments · 0')
      await wrapper.get('[data-testid="comments-trigger"]').trigger('click')
      await flushPromises()
      expect(loadCount).toHaveBeenCalledTimes(2)
      expect(wrapper.get('[data-testid="comments-trigger"]').text()).toBe('Comments · 1')
    })

    it('a failed count is silent: plain label, no error', async () => {
      loaded()
      const comments = entry({ loadCount: vi.fn().mockRejectedValue(new Error('429')) })
      const wrapper = show({ props: { context, comments, openViewModal: vi.fn() } })
      await wrapper.get('[data-testid="feedback-edge"]').trigger('mouseenter')
      await flushPromises()
      expect(wrapper.get('[data-testid="comments-trigger"]').text()).toBe('Comments')
    })

    it('navigates when the modal closes with the reply payload (fallback path)', async () => {
      loaded()
      const navigate = vi.fn().mockResolvedValue(undefined)
      const openViewModal = vi.fn().mockImplementation(async (options: any) => { options.onClose?.({ action: 'reply', commentId: '777' }) })
      const wrapper = show({ props: { context, comments: entry({ navigate }), openViewModal } })
      await wrapper.get('[data-testid="comments-trigger"]').trigger('click')
      await flushPromises()
      expect(navigate).toHaveBeenCalledWith('/wiki/spaces/OP/pages/42/Checkout?focusedCommentId=777')
    })

    it('ignores a modal close with no payload', async () => {
      loaded()
      const navigate = vi.fn()
      const openViewModal = vi.fn().mockImplementation(async (options: any) => { options.onClose?.(undefined) })
      const wrapper = show({ props: { context, comments: entry({ navigate }), openViewModal } })
      await wrapper.get('[data-testid="comments-trigger"]').trigger('click')
      await flushPromises()
      expect(navigate).not.toHaveBeenCalled()
    })
  })
})
