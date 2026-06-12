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
    expect(wrapper.text()).toContain('Updating diagram')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_prompt_submitted',
      expect.objectContaining({ prompt_length: 16, macro_type: 'mermaid' }),
    )

    await vi.advanceTimersByTimeAsync(700)
    expect(wrapper.get('[data-testid="ai-change-preview"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="ai-chat-complete-status"]').text()).toContain('Ready to review')
    expect(wrapper.text()).toContain('Keep the current Mermaid format')
    expect(wrapper.text()).toContain('Your current diagram stays unchanged until you click Apply')
  })

  it('emits close from the panel header', async () => {
    const wrapper = mount(AIChatPanel, {
      props: { open: true },
    })

    await wrapper.get('[data-testid="ai-chat-close"]').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('emits a code visibility toggle from the panel header', async () => {
    const wrapper = mount(AIChatPanel, {
      props: { open: true, codeVisible: false },
    })

    expect(wrapper.get('[data-testid="ai-chat-code-toggle"]').text()).toContain('Show')
    expect(wrapper.get('[data-testid="ai-chat-header-row"]').text()).not.toContain('Sequence diagram')
    expect(wrapper.get('[data-testid="ai-chat-header-row"]').find('[data-testid="ai-chat-code-toggle"]').exists()).toBe(true)
    await wrapper.get('[data-testid="ai-chat-code-toggle"]').trigger('click')

    expect(wrapper.emitted('toggle-code')).toHaveLength(1)
  })

  it('shows a small expandable syntax indicator without a repair button', async () => {
    const wrapper = mount(AIChatPanel, {
      props: {
        open: true,
        codeVisible: false,
        syntaxError: "Sequence syntax error at line 12\nmismatched input ')' expecting <EOF>",
      },
    })

    expect(wrapper.get('[data-testid="ai-chat-syntax-indicator"]').text()).toContain('Syntax')
    expect(wrapper.find('[data-testid="ai-chat-syntax-details"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('AI Repair')

    await wrapper.get('[data-testid="ai-chat-syntax-indicator"]').trigger('click')

    expect(wrapper.get('[data-testid="ai-chat-syntax-details"]').text()).toContain('line 12')
    expect(wrapper.get('[data-testid="ai-chat-syntax-indicator"]').attributes('aria-expanded')).toBe('true')

    await wrapper.setProps({ codeVisible: true })
    expect(wrapper.get('[data-testid="ai-chat-code-toggle"]').text()).toContain('Hide')
    expect(wrapper.get('[data-testid="ai-chat-syntax-indicator"]').text()).toContain('Syntax')
  })
})
