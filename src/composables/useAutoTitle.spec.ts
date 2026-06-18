import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DiagramType } from '@/model/Diagram/Diagram'

const fakeStore = vi.hoisted(() => {
  const state = { diagram: { title: '' } as { title: string } }
  return {
    state,
    dispatch: vi.fn((action: string, payload: any) => {
      if (action === 'updateTitle') state.diagram.title = (payload || '').trim()
    }),
  }
})
vi.mock('@/model/store2', () => ({ default: fakeStore }))
vi.mock('@/apis/aiGenerateTitle', () => ({ default: vi.fn() }))
vi.mock('@/apis/aiFeatureFlags', () => ({
  isAiTitleEnabled: vi.fn().mockResolvedValue(true),
  resetAiTitleFlagForTests: vi.fn(),
}))
vi.mock('@/utils/toast', () => ({ toast: vi.fn() }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))

import { useAutoTitle, notifyAiTitleSaved, TYPEWRITER_MS_PER_CHAR, SPARK_FADEOUT_MS } from './useAutoTitle'
import aiGenerateTitle from '@/apis/aiGenerateTitle'
import { isAiTitleEnabled } from '@/apis/aiFeatureFlags'
import { toast } from '@/utils/toast'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

const okRes = (text: string) => ({ ok: true, text: async () => text }) as any
const errRes = (text: string) => ({ ok: false, text: async () => text }) as any
const SEQ = { code: 'A->B: hi', diagramType: DiagramType.Sequence, currentTitle: '' }

async function runAnimation(title: string) {
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(title.length * TYPEWRITER_MS_PER_CHAR + SPARK_FADEOUT_MS + 20)
}

describe('useAutoTitle', () => {
  beforeEach(() => {
    ;(useAutoTitle as any).__resetForTests()
    fakeStore.dispatch.mockClear()
    fakeStore.state.diagram.title = ''
    vi.mocked(aiGenerateTitle).mockReset()
    vi.mocked(isAiTitleEnabled).mockResolvedValue(true)
    vi.mocked(toast).mockClear()
    vi.mocked(trackAnalyticsEvent).mockClear()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('initFlag enables when AI_TITLE flag is on', async () => {
    const { initFlag, aiTitleEnabled } = useAutoTitle()
    await initFlag()
    expect(aiTitleEnabled.value).toBe(true)
  })

  it('does not call the API when the flag is off', async () => {
    vi.mocked(isAiTitleEnabled).mockResolvedValue(false)
    const { initFlag, generate } = useAutoTitle()
    await initFlag()
    await generate('init', SEQ)
    expect(aiGenerateTitle).not.toHaveBeenCalled()
  })

  it('skips auto when a title already exists', async () => {
    const { initFlag, generate } = useAutoTitle()
    await initFlag()
    await generate('init', { ...SEQ, currentTitle: 'Already named' })
    expect(aiGenerateTitle).not.toHaveBeenCalled()
  })

  it('skips auto after a manual edit', async () => {
    const { initFlag, generate, markManualEdit } = useAutoTitle()
    await initFlag()
    markManualEdit()
    await generate('init', SEQ)
    expect(aiGenerateTitle).not.toHaveBeenCalled()
  })

  it('skips when there is no diagram content', async () => {
    const { initFlag, generate } = useAutoTitle()
    await initFlag()
    await generate('init', { ...SEQ, code: '   ' })
    expect(aiGenerateTitle).not.toHaveBeenCalled()
  })

  it('commits the typed-out title to the store on success', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Checkout'))
    const { initFlag, generate, showSpark } = useAutoTitle()
    await initFlag()
    const p = generate('init', SEQ)
    await runAnimation('Order Checkout')
    await p
    expect(aiGenerateTitle).toHaveBeenCalledWith({ dsl: 'A->B: hi', type: 'sequence' })
    expect(fakeStore.dispatch).toHaveBeenCalledWith('updateTitle', 'Order Checkout')
    expect(showSpark.value).toBe(false)
  })

  it('does not re-trigger for unchanged content (dedup hash)', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Checkout'))
    const { initFlag, generate } = useAutoTitle()
    await initFlag()
    const p = generate('init', SEQ)
    await runAnimation('Order Checkout')
    await p
    fakeStore.state.diagram.title = ''
    await generate('init', SEQ)
    expect(aiGenerateTitle).toHaveBeenCalledTimes(1)
  })

  it('ignores a concurrent generate while one is in flight', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Checkout'))
    const { initFlag, generate } = useAutoTitle()
    await initFlag()
    const p1 = generate('init', SEQ)
    await generate('init', SEQ)
    await runAnimation('Order Checkout')
    await p1
    expect(aiGenerateTitle).toHaveBeenCalledTimes(1)
  })

  it('reverts the title to empty on dismiss and stays deduped', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Checkout'))
    const { initFlag, generate, dismiss } = useAutoTitle()
    await initFlag()
    const p = generate('init', SEQ)
    await runAnimation('Order Checkout')
    await p
    fakeStore.dispatch.mockClear()
    dismiss()
    expect(fakeStore.dispatch).toHaveBeenCalledWith('updateTitle', '')
    await generate('init', SEQ)
    expect(aiGenerateTitle).toHaveBeenCalledTimes(1)
  })

  it('is silent on auto-trigger errors but toasts a friendly message on manual errors', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(errRes('AiError: 5028: This model was deprecated'))
    const { initFlag, generate } = useAutoTitle()
    await initFlag()
    await generate('init', SEQ)
    await vi.advanceTimersByTimeAsync(0)
    expect(toast).not.toHaveBeenCalled()
    await generate('user', SEQ)
    await vi.advanceTimersByTimeAsync(0)
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: "Couldn't generate a title — please try again later." }))
  })

  it('maps Mermaid + PlantUML to the right type param', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('T'))
    const { initFlag, generate } = useAutoTitle()
    await initFlag()
    const p1 = generate('user', { code: 'sequenceDiagram\n A->>B: hi', diagramType: DiagramType.Mermaid, currentTitle: '' })
    await runAnimation('T'); await p1
    const p2 = generate('user', { code: '@startuml\nA->B\n@enduml', diagramType: DiagramType.PlantUml, currentTitle: '' })
    await runAnimation('T'); await p2
    expect(aiGenerateTitle).toHaveBeenNthCalledWith(1, { dsl: 'sequenceDiagram\n A->>B: hi', type: 'sequence' })
    expect(aiGenerateTitle).toHaveBeenNthCalledWith(2, { dsl: '@startuml\nA->B\n@enduml', type: 'plantuml' })
  })

  it('reset() clears per-document guards so a fresh diagram can auto-title', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Checkout'))
    const { initFlag, generate, dismiss, reset } = useAutoTitle()
    await initFlag()
    const p = generate('init', SEQ)
    await runAnimation('Order Checkout')
    await p
    dismiss()
    reset()
    fakeStore.state.diagram.title = ''
    const p2 = generate('init', SEQ)
    await runAnimation('Order Checkout')
    await p2
    expect(aiGenerateTitle).toHaveBeenCalledTimes(2)
  })

  it('notifyAiTitleSaved fires ai_title_accepted when title was generated and resets the flag', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Checkout'))
    const { initFlag, generate } = useAutoTitle()
    await initFlag()
    const p = generate('init', SEQ)
    await runAnimation('Order Checkout')
    await p
    notifyAiTitleSaved()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('ai_title_accepted', expect.objectContaining({ feature_area: 'ai' }))
    // second call should not double-fire
    vi.mocked(trackAnalyticsEvent).mockClear()
    notifyAiTitleSaved()
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('ai_title_accepted', expect.anything())
  })

  it('markManualEdit fires ai_title_modified only when a title was already generated', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Checkout'))
    const { initFlag, generate, markManualEdit } = useAutoTitle()
    await initFlag()
    // before any generation — no event
    markManualEdit()
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('ai_title_modified', expect.anything())
    vi.mocked(trackAnalyticsEvent).mockClear()
    // after generation completes — fires
    ;(useAutoTitle as any).__resetForTests()
    await initFlag()
    const p = generate('init', SEQ)
    await runAnimation('Order Checkout')
    await p
    markManualEdit()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('ai_title_modified', expect.objectContaining({ feature_area: 'ai' }))
  })

  it('second user-triggered generate uses generation_source regenerate', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Checkout'))
    const { initFlag, generate } = useAutoTitle()
    await initFlag()
    const p1 = generate('init', SEQ)
    await runAnimation('Order Checkout')
    await p1
    vi.mocked(trackAnalyticsEvent).mockClear()
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('New Title'))
    const p2 = generate('user', SEQ)
    await runAnimation('New Title')
    await p2
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('ai_generation_requested', expect.objectContaining({ generation_source: 'regenerate' }))
  })

  it('manual edit mid-typewriter stops animation and clears displayedTitle', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Checkout Process'))
    const { initFlag, generate, markManualEdit, displayedTitle, isAnimating } = useAutoTitle()
    await initFlag()
    const p = generate('init', SEQ)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(TYPEWRITER_MS_PER_CHAR * 3)
    markManualEdit()
    expect(isAnimating.value).toBe(false)
    expect(displayedTitle.value).toBe('')
    await vi.advanceTimersByTimeAsync(500)
    await p
    expect(fakeStore.dispatch).not.toHaveBeenCalledWith('updateTitle', 'Order Checkout Process')
  })
})
