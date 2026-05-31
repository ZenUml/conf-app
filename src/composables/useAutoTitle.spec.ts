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
vi.mock('@/apis/featureFlags', () => ({
  default: vi.fn().mockResolvedValue({ AI_TITLE: { enabled: true } }),
}))
vi.mock('@/utils/toast', () => ({ toast: vi.fn() }))

import { useAutoTitle, TYPEWRITER_MS_PER_CHAR, SPARK_FADEOUT_MS } from './useAutoTitle'
import aiGenerateTitle from '@/apis/aiGenerateTitle'
import getFeatureFlags from '@/apis/featureFlags'
import { toast } from '@/utils/toast'

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
    vi.mocked(getFeatureFlags).mockResolvedValue({ AI_TITLE: { enabled: true } } as any)
    vi.mocked(toast).mockClear()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('initFlag enables when AI_TITLE flag is on', async () => {
    const { initFlag, aiTitleEnabled } = useAutoTitle()
    await initFlag()
    expect(aiTitleEnabled.value).toBe(true)
  })

  it('does not call the API when the flag is off', async () => {
    vi.mocked(getFeatureFlags).mockResolvedValue({ AI_TITLE: { enabled: false } } as any)
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

  it('is silent on auto-trigger errors but toasts on manual errors', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(errRes('boom'))
    const { initFlag, generate } = useAutoTitle()
    await initFlag()
    await generate('init', SEQ)
    await vi.advanceTimersByTimeAsync(0)
    expect(toast).not.toHaveBeenCalled()
    await generate('user', SEQ)
    await vi.advanceTimersByTimeAsync(0)
    expect(toast).toHaveBeenCalled()
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
})
