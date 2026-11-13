import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const renderMermaid = vi.hoisted(() => vi.fn())
vi.mock('@/utils/mermaid/renderMermaid', () => ({ renderMermaid }))
const reloadTitleDraftPreview = vi.hoisted(() => vi.fn())
vi.mock('./previewReload', () => ({ reloadTitleDraftPreview }))

import TitleDraftPanel from './TitleDraftPanel.vue'

const MERMAID = 'sequenceDiagram\n  Buyer->>Manager: Request approval'
const wrappers: Array<ReturnType<typeof mount>> = []

async function setup(add = vi.fn()) {
  const onClose = vi.fn()
  const wrapper = mount(TitleDraftPanel, { props: { mermaid: MERMAID, add, onClose }, attachTo: document.body })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, add, onClose }
}
const addButton = (w: ReturnType<typeof mount>) => w.get('[data-testid="title-draft-add"]')

beforeEach(() => {
  vi.clearAllMocks()
  renderMermaid.mockResolvedValue({ svg: '<svg data-testid="order-approval-workflow"></svg>' })
})

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
})

describe('TitleDraftPanel', () => {
  it('renders the svg and the source line', async () => {
    const { wrapper } = await setup()
    expect(wrapper.find('[data-testid="title-draft-preview"] svg').exists()).toBe(true)
    expect(wrapper.text()).toContain('Based on the page title')
    expect(renderMermaid).toHaveBeenCalledWith(expect.stringMatching(/^title-draft-/), MERMAID)
  })

  it('calls add once while busy', async () => {
    let finish!: (v: any) => void
    const add = vi.fn(() => new Promise(r => { finish = r }))
    const { wrapper, onClose } = await setup(add)
    await addButton(wrapper).trigger('click')
    await addButton(wrapper).trigger('click')
    expect(add).toHaveBeenCalledTimes(1)
    expect(addButton(wrapper).attributes('disabled')).toBeDefined()
    finish({ result: 'added', contentId: 'c1' })
    await flushPromises()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('added closes with the content id', async () => {
    const { wrapper, onClose } = await setup(vi.fn(async () => ({ result: 'added', contentId: 'c1' })))
    await addButton(wrapper).trigger('click')
    await flushPromises()
    expect(onClose).toHaveBeenCalledWith({ outcome: 'added', contentId: 'c1' })
  })

  it('already_added closes with that outcome', async () => {
    const { wrapper, onClose } = await setup(vi.fn(async () => ({ result: 'already_added' })))
    await addButton(wrapper).trigger('click')
    await flushPromises()
    expect(onClose).toHaveBeenCalledWith({ outcome: 'already_added' })
  })

  it('forbidden shows the permission message and stays open', async () => {
    const { wrapper, onClose } = await setup(vi.fn(async () => ({ result: 'forbidden' })))
    await addButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('You need permission to edit this page to add a diagram.')
    expect(onClose).not.toHaveBeenCalled()
    expect(addButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it.each(['failed', 'conflict', 'save_failed'])('%s shows the retry message', async (result) => {
    const { wrapper, onClose } = await setup(vi.fn(async () => ({ result })))
    await addButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('The diagram was not added. Try again.')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Escape closes once with the explicit reason', async () => {
    const { onClose } = await setup()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledWith({ outcome: 'dismissed', reason: 'escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a render failure offers recovery and leaves the modal open', async () => {
    renderMermaid.mockRejectedValue(new Error('bad syntax'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { wrapper, onClose } = await setup()
    expect(wrapper.get('[role="alert"]').text()).toContain('This preview could not be prepared')
    expect(wrapper.get('[data-testid="title-draft-reload"]').text()).toBe('Reload preview')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(addButton(wrapper).attributes('disabled')).toBeDefined()
    expect(onClose).not.toHaveBeenCalled()
  })

  it.each(['', '   '])('offers recovery for an empty SVG (%j)', async (svg) => {
    renderMermaid.mockResolvedValue({ svg })
    const onPreviewRendered = vi.fn()
    const onPreviewRenderFailed = vi.fn(async () => {})
    const onClose = vi.fn()
    const wrapper = mount(TitleDraftPanel, { props: {
      mermaid: MERMAID, add: vi.fn(), onClose, onPreviewRendered, onPreviewRenderFailed,
    } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Reload the preview to try again.')
    expect(onPreviewRenderFailed).toHaveBeenCalledWith('empty_svg', expect.any(Number))
    expect(onPreviewRendered).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(addButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it.each(['resolve', 'reject', 'throw'])('reloads the iframe after the reload callback %s', async (outcome) => {
    renderMermaid.mockRejectedValue(new Error('bad syntax'))
    let finish!: () => void
    const onPreviewReload = vi.fn(() => {
      if (outcome === 'throw') throw new Error('analytics unavailable')
      if (outcome === 'reject') return Promise.reject(new Error('analytics unavailable'))
      return new Promise<void>(resolve => { finish = resolve })
    })
    const onClose = vi.fn()
    const wrapper = mount(TitleDraftPanel, { props: {
      mermaid: MERMAID, add: vi.fn(), onClose, onPreviewReload,
    } })
    wrappers.push(wrapper)
    await flushPromises()
    const reload = wrapper.get('[data-testid="title-draft-reload"]')
    await reload.trigger('click')
    expect(onPreviewReload).toHaveBeenCalledWith('render_error')
    if (outcome === 'resolve') {
      expect(reloadTitleDraftPreview).not.toHaveBeenCalled()
      await reload.trigger('click')
      expect(onPreviewReload).toHaveBeenCalledTimes(1)
      finish()
    }
    await flushPromises()
    expect(reloadTitleDraftPreview).toHaveBeenCalledTimes(1)
    expect(renderMermaid).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not let throwing telemetry callbacks stop render or Add', async () => {
    const fail = () => { throw new Error('analytics unavailable') }
    const add = vi.fn(async () => ({ result: 'added' as const, contentId: 'c1' }))
    const onClose = vi.fn()
    const wrapper = mount(TitleDraftPanel, { props: {
      mermaid: MERMAID, add, onClose, onPreviewMounted: fail, onPreviewRendered: fail, onAddClicked: fail,
    } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(addButton(wrapper).attributes('disabled')).toBeUndefined()
    await addButton(wrapper).trigger('click')
    await flushPromises()
    expect(add).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith({ outcome: 'added', contentId: 'c1' })
  })

  it.each(['reject', 'throw'])('keeps recovery visible when failure telemetry %s', async (outcome) => {
    renderMermaid.mockRejectedValue(new Error('bad syntax'))
    const onPreviewRenderFailed = vi.fn(() => {
      if (outcome === 'throw') throw new Error('analytics unavailable')
      return Promise.reject(new Error('analytics unavailable'))
    })
    const onClose = vi.fn()
    const wrapper = mount(TitleDraftPanel, { props: {
      mermaid: MERMAID, add: vi.fn(), onClose, onPreviewRenderFailed,
    } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(onPreviewRenderFailed).toHaveBeenCalledWith('render_error', expect.any(Number))
    expect(wrapper.get('[role="alert"]').text()).toContain('Reload the preview')
    expect(onClose).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'reject'])('ignores a late render %s after unmount', async (result) => {
    let resolve!: (v: any) => void
    let reject!: (v: any) => void
    renderMermaid.mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no }))
    const onClose = vi.fn()
    const onPreviewRendered = vi.fn()
    const onPreviewRenderFailed = vi.fn()
    const wrapper = mount(TitleDraftPanel, { props: {
      mermaid: MERMAID, add: vi.fn(), onClose, onPreviewRendered, onPreviewRenderFailed,
    } })
    wrapper.unmount()
    if (result === 'resolve') resolve({ svg: '<svg />' })
    else reject(new Error('late failure'))
    await flushPromises()
    expect(onClose).not.toHaveBeenCalled()
    expect(onPreviewRendered).not.toHaveBeenCalled()
    expect(onPreviewRenderFailed).not.toHaveBeenCalled()
  })

  it('does not close twice when an add finishes after Escape', async () => {
    let finish!: (v: any) => void
    const { wrapper, onClose } = await setup(vi.fn(() => new Promise(resolve => { finish = resolve })))
    await addButton(wrapper).trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    finish({ result: 'added', contentId: 'c1' })
    await flushPromises()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith({ outcome: 'dismissed', reason: 'escape' })
  })
})
