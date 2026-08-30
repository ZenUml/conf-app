import React from 'react'
import ReactDOM from 'react-dom'
import { act } from 'react-dom/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fakeStore = vi.hoisted(() => {
  const state = { diagram: { title: '' } as { title: string } }
  return {
    state,
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

import OpenApiTitleInput from '@/components/react/OpenApiTitleInput'
import aiGenerateTitle from '@/apis/aiGenerateTitle'
import { useAutoTitle, TYPEWRITER_MS_PER_CHAR, SPARK_FADEOUT_MS } from '@/composables/useAutoTitle'
import { buildOpenApiAiTitleContent } from '@/model/OpenApi/OpenApiEditorState'

const SPEC = 'openapi: 3.0.0\ninfo:\n  title: ""\npaths:\n  /items: {}'
const okRes = (text: string) => ({ ok: true, text: async () => text }) as any

describe('OpenApiTitleInput', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    ;(useAutoTitle as any).__resetForTests()
    fakeStore.state.diagram.title = ''
    fakeStore.dispatch.mockClear()
    vi.mocked(aiGenerateTitle).mockReset()
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container)
    })
    container.remove()
    vi.useRealTimers()
  })

  async function renderTitleInput(onTitleChange = vi.fn(), title = '') {
    await act(async () => {
      ReactDOM.render(
        <OpenApiTitleInput
          title={title}
          spec={SPEC}
          parseError={null}
          onTitleChange={onTitleChange}
        />,
        container,
      )
      await Promise.resolve()
    })
    return onTitleChange
  }

  async function finishAnimation(title: string) {
    await act(async () => {
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(
        title.length * TYPEWRITER_MS_PER_CHAR + SPARK_FADEOUT_MS + 20,
      )
    })
  }

  it('shows the AI button and generates an OpenAPI title on demand', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Inventory API'))
    const onTitleChange = await renderTitleInput()
    const generateButton = container.querySelector<HTMLButtonElement>(
      'button[title="Generate title with AI"]',
    )

    expect(generateButton).not.toBeNull()
    act(() => generateButton!.click())
    await finishAnimation('Inventory API')

    expect(aiGenerateTitle).toHaveBeenCalledWith({
      dsl: buildOpenApiAiTitleContent(SPEC),
      type: 'OpenAPI specification',
    })
    expect(onTitleChange).toHaveBeenCalledWith('Inventory API')
    expect(container.querySelector('button[title="Dismiss suggested title"]')).not.toBeNull()
  })

  it('dismisses a generated title back to empty', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Inventory API'))
    const onTitleChange = await renderTitleInput()

    act(() => {
      container.querySelector<HTMLButtonElement>('button[title="Generate title with AI"]')!.click()
    })
    await finishAnimation('Inventory API')
    act(() => {
      container.querySelector<HTMLButtonElement>('button[title="Dismiss suggested title"]')!.click()
    })

    expect(onTitleChange).toHaveBeenLastCalledWith('')
    expect(fakeStore.dispatch).toHaveBeenLastCalledWith('updateTitle', '')
  })

  it('auto-generates after the OpenAPI spec debounce when the title is empty', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue(okRes('Inventory API'))
    await renderTitleInput()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1499)
    })
    expect(aiGenerateTitle).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(aiGenerateTitle).toHaveBeenCalledTimes(1)
  })
})
