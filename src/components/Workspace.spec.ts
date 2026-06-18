import { defineComponent } from 'vue'
import { shallowMount } from '@vue/test-utils'
import { createStore } from 'vuex'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Workspace from './Workspace.vue'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

const destroySplit = vi.fn()

vi.mock('split.js', () => ({
  default: vi.fn(() => ({ destroy: destroySplit })),
}))

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}))

describe('Workspace AI Chat code visibility', () => {
  beforeEach(() => {
    destroySplit.mockClear()
    vi.mocked(trackAnalyticsEvent).mockClear()
  })

  it('keeps the editor mounted so syntax state survives Show/Hide', async () => {
    const editorUnmounted = vi.fn()
    const store = createStore({
      state: {
        diagram: { diagramType: 'sequence' },
        error: 'Sequence syntax error at line 12',
      },
    })

    const EditorStub = defineComponent({
      name: 'EditorStub',
      template: '<div data-testid="editor-stub" />',
      beforeUnmount: editorUnmounted,
    })

    const wrapper = shallowMount(Workspace, {
      global: {
        plugins: [store],
        stubs: {
          Header: true,
          DiagramPortal: true,
          SyntaxErrorBox: true,
          AIChatPanel: true,
          Editor: EditorStub,
          editor: EditorStub,
        },
      },
    })

    expect(wrapper.get('[data-testid="editor-stub"]').isVisible()).toBe(true)

    ;(wrapper.vm as any).toggleAIChat()
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-testid="editor-stub"]').exists()).toBe(true)
    expect(wrapper.get('#workspace-left').attributes('style')).toContain('display: none')
    expect(editorUnmounted).not.toHaveBeenCalled()
    expect((wrapper.vm as any).syntaxError).toBe('Sequence syntax error at line 12')

    ;(wrapper.vm as any).toggleCodeEditor()
    await wrapper.vm.$nextTick()

    expect(wrapper.get('#workspace-left').attributes('style')).not.toContain('display: none')
    expect(editorUnmounted).not.toHaveBeenCalled()
    expect((wrapper.vm as any).syntaxError).toBe('Sequence syntax error at line 12')
  })

  it('opens AI Chat and requests syntax repair from the AI Repair button', async () => {
    const store = createStore({
      state: {
        diagram: { diagramType: 'sequence' },
        error: 'Sequence syntax error at line 12',
      },
    })

    const SyntaxErrorBoxStub = defineComponent({
      name: 'SyntaxErrorBoxStub',
      emits: ['request-ai-chat-repair'],
      template:
        '<button data-testid="ai-repair-stub" @click="$emit(\'request-ai-chat-repair\')">AI Repair</button>',
    })

    const AIChatPanelStub = defineComponent({
      name: 'AIChatPanelStub',
      props: {
        open: Boolean,
        codeVisible: Boolean,
        diagramType: String,
        syntaxError: String,
        syntaxRepairRequestId: Number,
      },
      template:
        '<aside data-testid="ai-chat-panel-stub">{{ syntaxRepairRequestId }}</aside>',
    })

    const wrapper = shallowMount(Workspace, {
      global: {
        plugins: [store],
        stubs: {
          Header: true,
          DiagramPortal: true,
          SyntaxErrorBox: SyntaxErrorBoxStub,
          AIChatPanel: AIChatPanelStub,
          Editor: true,
          editor: true,
        },
      },
    })

    destroySplit.mockClear()

    await wrapper.get('[data-testid="ai-repair-stub"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect((wrapper.vm as any).showAIChat).toBe(true)
    expect((wrapper.vm as any).showCodeEditor).toBe(false)
    expect(wrapper.get('[data-testid="ai-chat-panel-stub"]').text()).toBe('1')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_chat_opened',
      expect.objectContaining({ entry_point: 'ai_repair', macro_type: 'sequence' }),
    )
  })
})
