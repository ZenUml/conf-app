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
vi.mock('@/apis/aiTitleFeatureFlag', () => ({ resetFeatureFlagsForTests: vi.fn() }))
vi.mock('@/utils/toast', () => ({ toast: vi.fn() }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))

import { useAutoTitle, notifyAiTitleSaved, TYPEWRITER_MS_PER_CHAR, SPARK_FADEOUT_MS } from './useAutoTitle'
import aiGenerateTitle from '@/apis/aiGenerateTitle'
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
    vi.mocked(toast).mockClear()
    vi.mocked(trackAnalyticsEvent).mockClear()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('keeps AI title generation enabled without a feature-flag lookup', async () => {
    const { aiTitleEnabled } = useAutoTitle()
    expect(aiTitleEnabled.value).toBe(true)
  })

  it('skips auto when a title already exists', async () => {
    const { generate } = useAutoTitle()
    await generate('init', { ...SEQ, currentTitle: 'Already named' })
    expect(aiGenerateTitle).not.toHaveBeenCalled()
  })

  it('skips auto after a manual edit', async () => {
    const { generate, markManualEdit } = useAutoTitle()
    markManualEdit()
    await generate('init', SEQ)
    expect(aiGenerateTitle).not.toHaveBeenCalled()
  })

  it('skips when there is no diagram content', async () => {
    const { generate } = useAutoTitle()
    await generate('init', { ...SEQ, code: '   ' })
    expect(aiGenerateTitle).not.toHaveBeenCalled()
  })

  it('commits the typed-out title to the store on success', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Checkout'))
    const { generate, showSpark } = useAutoTitle()
    const p = generate('init', SEQ)
    await runAnimation('Order Checkout')
    await p
    expect(aiGenerateTitle).toHaveBeenCalledWith({ dsl: 'A->B: hi', type: 'sequence' })
    expect(fakeStore.dispatch).toHaveBeenCalledWith('updateTitle', 'Order Checkout')
    expect(showSpark.value).toBe(false)
  })

  it('sends type "flowchart" for Graph diagrams (extracted labels as dsl)', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Flow'))
    const { generate } = useAutoTitle()
    const p = generate('init', {
      code: 'Start\nProcess order\nEnd',
      diagramType: DiagramType.Graph,
      currentTitle: '',
    })
    await runAnimation('Order Flow')
    await p
    expect(aiGenerateTitle).toHaveBeenCalledWith({ dsl: 'Start\nProcess order\nEnd', type: 'flowchart' })
    expect(fakeStore.dispatch).toHaveBeenCalledWith('updateTitle', 'Order Flow')
  })

  it('sends the OpenAPI specification type for OpenAPI documents', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Inventory API'))
    const { generate } = useAutoTitle()
    const spec = 'openapi: 3.0.0\ninfo:\n  title: ""\npaths:\n  /items: {}'
    const p = generate('user', {
      code: spec,
      diagramType: DiagramType.OpenApi,
      currentTitle: '',
    })
    await runAnimation('Inventory API')
    await p
    expect(aiGenerateTitle).toHaveBeenCalledWith({
      dsl: spec,
      type: 'OpenAPI specification',
    })
    expect(fakeStore.dispatch).toHaveBeenCalledWith('updateTitle', 'Inventory API')
  })

  it('does not re-trigger for unchanged content (dedup hash)', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Checkout'))
    const { generate } = useAutoTitle()
    const p = generate('init', SEQ)
    await runAnimation('Order Checkout')
    await p
    fakeStore.state.diagram.title = ''
    await generate('init', SEQ)
    expect(aiGenerateTitle).toHaveBeenCalledTimes(1)
  })

  it('ignores a concurrent generate while one is in flight', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Checkout'))
    const { generate } = useAutoTitle()
    const p1 = generate('init', SEQ)
    await generate('init', SEQ)
    await runAnimation('Order Checkout')
    await p1
    expect(aiGenerateTitle).toHaveBeenCalledTimes(1)
  })

  it('reverts the title to empty on dismiss and stays deduped', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Checkout'))
    const { generate, dismiss } = useAutoTitle()
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
    const { generate } = useAutoTitle()
    await generate('init', SEQ)
    await vi.advanceTimersByTimeAsync(0)
    expect(toast).not.toHaveBeenCalled()
    await generate('user', SEQ)
    await vi.advanceTimersByTimeAsync(0)
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: "Couldn't generate a title — please try again later." }))
  })

  it('rejects a non-title response (a question) and does not set the title', async () => {
    const badReply = "I'm ready to help. What is the DSL that describes the flowchart diagram?"
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes(badReply))
    const { generate } = useAutoTitle()
    const p = generate('user', { code: 'Order Service', diagramType: DiagramType.Graph, currentTitle: '' })
    await runAnimation(badReply)
    await p
    expect(fakeStore.state.diagram.title).toBe('')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'ai_generation_failed',
      expect.objectContaining({ failure_reason: 'not_title_like' }),
    )
  })

  it('accepts a normal short title (positive guard against over-rejecting)', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Processing Flow'))
    const { generate } = useAutoTitle()
    const p = generate('user', { code: 'Order Service', diagramType: DiagramType.Graph, currentTitle: '' })
    await runAnimation('Order Processing Flow')
    await p
    expect(fakeStore.dispatch).toHaveBeenCalledWith('updateTitle', 'Order Processing Flow')
  })

  it('maps Mermaid + PlantUML to the right type param', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('T'))
    const { generate } = useAutoTitle()
    const p1 = generate('user', { code: 'sequenceDiagram\n A->>B: hi', diagramType: DiagramType.Mermaid, currentTitle: '' })
    await runAnimation('T'); await p1
    const p2 = generate('user', { code: '@startuml\nA->B\n@enduml', diagramType: DiagramType.PlantUml, currentTitle: '' })
    await runAnimation('T'); await p2
    expect(aiGenerateTitle).toHaveBeenNthCalledWith(1, { dsl: 'sequenceDiagram\n A->>B: hi', type: 'sequence' })
    expect(aiGenerateTitle).toHaveBeenNthCalledWith(2, { dsl: '@startuml\nA->B\n@enduml', type: 'plantuml' })
  })

  it('reset() clears per-document guards so a fresh diagram can auto-title', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Checkout'))
    const { generate, dismiss, reset } = useAutoTitle()
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
    const { generate } = useAutoTitle()
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
    const { generate, markManualEdit } = useAutoTitle()
    // before any generation — no event
    markManualEdit()
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('ai_title_modified', expect.anything())
    vi.mocked(trackAnalyticsEvent).mockClear()
    // after generation completes — fires
    ;(useAutoTitle as any).__resetForTests()
    const p = generate('init', SEQ)
    await runAnimation('Order Checkout')
    await p
    markManualEdit()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('ai_title_modified', expect.objectContaining({ feature_area: 'ai' }))
  })

  it('fires ai_title_modified at most once per generated title across many keystrokes', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Checkout'))
    const { generate, markManualEdit } = useAutoTitle()
    const p = generate('init', SEQ)
    await runAnimation('Order Checkout')
    await p
    // onInput calls markManualEdit on every keystroke — simulate typing 5 chars
    markManualEdit()
    markManualEdit()
    markManualEdit()
    markManualEdit()
    markManualEdit()
    const modifiedCalls = vi
      .mocked(trackAnalyticsEvent)
      .mock.calls.filter((c) => c[0] === 'ai_title_modified')
    expect(modifiedCalls).toHaveLength(1)
  })

  it('re-arms ai_title_modified after a fresh generation', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Checkout'))
    const { generate, markManualEdit } = useAutoTitle()
    const p1 = generate('init', SEQ)
    await runAnimation('Order Checkout')
    await p1
    markManualEdit() // first edit episode → 1 event
    markManualEdit()
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('New Title'))
    const p2 = generate('user', SEQ)
    await runAnimation('New Title')
    await p2
    markManualEdit() // new title → eligible again → 1 more event
    markManualEdit()
    const modifiedCalls = vi
      .mocked(trackAnalyticsEvent)
      .mock.calls.filter((c) => c[0] === 'ai_title_modified')
    expect(modifiedCalls).toHaveLength(2)
  })

  it('second user-triggered generate uses generation_source regenerate', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Order Checkout'))
    const { generate } = useAutoTitle()
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
    const { generate, markManualEdit, displayedTitle, isAnimating } = useAutoTitle()
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
