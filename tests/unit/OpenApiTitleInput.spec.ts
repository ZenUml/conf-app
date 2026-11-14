import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fakeStore = vi.hoisted(() => {
  const state = { diagram: { title: '' } as { title: string } }
  return {
    state,
    commit: vi.fn((mutation: string, payload: string) => {
      if (mutation === 'updateTitle') state.diagram.title = (payload || '').trim()
    }),
    dispatch: vi.fn((action: string, payload: string) => {
      if (action === 'updateTitle') state.diagram.title = (payload || '').trim()
    }),
  }
})

vi.mock('@/model/store2', () => ({ default: fakeStore }))
vi.mock('@/apis/aiGenerateTitle', () => ({ default: vi.fn() }))
vi.mock('@/apis/aiTitleFeatureFlag', () => ({ resetFeatureFlagsForTests: vi.fn() }))
vi.mock('@/utils/toast', () => ({ toast: vi.fn() }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))

import OpenApiTitleInput from '@/components/OpenApi/OpenApiTitleInput.vue'
import aiGenerateTitle from '@/apis/aiGenerateTitle'
import { useAutoTitle, TYPEWRITER_MS_PER_CHAR, SPARK_FADEOUT_MS } from '@/composables/useAutoTitle'
import { buildOpenApiAiTitleContent } from '@/model/OpenApi/OpenApiEditorState'

const SPEC = 'openapi: 3.0.0\ninfo:\n  title: ""\npaths:\n  /items: {}'
const okRes = (text: string) => ({ ok: true, text: async () => text }) as any

describe('OpenApiTitleInput', () => {
  const wrappers: Array<ReturnType<typeof mount>> = []

  beforeEach(() => {
    ;(useAutoTitle as any).__resetForTests()
    fakeStore.state.diagram.title = ''
    fakeStore.commit.mockClear()
    fakeStore.dispatch.mockClear()
    vi.mocked(aiGenerateTitle).mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    wrappers.splice(0).forEach((w) => w.unmount())
    vi.useRealTimers()
  })

  async function renderTitleInput(onTitleChange = vi.fn(), title = '') {
    const wrapper = mount(OpenApiTitleInput, {
      props: {
        title,
        spec: SPEC,
        parseError: null,
        onTitleChange,
      },
    })
    wrappers.push(wrapper)
    await flushPromises()
    return { wrapper, onTitleChange }
  }

  async function finishAnimation(title: string) {
    await flushPromises()
    await vi.advanceTimersByTimeAsync(
      title.length * TYPEWRITER_MS_PER_CHAR + SPARK_FADEOUT_MS + 20,
    )
    await flushPromises()
  }

  it('shows the AI button and generates an OpenAPI title on demand', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Inventory API'))
    const { wrapper, onTitleChange } = await renderTitleInput()
    const generateButton = wrapper.find('button[title="Generate title with AI"]')

    expect(generateButton.exists()).toBe(true)
    await generateButton.trigger('click')
    await finishAnimation('Inventory API')

    expect(aiGenerateTitle).toHaveBeenCalledWith({
      dsl: buildOpenApiAiTitleContent(SPEC),
      type: 'OpenAPI specification',
    })
    expect(onTitleChange).toHaveBeenCalledWith('Inventory API')
    expect(wrapper.find('button[title="Dismiss suggested title"]').exists()).toBe(true)
  })

  it('dismisses a generated title back to empty', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Inventory API'))
    const { wrapper, onTitleChange } = await renderTitleInput()

    await wrapper.find('button[title="Generate title with AI"]').trigger('click')
    await finishAnimation('Inventory API')
    await wrapper.find('button[title="Dismiss suggested title"]').trigger('click')

    expect(onTitleChange).toHaveBeenLastCalledWith('')
    expect(fakeStore.dispatch).toHaveBeenLastCalledWith('updateTitle', '')
  })

  it('auto-generates after the OpenAPI spec debounce when the title is empty', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Inventory API'))
    await renderTitleInput()

    await vi.advanceTimersByTimeAsync(1499)
    expect(aiGenerateTitle).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(aiGenerateTitle).toHaveBeenCalledTimes(1)
  })
})
