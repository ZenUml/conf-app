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
  it('keeps context collapsed and requires a description', async () => {
    const submit = vi.fn()
    const wrapper = mount(FeedbackDialog, { props: { context, submit } })

    expect(wrapper.text()).toContain('Send feedback')
    expect(wrapper.text()).not.toContain('ZenUML Feedback')
    expect(wrapper.find('details').attributes('open')).toBeUndefined()
    expect(wrapper.get('details').text()).toContain('8 fields attached automatically')
    expect(wrapper.find('fieldset').exists()).toBe(false)
    expect(wrapper.get('textarea').attributes('placeholder')).toBe('What would you like us to know?')
    const captureAction = wrapper.get('[data-testid="capture-current-view"]')
    expect(captureAction.text()).toBe('Capture current view')
    expect(captureAction.get('svg.image-action-icon').attributes('aria-hidden')).toBe('true')
    const uploadAction = wrapper.get('.upload-button')
    expect(uploadAction.text()).toContain('Upload image')
    expect(uploadAction.get('svg.image-action-icon').attributes('aria-hidden')).toBe('true')

    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Describe what happened before sending.'))
    expect(submit).not.toHaveBeenCalled()
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
    const submit = vi.fn().mockResolvedValue({ reportReference: 'FBR-EXAMPLE1234' })
    const handoff = vi.fn().mockResolvedValue({
      opened: false,
      manualUrl: 'https://support.example/?ref=FBR-EXAMPLE1234',
    })
    const wrapper = mount(FeedbackDialog, { props: { context, submit, handoff } })

    await wrapper.get('textarea').setValue('The diagram is too small.')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Your feedback has been saved.'))

    const manual = wrapper.get('[data-testid="continue-support"]')
    expect(manual.attributes('href')).toBe('https://support.example/?ref=FBR-EXAMPLE1234')
    expect(wrapper.text()).toContain('support form is only for contact and replies')
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
