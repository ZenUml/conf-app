import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AIChatPanel from './AIChatPanel.vue'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { getDiagramlyJobStatus, startDiagramChatModification } from '@/services/GenerateService'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}))

vi.mock('@/services/GenerateService', () => ({
  startDiagramChatModification: vi.fn(),
  getDiagramlyJobStatus: vi.fn(),
}))

describe('AIChatPanel', () => {
  beforeEach(() => {
    vi.mocked(trackAnalyticsEvent).mockClear()
    vi.mocked(startDiagramChatModification).mockReset()
    vi.mocked(getDiagramlyJobStatus).mockReset()
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

  it('runs the staged update, auto-applies it, and exposes the diff', async () => {
    vi.useFakeTimers()
    const wrapper = mount(AIChatPanel, {
      props: { open: true, diagramType: 'mermaid', prototypeMode: true },
    })

    await wrapper.get('[data-testid="ai-chat-input"]').setValue('Add a retry path')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('send')).toEqual([['Add a retry path']])
    expect(wrapper.get('[data-testid="ai-chat-thinking"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Understanding request')

    await vi.advanceTimersByTimeAsync(1100)

    expect(wrapper.get('[data-testid="ai-change-preview"]').text()).toContain('Changes applied')
    expect(wrapper.text()).toContain('Added failure and timeout paths')
    expect(wrapper.get('[data-testid="ai-chat-history-trigger"]').text()).toContain('2')
    expect(wrapper.emitted('apply')).toHaveLength(1)

    const diffToggle = wrapper.get('.ai-chat-diff-toggle')
    await diffToggle.trigger('click')
    expect(wrapper.get('[data-testid="ai-chat-diff"]').text()).toContain('Payment.charge()')
    await wrapper.get('[data-testid="ai-chat-diff-expand"]').trigger('click')
    expect(wrapper.get('[data-testid="ai-chat-diff-fullscreen"]').text()).toContain('Payment.charge()')
    await wrapper.get('[data-testid="ai-chat-diff-fullscreen-close"]').trigger('click')
    expect(wrapper.find('[data-testid="ai-chat-diff-fullscreen"]').exists()).toBe(false)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_change_applied',
      expect.objectContaining({ change_kind: 'request', version_id: 2 }),
    )
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_diff_toggled',
      expect.objectContaining({ interaction_state: 'opened' }),
    )
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_diff_toggled',
      expect.objectContaining({ interaction_state: 'shown', ui_component: 'code_diff_fullscreen' }),
    )
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_diff_toggled',
      expect.objectContaining({ interaction_state: 'hidden', ui_component: 'code_diff_fullscreen' }),
    )
  })

  it('undoes an applied change and records a new version', async () => {
    vi.useFakeTimers()
    const wrapper = mount(AIChatPanel, {
      props: { open: true, diagramType: 'sequence', prototypeMode: true },
    })

    await wrapper.get('[data-testid="ai-chat-input"]').setValue('Simplify the flow')
    await wrapper.get('form').trigger('submit')
    await vi.advanceTimersByTimeAsync(1100)
    await wrapper.get('[data-testid="ai-chat-undo"]').trigger('click')

    expect(wrapper.text()).toContain('Changes undone')
    expect(wrapper.get('[data-testid="ai-chat-history-trigger"]').text()).toContain('3')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_change_undone',
      expect.objectContaining({ change_kind: 'undo', version_id: 1 }),
    )
  })

  it('opens diagram versions and restores an earlier version', async () => {
    vi.useFakeTimers()
    const wrapper = mount(AIChatPanel, {
      props: { open: true, diagramType: 'sequence', prototypeMode: true },
    })

    await wrapper.get('[data-testid="ai-chat-input"]').setValue('Highlight the key steps')
    await wrapper.get('form').trigger('submit')
    await vi.advanceTimersByTimeAsync(1100)
    await wrapper.get('[data-testid="ai-chat-history-trigger"]').trigger('click')

    expect(wrapper.get('[data-testid="ai-chat-history-panel"]').text()).toContain('Initial version')
    const restore = wrapper.findAll('.ai-chat-rollback').find((button) => button.text() === 'Restore version')
    expect(restore).toBeDefined()
    await restore!.trigger('click')

    expect(wrapper.find('[data-testid="ai-chat-history-panel"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Version restored')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_version_restored',
      expect.objectContaining({ change_kind: 'rollback', version_id: 1 }),
    )
  })

  it('keeps syntax visible across code states and supports automatic repair', async () => {
    vi.useFakeTimers()
    const wrapper = mount(AIChatPanel, {
      props: {
        open: true,
        codeVisible: false,
        prototypeMode: true,
        syntaxError: "Sequence syntax error at line 12\nmismatched input ')' expecting <EOF>",
      },
    })

    expect(wrapper.get('[data-testid="ai-chat-syntax-indicator"]').text()).toContain('Syntax')
    await wrapper.setProps({ codeVisible: true })
    expect(wrapper.get('[data-testid="ai-chat-code-toggle"]').text()).toContain('Hide')
    expect(wrapper.get('[data-testid="ai-chat-syntax-indicator"]').exists()).toBe(true)

    await wrapper.get('[data-testid="ai-chat-syntax-indicator"]').trigger('click')
    expect(wrapper.get('[data-testid="ai-chat-syntax-details"]').text()).toContain('line 12')
    expect(wrapper.get('[data-testid="ai-chat-auto-fix"]').exists()).toBe(true)

    await wrapper.get('[data-testid="ai-chat-auto-fix"]').trigger('click')
    expect(wrapper.get('[data-testid="ai-chat-thinking"]').exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(1100)

    expect(wrapper.find('[data-testid="ai-chat-syntax-indicator"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Syntax fixed')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_syntax_repair_requested',
      expect.objectContaining({ change_kind: 'syntax_repair' }),
    )
  })

  it('runs syntax repair when the parent requests it', async () => {
    vi.useFakeTimers()
    const wrapper = mount(AIChatPanel, {
      props: {
        open: true,
        prototypeMode: true,
        syntaxError: "Sequence syntax error at line 12\nmismatched input ')' expecting <EOF>",
      },
    })

    await wrapper.setProps({ syntaxRepairRequestId: 1 })

    expect(wrapper.get('[data-testid="ai-chat-thinking"]').exists()).toBe(true)
    expect(wrapper.emitted('send')).toEqual([
      ['Fix the current syntax issue without changing the rest of the diagram.'],
    ])

    await vi.advanceTimersByTimeAsync(1100)

    expect(wrapper.find('[data-testid="ai-chat-syntax-indicator"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Syntax fixed')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_syntax_repair_requested',
      expect.objectContaining({ change_kind: 'syntax_repair' }),
    )
  })

  it('emits close and code visibility changes from the header', async () => {
    const wrapper = mount(AIChatPanel, {
      props: { open: true, codeVisible: false },
    })

    await wrapper.get('[data-testid="ai-chat-code-toggle"]').trigger('click')
    await wrapper.get('[data-testid="ai-chat-close"]').trigger('click')

    expect(wrapper.emitted('toggle-code')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_code_visibility_toggled',
      expect.objectContaining({ interaction_state: 'shown' }),
    )
  })

  it('runs a real async Diagramly job and emits updated code', async () => {
    vi.mocked(startDiagramChatModification).mockResolvedValueOnce({ jobId: 'job-1' })
    vi.mocked(getDiagramlyJobStatus).mockResolvedValueOnce({
      id: 'job-1',
      status: 'COMPLETED',
      progress: 100,
      message: 'Complete',
      output: { diagramCode: 'A->B: updated' },
    })
    const wrapper = mount(AIChatPanel, {
      props: {
        open: true,
        diagramType: 'sequence',
        currentCode: 'A->B: original',
      },
    })

    await wrapper.get('[data-testid="ai-chat-input"]').setValue('Update the message')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await flushPromises()

    expect(startDiagramChatModification).toHaveBeenCalledWith({
      diagramCode: 'A->B: original',
      prompt: 'Update the message',
      diagramType: 'sequence',
      errorMessage: undefined,
    })
    expect(wrapper.emitted('apply-code')).toEqual([['A->B: updated']])
    expect(wrapper.get('[data-testid="ai-change-preview"]').text()).toContain('Changes applied')
    expect(wrapper.get('[data-testid="ai-chat-history-trigger"]').text()).toContain('2')
  })
})
