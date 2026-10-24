import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { createStore } from 'vuex'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { AI_REPAIR_ARM_DELAY_MS as ARM_DELAY_MS } from '@/components/aiRepairArming'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

const AIRepairStub = defineComponent({
  name: 'AIRepairStub',
  props: {
    showDialog: Boolean,
  },
  template: '<div data-testid="legacy-ai-repair">{{ showDialog }}</div>',
})

function createSyntaxErrorStore(diagramType: DiagramType, error: string | null) {
  return createStore({
    state: {
      error,
      diagram: {
        diagramType,
        code: 'A->B',
        mermaidCode: 'flowchart LR',
        plantUmlCode: '@startuml',
      },
    },
  })
}

function mountSyntaxErrorBox(diagramType = DiagramType.Sequence, error: string | null = 'Syntax error at line 1') {
  const store = createSyntaxErrorStore(diagramType, error)

  const wrapper = mount(SyntaxErrorBox, {
    global: {
      plugins: [store],
      stubs: { AIRepair: AIRepairStub },
    },
  })

  return { wrapper, store }
}

// flushPromises() schedules through setTimeout/setImmediate, both of which the
// fake clock owns. Advancing the fake clock by 0 drains microtasks instead.
async function settle() {
  await vi.advanceTimersByTimeAsync(0)
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
}

// The button only arms after the error has stood still for the arm delay.
async function mountArmed(diagramType = DiagramType.Sequence) {
  const mounted = mountSyntaxErrorBox(diagramType)
  await settle()
  await advance(ARM_DELAY_MS)
  return mounted
}

function impressions() {
  return vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'ai_repair_button_shown')
}

describe('SyntaxErrorBox AI Repair routing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    featureFlags.isAiRepairEnabled.mockReset().mockResolvedValue(true)
    featureFlags.isAiChatEnabled.mockReset().mockResolvedValue(false)
    featureFlags.isAiChatRepairEnabled.mockReset().mockResolvedValue(false)
    vi.mocked(trackAnalyticsEvent).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('hides the repair action when neither repair route is enabled', async () => {
    featureFlags.isAiRepairEnabled.mockResolvedValue(false)
    const { wrapper } = await mountArmed()

    expect(wrapper.find('[data-testid="ai-repair-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="legacy-ai-repair"]').exists()).toBe(false)
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('ai_repair_button_shown', expect.anything())
  })

  it('uses the legacy AIRepair dialog when Chat is disabled', async () => {
    const { wrapper } = await mountArmed()

    expect(wrapper.get('[data-testid="legacy-ai-repair"]').text()).toBe('false')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('ai_repair_button_shown', {
      feature_area: 'ai',
      surface: 'editor',
      macro_type: DiagramType.Sequence,
    })
    await wrapper.vm.$forceUpdate()
    await wrapper.vm.$nextTick()
    expect(impressions()).toHaveLength(1)
    await wrapper.get('[data-testid="ai-repair-button"]').trigger('click')

    expect(wrapper.get('[data-testid="legacy-ai-repair"]').text()).toBe('true')
    expect(wrapper.emitted('request-ai-chat-repair')).toBeUndefined()
  })

  it('keeps the legacy route when Chat is enabled without Chat repair', async () => {
    featureFlags.isAiChatEnabled.mockResolvedValue(true)
    const { wrapper } = await mountArmed()

    await wrapper.get('[data-testid="ai-repair-button"]').trigger('click')

    expect(wrapper.get('[data-testid="legacy-ai-repair"]').text()).toBe('true')
    expect(wrapper.emitted('request-ai-chat-repair')).toBeUndefined()
  })

  it('shows the repair action and routes through Chat when only Chat repair is enabled', async () => {
    featureFlags.isAiRepairEnabled.mockResolvedValue(false)
    featureFlags.isAiChatEnabled.mockResolvedValue(true)
    featureFlags.isAiChatRepairEnabled.mockResolvedValue(true)
    const { wrapper } = await mountArmed()

    expect(wrapper.find('[data-testid="legacy-ai-repair"]').exists()).toBe(false)
    await wrapper.get('[data-testid="ai-repair-button"]').trigger('click')

    expect(wrapper.emitted('request-ai-chat-repair')).toHaveLength(1)
  })

  it('routes through Chat when all three flags are enabled', async () => {
    featureFlags.isAiChatEnabled.mockResolvedValue(true)
    featureFlags.isAiChatRepairEnabled.mockResolvedValue(true)
    const { wrapper } = await mountArmed()

    expect(wrapper.find('[data-testid="legacy-ai-repair"]').exists()).toBe(false)
    await wrapper.get('[data-testid="ai-repair-button"]').trigger('click')

    expect(wrapper.emitted('request-ai-chat-repair')).toHaveLength(1)
  })

  it('falls back to the legacy dialog when the Chat flag lookup fails', async () => {
    featureFlags.isAiChatEnabled.mockRejectedValue(new Error('flag unavailable'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { wrapper } = await mountArmed()

    await wrapper.get('[data-testid="ai-repair-button"]').trigger('click')
    expect(wrapper.get('[data-testid="legacy-ai-repair"]').text()).toBe('true')
    expect(wrapper.emitted('request-ai-chat-repair')).toBeUndefined()
    consoleError.mockRestore()
  })

  it('falls back to the legacy dialog when the Chat repair flag lookup fails', async () => {
    featureFlags.isAiChatEnabled.mockResolvedValue(true)
    featureFlags.isAiChatRepairEnabled.mockRejectedValue(new Error('flag unavailable'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { wrapper } = await mountArmed()

    await wrapper.get('[data-testid="ai-repair-button"]').trigger('click')
    expect(wrapper.get('[data-testid="legacy-ai-repair"]').text()).toBe('true')
    expect(wrapper.emitted('request-ai-chat-repair')).toBeUndefined()
    consoleError.mockRestore()
  })

  it('does not offer AI Repair for Graph diagrams', async () => {
    featureFlags.isAiChatEnabled.mockResolvedValue(true)
    const { wrapper } = await mountArmed(DiagramType.Graph)

    expect(wrapper.find('[data-testid="ai-repair-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="legacy-ai-repair"]').exists()).toBe(false)
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('ai_repair_button_shown', expect.anything())
  })
})

describe('SyntaxErrorBox AI Repair arm delay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    featureFlags.isAiRepairEnabled.mockReset().mockResolvedValue(true)
    featureFlags.isAiChatEnabled.mockReset().mockResolvedValue(false)
    featureFlags.isAiChatRepairEnabled.mockReset().mockResolvedValue(false)
    vi.mocked(trackAnalyticsEvent).mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('withholds the button while the error is younger than the arm delay', async () => {
    const { wrapper } = mountSyntaxErrorBox()
    await settle()

    await advance(ARM_DELAY_MS - 1)

    expect(wrapper.find('[data-testid="ai-repair-button"]').exists()).toBe(false)
    expect(impressions()).toHaveLength(0)
  })

  it('shows the button and tracks one impression once the arm delay elapses', async () => {
    const { wrapper } = mountSyntaxErrorBox()
    await settle()

    await advance(ARM_DELAY_MS)

    expect(wrapper.find('[data-testid="ai-repair-button"]').exists()).toBe(true)
    expect(impressions()).toHaveLength(1)
  })

  it('never arms when the error clears before the arm delay elapses', async () => {
    const { wrapper, store } = mountSyntaxErrorBox()
    await settle()

    await advance(1500)
    store.state.error = null
    await advance(ARM_DELAY_MS)

    expect(wrapper.find('[data-testid="ai-repair-button"]').exists()).toBe(false)
    expect(impressions()).toHaveLength(0)
  })

  it('restarts the arm delay when a cleared error returns', async () => {
    const { wrapper, store } = mountSyntaxErrorBox()
    await settle()

    await advance(1500)
    store.state.error = null
    await settle()
    store.state.error = 'Syntax error at line 2'
    await advance(1500)

    expect(wrapper.find('[data-testid="ai-repair-button"]').exists()).toBe(false)
    expect(impressions()).toHaveLength(0)

    await advance(500)

    expect(wrapper.find('[data-testid="ai-repair-button"]').exists()).toBe(true)
    expect(impressions()).toHaveLength(1)
  })

  it('disarms the button as soon as the error clears', async () => {
    const { wrapper, store } = await (async () => {
      const mounted = mountSyntaxErrorBox()
      await settle()
      await advance(ARM_DELAY_MS)
      return mounted
    })()

    expect(wrapper.find('[data-testid="ai-repair-button"]').exists()).toBe(true)

    store.state.error = null
    await settle()

    expect(wrapper.find('[data-testid="ai-repair-button"]').exists()).toBe(false)
  })

  it('waits for a slow feature flag that resolves after the arm delay', async () => {
    // On a slow tenant the Forge bridge round-trip can outlast the arm delay,
    // so the two halves of the button's condition settle in the reverse order.
    let resolveRepairFlag: (enabled: boolean) => void = () => {}
    featureFlags.isAiRepairEnabled.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveRepairFlag = resolve
      }),
    )
    const { wrapper } = mountSyntaxErrorBox()
    await settle()

    await advance(ARM_DELAY_MS)

    expect(wrapper.find('[data-testid="ai-repair-button"]').exists()).toBe(false)
    expect(impressions()).toHaveLength(0)

    resolveRepairFlag(true)
    await settle()

    expect(wrapper.find('[data-testid="ai-repair-button"]').exists()).toBe(true)
    expect(impressions()).toHaveLength(1)
  })

  it('keeps the legacy repair dialog mounted while the button is unarmed', async () => {
    const { wrapper } = mountSyntaxErrorBox()
    await settle()

    await advance(ARM_DELAY_MS - 1)

    expect(wrapper.find('[data-testid="legacy-ai-repair"]').exists()).toBe(true)
  })
})
