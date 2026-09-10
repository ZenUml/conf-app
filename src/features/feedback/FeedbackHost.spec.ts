import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import FeedbackHost from './FeedbackHost.vue'
import type { FeedbackContext } from './feedbackSession'

const context: FeedbackContext = {
  surface: 'viewer', hostModule: 'zenuml-macro', diagramType: 'mermaid', diagramTitle: 'Example',
  userAccountId: 'account-example', clientDomain: 'example-tenant', spaceName: 'Example space',
  macroUuid: 'macro-example', contentId: 'content-example', customContentId: 'custom-content-example',
}

describe('FeedbackHost', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useRealTimers()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
  })

  it('keeps an icon trigger visible and expands it on edge hover or keyboard focus', async () => {
    const wrapper = mount(FeedbackHost, { props: { context, openViewModal: vi.fn() } })
    const trigger = wrapper.get('[data-testid="feedback-trigger"]')
    expect(trigger.classes()).toContain('edge-trigger')
    expect(trigger.get('svg path').attributes('d')).toContain('M8.625 12')
    expect(wrapper.get('[data-testid="feedback-edge"]').classes()).not.toContain('revealed')
    expect(trigger.attributes('aria-label')).toBe('Send feedback')
    await trigger.trigger('focusin')
    expect(wrapper.get('[data-testid="feedback-edge"]').classes()).toContain('revealed')
  })

  it('nudges open only once from 600ms until 2400ms', async () => {
    vi.useFakeTimers()
    const wrapper = mount(FeedbackHost, { props: { context, openViewModal: vi.fn() } })
    const edge = wrapper.get('[data-testid="feedback-edge"]')
    expect(edge.classes()).not.toContain('nudging')

    await vi.advanceTimersByTimeAsync(600)
    expect(edge.classes()).toContain('nudging')
    await vi.advanceTimersByTimeAsync(1800)
    expect(edge.classes()).not.toContain('nudging')

    wrapper.unmount()
    const second = mount(FeedbackHost, { props: { context, openViewModal: vi.fn() } })
    await vi.advanceTimersByTimeAsync(600)
    expect(second.get('[data-testid="feedback-edge"]').classes()).not.toContain('nudging')
  })

  it('does not nudge for reduced-motion users', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    const wrapper = mount(FeedbackHost, { props: { context, openViewModal: vi.fn() } })
    await vi.advanceTimersByTimeAsync(2400)
    expect(wrapper.get('[data-testid="feedback-edge"]').classes()).not.toContain('nudging')
  })

  it('opens View feedback through the Forge modal boundary', async () => {
    const openViewModal = vi.fn().mockResolvedValue(undefined)
    const wrapper = mount(FeedbackHost, { props: { context, openViewModal } })
    await wrapper.get('[data-testid="feedback-trigger"]').trigger('click')
    expect(openViewModal).toHaveBeenCalledWith(expect.objectContaining({
      size: 'medium',
      context: expect.objectContaining({ macroMode: 'feedback', feedbackContext: context }),
    }))
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('hides the default surface trigger while PNG Export provides its own trigger', async () => {
    const wrapper = mount(FeedbackHost, {
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
})
