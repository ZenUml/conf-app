import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import FeedbackHost from './FeedbackHost.vue'
import type { FeedbackContext } from './feedbackSession'

const context: FeedbackContext = {
  surface: 'viewer', hostModule: 'zenuml-macro', diagramType: 'mermaid', diagramTitle: 'Example',
  userAccountId: 'account-example', clientDomain: 'example-tenant', spaceName: 'Example space',
  macroUuid: 'macro-example', contentId: 'content-example', customContentId: 'custom-content-example',
}

describe('FeedbackHost', () => {
  it('keeps the right-edge trigger hidden until edge hover or keyboard focus', async () => {
    const wrapper = mount(FeedbackHost, { props: { context, openViewModal: vi.fn() } })
    const trigger = wrapper.get('[data-testid="feedback-trigger"]')
    expect(trigger.classes()).toContain('edge-trigger')
    expect(wrapper.get('[data-testid="feedback-edge"]').classes()).not.toContain('revealed')
    await trigger.trigger('focusin')
    expect(wrapper.get('[data-testid="feedback-edge"]').classes()).toContain('revealed')
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
})
