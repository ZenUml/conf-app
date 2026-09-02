import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createStore } from 'vuex'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DiagramType } from '@/model/Diagram/Diagram'

const featureFlags = vi.hoisted(() => ({
  isAiRepairEnabled: vi.fn(),
  isAiChatEnabled: vi.fn(),
  isAiChatRepairEnabled: vi.fn(),
}))

vi.mock('@/apis/aiTitleFeatureFlag', () => featureFlags)
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}))

import SyntaxErrorBox from '@/components/SyntaxErrorBox.vue'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

const AIRepairStub = defineComponent({
  name: 'AIRepairStub',
  props: {
    showDialog: Boolean,
  },
  template: '<div data-testid="legacy-ai-repair">{{ showDialog }}</div>',
})

function mountSyntaxErrorBox(diagramType = DiagramType.Sequence) {
  const store = createStore({
    state: {
      error: 'Syntax error at line 1',
      diagram: {
        diagramType,
        code: 'A->B',
        mermaidCode: 'flowchart LR',
        plantUmlCode: '@startuml',
      },
    },
  })

  return mount(SyntaxErrorBox, {
    global: {
      plugins: [store],
      stubs: { AIRepair: AIRepairStub },
    },
  })
}

describe('SyntaxErrorBox AI Repair routing', () => {
  beforeEach(() => {
    featureFlags.isAiRepairEnabled.mockReset().mockResolvedValue(true)
    featureFlags.isAiChatEnabled.mockReset().mockResolvedValue(false)
    featureFlags.isAiChatRepairEnabled.mockReset().mockResolvedValue(false)
    vi.mocked(trackAnalyticsEvent).mockClear()
  })

  it('hides the repair action when neither repair route is enabled', async () => {
    featureFlags.isAiRepairEnabled.mockResolvedValue(false)
    const wrapper = mountSyntaxErrorBox()
    await flushPromises()

    expect(wrapper.find('[data-testid="ai-repair-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="legacy-ai-repair"]').exists()).toBe(false)
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('ai_repair_button_shown', expect.anything())
  })

  it('uses the legacy AIRepair dialog when Chat is disabled', async () => {
    const wrapper = mountSyntaxErrorBox()
    await flushPromises()

    expect(wrapper.get('[data-testid="legacy-ai-repair"]').text()).toBe('false')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('ai_repair_button_shown', {
      feature_area: 'ai',
      surface: 'editor',
      macro_type: DiagramType.Sequence,
    })
    await wrapper.vm.$forceUpdate()
    await wrapper.vm.$nextTick()
    expect(vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'ai_repair_button_shown')).toHaveLength(1)
    await wrapper.get('[data-testid="ai-repair-button"]').trigger('click')

    expect(wrapper.get('[data-testid="legacy-ai-repair"]').text()).toBe('true')
    expect(wrapper.emitted('request-ai-chat-repair')).toBeUndefined()
  })

  it('keeps the legacy route when Chat is enabled without Chat repair', async () => {
    featureFlags.isAiChatEnabled.mockResolvedValue(true)
    const wrapper = mountSyntaxErrorBox()
    await flushPromises()

    await wrapper.get('[data-testid="ai-repair-button"]').trigger('click')

    expect(wrapper.get('[data-testid="legacy-ai-repair"]').text()).toBe('true')
    expect(wrapper.emitted('request-ai-chat-repair')).toBeUndefined()
  })

  it('shows the repair action and routes through Chat when only Chat repair is enabled', async () => {
    featureFlags.isAiRepairEnabled.mockResolvedValue(false)
    featureFlags.isAiChatEnabled.mockResolvedValue(true)
    featureFlags.isAiChatRepairEnabled.mockResolvedValue(true)
    const wrapper = mountSyntaxErrorBox()
    await flushPromises()

    expect(wrapper.find('[data-testid="legacy-ai-repair"]').exists()).toBe(false)
    await wrapper.get('[data-testid="ai-repair-button"]').trigger('click')

    expect(wrapper.emitted('request-ai-chat-repair')).toHaveLength(1)
  })

  it('routes through Chat when all three flags are enabled', async () => {
    featureFlags.isAiChatEnabled.mockResolvedValue(true)
    featureFlags.isAiChatRepairEnabled.mockResolvedValue(true)
    const wrapper = mountSyntaxErrorBox()
    await flushPromises()

    expect(wrapper.find('[data-testid="legacy-ai-repair"]').exists()).toBe(false)
    await wrapper.get('[data-testid="ai-repair-button"]').trigger('click')

    expect(wrapper.emitted('request-ai-chat-repair')).toHaveLength(1)
  })

  it('falls back to the legacy dialog when the Chat flag lookup fails', async () => {
    featureFlags.isAiChatEnabled.mockRejectedValue(new Error('flag unavailable'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mountSyntaxErrorBox()
    await flushPromises()

    await wrapper.get('[data-testid="ai-repair-button"]').trigger('click')
    expect(wrapper.get('[data-testid="legacy-ai-repair"]').text()).toBe('true')
    expect(wrapper.emitted('request-ai-chat-repair')).toBeUndefined()
    consoleError.mockRestore()
  })

  it('falls back to the legacy dialog when the Chat repair flag lookup fails', async () => {
    featureFlags.isAiChatEnabled.mockResolvedValue(true)
    featureFlags.isAiChatRepairEnabled.mockRejectedValue(new Error('flag unavailable'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mountSyntaxErrorBox()
    await flushPromises()

    await wrapper.get('[data-testid="ai-repair-button"]').trigger('click')
    expect(wrapper.get('[data-testid="legacy-ai-repair"]').text()).toBe('true')
    expect(wrapper.emitted('request-ai-chat-repair')).toBeUndefined()
    consoleError.mockRestore()
  })

  it('does not offer AI Repair for Graph diagrams', async () => {
    featureFlags.isAiChatEnabled.mockResolvedValue(true)
    const wrapper = mountSyntaxErrorBox(DiagramType.Graph)
    await flushPromises()

    expect(wrapper.find('[data-testid="ai-repair-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="legacy-ai-repair"]').exists()).toBe(false)
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('ai_repair_button_shown', expect.anything())
  })
})
