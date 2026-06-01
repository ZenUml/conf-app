import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const fakeStore = vi.hoisted(() => {
  const state = { diagram: { title: '', diagramType: 'sequence', code: 'A->B: hi' } as any }
  return {
    state,
    dispatch: vi.fn((action: string, payload: any) => {
      if (action === 'updateTitle') state.diagram.title = (payload || '').trim()
    }),
  }
})
vi.mock('@/model/store2', () => ({ default: fakeStore }))
vi.mock('@/apis/aiGenerateTitle', () => ({ default: vi.fn().mockResolvedValue({ ok: true, text: async () => 'T' }) }))
vi.mock('@/apis/aiTitleFeatureFlag', () => ({ isAiTitleEnabled: vi.fn().mockResolvedValue(true), resetAiTitleFlagForTests: vi.fn() }))
vi.mock('@/utils/toast', () => ({ toast: vi.fn() }))

import DiagramTitleInput from '@/components/Header/DiagramTitleInput.vue'
import { useAutoTitle } from '@/composables/useAutoTitle'
import EventBus from '@/EventBus'

describe('DiagramTitleInput', () => {
  beforeEach(() => {
    ;(useAutoTitle as any).__resetForTests()
    fakeStore.dispatch.mockClear()
    fakeStore.state.diagram.title = ''
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('shows the manual generate button when the flag is enabled', async () => {
    const wrapper = mount(DiagramTitleInput)
    await flushPromises()
    expect(wrapper.find('button[title="Generate title with AI"]').exists()).toBe(true)
  })

  it('hides the manual generate button when the flag is disabled', async () => {
    const { isAiTitleEnabled } = await import('@/apis/aiTitleFeatureFlag')
    vi.mocked(isAiTitleEnabled).mockResolvedValueOnce(false)
    const wrapper = mount(DiagramTitleInput)
    await flushPromises()
    expect(wrapper.find('button[title="Generate title with AI"]').exists()).toBe(false)
  })

  it('dispatches updateTitle and locks auto on manual typing', async () => {
    const wrapper = mount(DiagramTitleInput)
    await flushPromises()
    await wrapper.find('input').setValue('My own title')
    expect(fakeStore.dispatch).toHaveBeenCalledWith('updateTitle', 'My own title')
    expect((useAutoTitle() as any).hasManuallyEditedTitle.value).toBe(true)
  })

  it('re-enables auto-generation when user clears the title', async () => {
    const wrapper = mount(DiagramTitleInput)
    await flushPromises()
    // Type a title — locks auto-gen
    await wrapper.find('input').setValue('My title')
    expect((useAutoTitle() as any).hasManuallyEditedTitle.value).toBe(true)
    // Clear the title — should re-enable auto-gen
    await wrapper.find('input').setValue('')
    expect((useAutoTitle() as any).hasManuallyEditedTitle.value).toBe(false)
  })

  it('flashes the error border on the flash-title-error event', async () => {
    const wrapper = mount(DiagramTitleInput)
    await flushPromises()
    EventBus.$emit('flash-title-error')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.border-red-400').exists()).toBe(true)
  })
})
