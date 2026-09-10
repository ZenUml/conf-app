import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import FeedbackDialog from './FeedbackDialog.vue'
import type { FeedbackContext } from './feedbackSession'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))

const context: FeedbackContext = {
  surface: 'viewer',
  hostModule: 'zenuml-sequence-macro-lite',
  diagramType: 'mermaid',
  diagramTitle: 'Example diagram',
  userAccountId: 'account-example',
  clientDomain: 'example-tenant',
  spaceName: 'Example space',
  macroUuid: 'macro-example',
  contentId: 'content-example',
  customContentId: 'custom-content-example',
}

describe('FeedbackDialog', () => {
  it('fills the Forge modal viewport only for the viewer surface', () => {
    const viewer = mount(FeedbackDialog, { props: { context, submit: vi.fn() } })
    const editor = mount(FeedbackDialog, {
      props: { context: { ...context, surface: 'editor' }, submit: vi.fn() },
    })

    expect(viewer.get('.feedback-dialog').classes()).toContain('feedback-dialog--forge-modal')
    expect(editor.get('.feedback-dialog').classes()).not.toContain('feedback-dialog--forge-modal')
  })

  it('keeps context collapsed and requires a description', async () => {
    const submit = vi.fn()
    const wrapper = mount(FeedbackDialog, { props: { context, submit } })

    expect(wrapper.text()).toContain('Send feedback')
    expect(wrapper.text()).not.toContain('ZenUML Feedback')
    const disclosure = wrapper.get('.context-disclosure')
    expect(disclosure.attributes('aria-expanded')).toBe('false')
    expect(disclosure.text()).toContain('8 fields attached automatically')
    expect(wrapper.find('.context-details dl').exists()).toBe(false)
    expect(wrapper.find('fieldset').exists()).toBe(false)
    expect(wrapper.get('textarea').attributes('placeholder')).toBe('What would you like us to know?')
    const captureAction = wrapper.get('[data-testid="capture-current-view"]')
    expect(captureAction.text()).toBe('Capture current view')
    expect(captureAction.get('svg.image-action-icon').attributes('aria-hidden')).toBe('true')
    expect(captureAction.get('svg.image-action-icon path').attributes('d')).toContain('M6.827 6.175')
    expect(captureAction.attributes('title')).toContain('never the Confluence page or browser')
    const uploadAction = wrapper.get('.upload-button')
    expect(uploadAction.text()).toContain('Upload image')
    expect(uploadAction.get('svg.image-action-icon').attributes('aria-hidden')).toBe('true')
    expect(uploadAction.get('svg.image-action-icon path').attributes('d')).toContain('M3 16.5v2.25')

    await disclosure.trigger('click')
    expect(disclosure.attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('.context-details dt')).toHaveLength(8)

    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Describe what happened before sending.'))
    expect(submit).not.toHaveBeenCalled()
  })

  it('scrolls the newly expanded auto-fields panel into view within the single dialog-body scroller', async () => {
    const scrollIntoView = vi.fn()
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView

    try {
      const wrapper = mount(FeedbackDialog, { props: { context, submit: vi.fn() } })
      const disclosure = wrapper.get('.context-disclosure')

      await disclosure.trigger('click')
      await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' }))

      // The panel itself must not carry its own scroll region — .feedback-body is the
      // only scroller; a computed max-height/overflow pair isn't assertable in jsdom anyway.
      expect(wrapper.get('.context-details dl').classes()).toEqual([])
    } finally {
      window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })

  it('continues and exits Markdown-style lists while keeping a plain textarea', async () => {
    const wrapper = mount(FeedbackDialog, { props: { context, submit: vi.fn() } })
    const textarea = wrapper.get('textarea')
    await textarea.setValue('- First item')
    const element = textarea.element as HTMLTextAreaElement
    element.setSelectionRange(12, 12)
    await textarea.trigger('keydown', { key: 'Enter' })
    expect(element.value).toBe('- First item\n- ')

    element.setSelectionRange(element.value.length, element.value.length)
    await textarea.trigger('keydown', { key: 'Enter' })
    expect(element.value).toBe('- First item\n')
    expect(wrapper.find('[contenteditable]').exists()).toBe(false)
  })

  it('shows saved confirmation and a manual support fallback after blocked handoff', async () => {
    vi.useFakeTimers()
    const submit = vi.fn().mockResolvedValue({ reportReference: 'FBR-EXAMPLE1234' })
    const handoff = vi.fn().mockResolvedValue({
      opened: false,
      manualUrl: 'https://support.example/?ref=FBR-EXAMPLE1234',
    })
    const wrapper = mount(FeedbackDialog, { props: { context, submit, handoff } })

    await wrapper.get('textarea').setValue('The diagram is too small.')
    await wrapper.get('form').trigger('submit')
    await Promise.resolve()
    await Promise.resolve()

    expect(wrapper.text()).toContain('Your feedback has been saved.')
    expect(wrapper.text()).toContain('redirected to our ticket system in 5 seconds')
    expect(wrapper.text()).toContain("Submit the ticket if you'd like to receive replies.")
    expect(handoff).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(4_000)
    expect(wrapper.text()).toContain('in 1 second')
    expect(handoff).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    await Promise.resolve()

    const manual = wrapper.get('[data-testid="continue-support"]')
    expect(manual.attributes('href')).toBe('https://support.example/?ref=FBR-EXAMPLE1234')
    vi.useRealTimers()
  })

  it('shows the support email when feedback submission fails', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('ServiceUnavailable'))
    const wrapper = mount(FeedbackDialog, { props: { context, submit } })

    await wrapper.get('textarea').setValue('The diagram is too small.')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Feedback could not be sent.'))

    const supportEmail = wrapper.get('a[href="mailto:support@zenuml.com"]')
    expect(supportEmail.text()).toBe('support@zenuml.com')
  })

  it('captures only when explicitly requested and shows preview controls', async () => {
    const capture = vi.fn().mockResolvedValue({
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      name: 'current-view.png',
      method: 'current_view' as const,
    })
    const wrapper = mount(FeedbackDialog, { props: { context, submit: vi.fn(), captureCurrentView: capture } })

    expect(capture).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="capture-current-view"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('img[alt="Captured view"]').exists()).toBe(true))
    expect(capture).toHaveBeenCalledOnce()

    await wrapper.get('[data-testid="remove-screenshot"]').trigger('click')
    expect(wrapper.find('img[alt="Captured view"]').exists()).toBe(false)
  })
})
