import { defineComponent } from 'vue'
import { shallowMount } from '@vue/test-utils'
import { createStore } from 'vuex'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Workspace from './Workspace.vue'

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
})
