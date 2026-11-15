import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const renderMermaid = vi.hoisted(() => vi.fn())
vi.mock('@/utils/mermaid/renderMermaid', () => ({ renderMermaid }))
const reloadTitleDraftPreview = vi.hoisted(() => vi.fn())
vi.mock('./previewReload', () => ({ reloadTitleDraftPreview }))

import TitleDraftPanel from './TitleDraftPanel.vue'

const MERMAID = 'sequenceDiagram\n  Buyer->>Manager: Request approval'
const PREVIEW_DEADLINE_MS = 10_000
const wrappers: Array<ReturnType<typeof mount>> = []

function setup(onPreviewReload = vi.fn(async () => {})) {
  let resolveRender!: (result: { svg: string }) => void
  let rejectRender!: (error: Error) => void
  renderMermaid.mockImplementation(() => new Promise((resolve, reject) => { resolveRender = resolve; rejectRender = reject }))
  const add = vi.fn()
  const onClose = vi.fn()
  const onPreviewRendered = vi.fn()
  const onPreviewRenderDelayed = vi.fn()
  const onPreviewRenderFailed = vi.fn(async () => {})
  const wrapper = mount(TitleDraftPanel, {
    props: { mermaid: MERMAID, add, onClose, onPreviewRendered, onPreviewRenderDelayed, onPreviewRenderFailed, onPreviewReload },
    attachTo: document.body,
  })
  wrappers.push(wrapper)
  return { wrapper, add, onClose, onPreviewRendered, onPreviewRenderDelayed, onPreviewRenderFailed, resolveRender, rejectRender }
}

const addButton = (wrapper: ReturnType<typeof mount>) => wrapper.get('[data-testid="title-draft-add"]')

beforeEach(() => {
  vi.clearAllMocks()
  // Keep flushPromises' setImmediate real; only the preview deadline needs a fake clock.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
})

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('TitleDraftPanel preview deadline', () => {
  it('shows loading feedback while the renderer never settles', async () => {
    const { wrapper, onClose } = setup()
    await flushPromises()

    expect(wrapper.get('[role="status"]').text()).toMatch(/prepar|load|render/i)
    expect(addButton(wrapper).attributes('disabled')).toBeDefined()
    expect(onClose).not.toHaveBeenCalled()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('offers Reload preview after 10 seconds without closing or allowing Add', async () => {
    const { wrapper, add, onClose, onPreviewRenderDelayed, onPreviewRenderFailed } = setup()
    await vi.advanceTimersByTimeAsync(PREVIEW_DEADLINE_MS - 1)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(wrapper.get('[role="alert"]').text()).toMatch(/preview.*taking too long/i)
    expect(wrapper.findAll('button').some(button => button.text() === 'Reload preview')).toBe(true)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(addButton(wrapper).attributes('disabled')).toBeDefined()
    await addButton(wrapper).trigger('click')
    expect(add).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(onPreviewRenderDelayed).toHaveBeenCalledTimes(1)
    expect(onPreviewRenderDelayed).toHaveBeenCalledWith(PREVIEW_DEADLINE_MS)
    expect(onPreviewRenderFailed).not.toHaveBeenCalled()
  })

  it('enables Add and clears the deadline when rendering finishes in time', async () => {
    const { wrapper, onClose, onPreviewRendered, resolveRender } = setup()
    await vi.advanceTimersByTimeAsync(PREVIEW_DEADLINE_MS - 1)
    resolveRender({ svg: '<svg data-testid="ready-preview"></svg>' })
    await flushPromises()

    expect(wrapper.find('[data-testid="ready-preview"]').exists()).toBe(true)
    expect(addButton(wrapper).attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(onPreviewRendered).toHaveBeenCalledTimes(1)
    expect(onPreviewRendered).toHaveBeenCalledWith(PREVIEW_DEADLINE_MS - 1)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(PREVIEW_DEADLINE_MS)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('automatically recovers when a slow render finishes after the recovery threshold', async () => {
    const { wrapper, onClose, onPreviewRendered, onPreviewRenderDelayed, resolveRender } = setup()
    await vi.advanceTimersByTimeAsync(12_000)
    resolveRender({ svg: '<svg data-testid="slow-preview"></svg>' })
    await flushPromises()

    expect(addButton(wrapper).attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-testid="slow-preview"]').exists()).toBe(true)
    expect(onPreviewRendered).toHaveBeenCalledTimes(1)
    expect(onPreviewRendered).toHaveBeenCalledWith(12_000)
    expect(onPreviewRenderDelayed).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="title-draft-reload"]').exists()).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('clears the pending deadline on unmount', async () => {
    const { wrapper, onClose, onPreviewRendered } = setup()
    await flushPromises()
    expect(vi.getTimerCount()).toBe(1)

    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(PREVIEW_DEADLINE_MS)
    expect(onClose).not.toHaveBeenCalled()
    expect(onPreviewRendered).not.toHaveBeenCalled()
  })

  it('offers failure recovery when a slow render eventually rejects', async () => {
    const { wrapper, onClose, onPreviewRendered, onPreviewRenderDelayed, onPreviewRenderFailed, rejectRender } = setup()
    await vi.advanceTimersByTimeAsync(PREVIEW_DEADLINE_MS)
    rejectRender(new Error('late rejection'))
    await flushPromises()

    expect(onPreviewRenderFailed).toHaveBeenCalledTimes(1)
    expect(onPreviewRenderFailed).toHaveBeenCalledWith('render_error', PREVIEW_DEADLINE_MS)
    expect(onPreviewRenderDelayed).toHaveBeenCalledTimes(1)
    expect(onPreviewRendered).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('could not be prepared')
    expect(addButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it.each(['resolve', 'reject'])('ignores a late render %s once Reload is requested', async (outcome) => {
    let finishReload!: () => void
    const onPreviewReload = vi.fn(() => new Promise<void>(resolve => { finishReload = resolve }))
    const { wrapper, onClose, onPreviewRendered, onPreviewRenderFailed, resolveRender, rejectRender } = setup(onPreviewReload)
    await vi.advanceTimersByTimeAsync(PREVIEW_DEADLINE_MS)
    await wrapper.get('[data-testid="title-draft-reload"]').trigger('click')
    expect(onPreviewReload).toHaveBeenCalledWith('timeout')
    if (outcome === 'resolve') resolveRender({ svg: '<svg data-testid="stale-preview"></svg>' })
    else rejectRender(new Error('stale rejection'))
    await flushPromises()

    expect(addButton(wrapper).attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="stale-preview"]').exists()).toBe(false)
    expect(onPreviewRendered).not.toHaveBeenCalled()
    expect(onPreviewRenderFailed).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(reloadTitleDraftPreview).not.toHaveBeenCalled()
    finishReload()
    await flushPromises()
    expect(reloadTitleDraftPreview).toHaveBeenCalledTimes(1)
    expect(renderMermaid).toHaveBeenCalledTimes(1)
  })

  it('clears the deadline and ignores late output after Escape', async () => {
    const { wrapper, onClose, onPreviewRendered, onPreviewRenderFailed, resolveRender } = setup()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(vi.getTimerCount()).toBe(0)
    resolveRender({ svg: '<svg data-testid="closed-preview"></svg>' })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(PREVIEW_DEADLINE_MS)

    expect(wrapper.find('[data-testid="closed-preview"]').exists()).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith({ outcome: 'dismissed', reason: 'escape' })
    expect(onPreviewRendered).not.toHaveBeenCalled()
    expect(onPreviewRenderFailed).not.toHaveBeenCalled()
  })
})
