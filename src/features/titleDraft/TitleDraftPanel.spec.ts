import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const renderMermaid = vi.hoisted(() => vi.fn())
vi.mock('@/utils/mermaid/renderMermaid', () => ({ renderMermaid }))

import TitleDraftPanel from './TitleDraftPanel.vue'

const MERMAID = 'sequenceDiagram\n  Buyer->>Manager: Request approval'

async function setup(add = vi.fn()) {
  const onClose = vi.fn()
  const wrapper = mount(TitleDraftPanel, { props: { mermaid: MERMAID, add, onClose }, attachTo: document.body })
  await flushPromises()
  return { wrapper, add, onClose }
}
const addButton = (w: ReturnType<typeof mount>) => w.get('[data-testid="title-draft-add"]')

beforeEach(() => {
  vi.clearAllMocks()
  renderMermaid.mockResolvedValue({ svg: '<svg data-testid="order-approval-workflow"></svg>' })
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

  it('Escape closes with dismissed', async () => {
    const { onClose } = await setup()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledWith({ outcome: 'dismissed' })
  })

  it('a render failure closes with dismissed', async () => {
    renderMermaid.mockRejectedValue(new Error('bad syntax'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { onClose } = await setup()
    expect(onClose).toHaveBeenCalledWith({ outcome: 'dismissed' })
  })
})
