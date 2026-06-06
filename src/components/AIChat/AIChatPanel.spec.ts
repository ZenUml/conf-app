import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AIChatPanel from './AIChatPanel.vue'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}))

describe('AIChatPanel', () => {
  beforeEach(() => {
    vi.mocked(trackAnalyticsEvent).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fills the prompt from a suggestion and tracks the selection', async () => {
    const wrapper = mount(AIChatPanel, {
      props: { open: true, diagramType: 'sequence', prototypeMode: true },
    })

    const suggestion = wrapper.findAll('button').find((button) => button.text().includes('Add an error handling path'))
    expect(suggestion).toBeDefined()
    await suggestion!.trigger('click')

    expect((wrapper.get('[data-testid="ai-chat-input"]').element as HTMLTextAreaElement).value).toBe(
      'Add an error handling path',
    )
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_suggestion_selected',
      expect.objectContaining({ suggestion_id: 'add-error-path' }),
    )
  })

  it('submits a prompt and renders the prototype change preview', async () => {
    vi.useFakeTimers()
    const wrapper = mount(AIChatPanel, {
      props: { open: true, diagramType: 'mermaid', prototypeMode: true },
    })

    await wrapper.get('[data-testid="ai-chat-input"]').setValue('Add a retry path')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('send')).toEqual([['Add a retry path']])
    expect(wrapper.get('[data-testid="ai-chat-thinking"]').exists()).toBe(true)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_prompt_submitted',
      expect.objectContaining({ prompt_length: 16, macro_type: 'mermaid' }),
    )

    await vi.advanceTimersByTimeAsync(700)
    expect(wrapper.get('[data-testid="ai-change-preview"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Keep the current Mermaid format')
  })

  it('emits close from the panel header', async () => {
    const wrapper = mount(AIChatPanel, {
      props: { open: true },
    })

    await wrapper.get('[data-testid="ai-chat-close"]').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
