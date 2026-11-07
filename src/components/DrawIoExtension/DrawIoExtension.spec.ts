import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { DiagramType } from '@/model/Diagram/Diagram'

// The title is read through a computed, so the fake store state must be reactive.
vi.mock('@/model/store2', async () => {
  const { reactive } = await import('vue')
  const state = reactive({ diagram: { title: '', id: '' } })
  return {
    default: {
      state,
      dispatch: (action: string, payload: any) => {
        if (action === 'updateTitle') state.diagram.title = (payload || '').trim()
      },
    },
  }
})
vi.mock('@/apis/aiGenerateTitle', () => ({ default: vi.fn() }))
vi.mock('@/apis/aiTitleFeatureFlag', () => ({ resetFeatureFlagsForTests: vi.fn() }))
vi.mock('@/utils/toast', () => ({ toast: vi.fn() }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))
vi.mock('@/utils/analytics/publishIntent', () => ({ trackPublishBlocked: vi.fn() }))
vi.mock('@/utils/graph/extractGraphText', () => ({
  extractGraphText: () => 'Start\nCheckout\nPay',
  singleShortLabel: () => '',
}))

import DrawIoExtension from './DrawIoExtension.vue'
import store from '@/model/store2'
import aiGenerateTitle from '@/apis/aiGenerateTitle'
import { trackPublishBlocked } from '@/utils/analytics/publishIntent'
import { useAutoTitle, TYPEWRITER_MS_PER_CHAR, SPARK_FADEOUT_MS } from '@/composables/useAutoTitle'

const HeaderStub = { template: '<div />', methods: { focusInput() {} } }

describe('DrawIoExtension ensureTitle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ;(useAutoTitle as any).__resetForTests()
    store.state.diagram.title = ''
    vi.mocked(aiGenerateTitle).mockReset()
    vi.mocked(trackPublishBlocked).mockClear()
  })
  afterEach(() => {
    delete (window as any).ensureTitle
    vi.useRealTimers()
  })

  it('waits for an in-flight AI title instead of flagging a title block', async () => {
    let finish!: (res: any) => void
    vi.mocked(aiGenerateTitle).mockReturnValue(new Promise(resolve => { finish = resolve }) as any)
    const wrapper = shallowMount(DrawIoExtension, {
      props: { currentXml: '<mxfile />' },
      global: { stubs: { DrawIoHeader: HeaderStub } },
    })
    // The init generation is already running when Publish is clicked.
    const { generate, isGeneratingTitle } = useAutoTitle()
    void generate('init', { code: 'Start\nCheckout\nPay', diagramType: DiagramType.Graph, currentTitle: '' })
    await vi.advanceTimersByTimeAsync(0)
    expect(isGeneratingTitle.value).toBe(true)

    const published = (window as any).ensureTitle() as Promise<string>
    await vi.advanceTimersByTimeAsync(0)

    expect(trackPublishBlocked).not.toHaveBeenCalled()
    expect((wrapper.vm as any).titleError).toBe(false)

    const title = 'Checkout flow'
    finish({ ok: true, text: async () => title })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(title.length * TYPEWRITER_MS_PER_CHAR + SPARK_FADEOUT_MS + 20)

    await expect(published).resolves.toBe(title)
    expect(trackPublishBlocked).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('still flags a title block when the in-flight generation ends without a title', async () => {
    let finish!: (res: any) => void
    vi.mocked(aiGenerateTitle).mockReturnValue(new Promise(resolve => { finish = resolve }) as any)
    const wrapper = shallowMount(DrawIoExtension, {
      props: { currentXml: '<mxfile />' },
      global: { stubs: { DrawIoHeader: HeaderStub } },
    })
    const { generate } = useAutoTitle()
    void generate('init', { code: 'Start\nCheckout\nPay', diagramType: DiagramType.Graph, currentTitle: '' })
    await vi.advanceTimersByTimeAsync(0)

    void (window as any).ensureTitle()
    await vi.advanceTimersByTimeAsync(0)
    expect(trackPublishBlocked).not.toHaveBeenCalled()

    finish({ ok: false, text: async () => 'model unavailable' })
    await vi.advanceTimersByTimeAsync(0)

    expect(trackPublishBlocked).toHaveBeenCalledTimes(1)
    expect((wrapper.vm as any).titleError).toBe(true)
    wrapper.unmount()
  })
})
