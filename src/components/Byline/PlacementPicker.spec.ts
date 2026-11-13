import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import PlacementPicker from './PlacementPicker.vue'
import { PLACEMENT_PAGE_CONTENT } from './fixtures/placementPage'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))
vi.mock('@/model/globals/forgeGlobal', () => ({ openModal: vi.fn(), default: {} }))

const events = (name: string) => vi.mocked(trackAnalyticsEvent).mock.calls.filter(([n]) => n === name)
const para = (value: string) => ({ type: 'paragraph', content: [{ type: 'text', text: value }] })
const ok = (content: unknown[]) => async () => ({ status: 'ok' as const, title: 'Design', version: 7, content })

async function mountPicker(props: Record<string, unknown> = {}) {
  const onChoose = vi.fn()
  const onDismiss = vi.fn()
  const wrapper = mount(PlacementPicker, {
    props: {
      pageId: 'page-1',
      diagram: { id: 'cc-2', title: 'Checkout flow', diagramType: 'sequence' },
      surface: 'byline',
      onChoose,
      onDismiss,
      loadPage: ok([para('First'), para('Second')]),
      ...props,
    } as any,
  })
  await flushPromises()
  return { wrapper, onChoose, onDismiss }
}

describe('PlacementPicker', () => {
  enableAutoUnmount(afterEach)
  beforeEach(() => vi.clearAllMocks())

  it('offers a gap around every top-level block, preselecting the end', async () => {
    const { wrapper } = await mountPicker()
    const gaps = wrapper.findAll('[data-testid="placement-gap"]')

    expect(gaps).toHaveLength(3)
    expect(gaps[2].attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-testid="placement-where"]').text()).toBe('At the end of the page')
    expect(events('placement_picker_opened')[0][1]).toMatchObject({
      result: 'loaded',
      surface: 'byline',
      placement_block_count: 2,
    })
  })

  it('closes with the spot the user chose', async () => {
    const { wrapper, onChoose } = await mountPicker()

    await wrapper.findAll('[data-testid="placement-gap"]')[1].trigger('click')
    expect(wrapper.get('[data-testid="placement-where"]').text()).toBe('After "First"')
    await wrapper.get('[data-testid="placement-confirm"]').trigger('click')

    expect(onChoose).toHaveBeenCalledWith(
      expect.objectContaining({
        position: 'middle',
        blockCount: 2,
        defaultKept: false,
        placement: expect.objectContaining({ index: 1, version: 7 }),
      }),
    )
    expect(events('placement_picker_dismissed')).toHaveLength(0)
  })

  it('reports keeping the default, which says the picker was an extra click', async () => {
    const { wrapper, onChoose } = await mountPicker()
    await wrapper.get('[data-testid="placement-confirm"]').trigger('click')
    expect(onChoose.mock.calls[0][0]).toMatchObject({ position: 'end', defaultKept: true })
  })

  it('reports the dismissal once, however the modal goes away', async () => {
    const { wrapper, onDismiss } = await mountPicker()

    await wrapper.get('[data-testid="placement-cancel"]').trigger('click')
    window.dispatchEvent(new Event('pagehide'))

    expect(onDismiss).toHaveBeenCalled()
    expect(events('placement_picker_dismissed')).toHaveLength(1)
  })

  it('counts the modal X as a dismissal, which only pagehide can see', async () => {
    await mountPicker()
    window.dispatchEvent(new Event('pagehide'))
    expect(events('placement_picker_dismissed')).toHaveLength(1)
  })

  it('offers one spot on an empty page', async () => {
    const { wrapper } = await mountPicker({ loadPage: ok([]) })
    expect(wrapper.findAll('[data-testid="placement-gap"]')).toHaveLength(1)
  })

  it('offers a retry when the page could not be read, and no Add', async () => {
    const loadPage = vi.fn(async () => ({ status: 'failed' as const }))
    const { wrapper } = await mountPicker({ loadPage })

    expect(wrapper.find('[data-testid="placement-confirm"]').exists()).toBe(false)
    expect(events('placement_picker_opened')[0][1]).toMatchObject({ result: 'load_failed' })

    loadPage.mockImplementation(ok([para('Back')]) as any)
    await wrapper.get('[data-testid="placement-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="placement-confirm"]').exists()).toBe(true)
  })

  it('does not offer a retry for a refusal, which would only refuse again', async () => {
    const { wrapper } = await mountPicker({ loadPage: async () => ({ status: 'forbidden' as const }) })
    expect(wrapper.find('[data-testid="placement-retry"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('permission')
  })

  it('draws every fixture node type without crashing', async () => {
    const { wrapper } = await mountPicker({ loadPage: ok(PLACEMENT_PAGE_CONTENT) })
    const text = wrapper.text()

    expect(text).toContain('Overview')
    expect(text).toContain('authorises')
    expect(text).toContain('/capture')
    expect(text).toContain('Macro: Sequence diagram')
    expect(text).toContain('Image or file')
    expect(wrapper.get('pre').text()).toContain('"status"')
    expect(wrapper.get('pre').element.textContent).toContain('\n')
  })

  it('treats Escape as Cancel', async () => {
    const { onChoose, onDismiss } = await mountPicker()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(onDismiss).not.toHaveBeenCalled()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onChoose).not.toHaveBeenCalled()
    expect(events('placement_picker_dismissed')).toHaveLength(1)
  })

  it('calls our own macros diagrams, since their ADF carries no title', async () => {
    const stored = {
      type: 'extension',
      attrs: {
        extensionKey: 'app-id/env-id/static/zenuml-sequence-macro-lite',
        parameters: { guestParams: { customContentId: '1' } },
      },
    }
    const { wrapper } = await mountPicker({ loadPage: ok([stored, para('Next')]) })

    expect(wrapper.get('.adf-card').text()).toBe('Diagram')
    await wrapper.findAll('[data-testid="placement-gap"]')[1].trigger('click')
    expect(wrapper.get('[data-testid="placement-where"]').text()).toBe('After the diagram')
  })

  it('draws page content as text, never as markup', async () => {
    const { wrapper } = await mountPicker({ loadPage: ok([para('<img src=x onerror=alert(1)>')]) })
    expect(wrapper.find('img[src="x"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
  })

  it('survives node types it has never seen', async () => {
    const { wrapper } = await mountPicker({
      loadPage: ok([{ type: 'somethingNew' }, null, { type: 'paragraph' }]),
    })
    expect(wrapper.findAll('[data-testid="placement-gap"]')).toHaveLength(4)
    expect(wrapper.text()).toContain('Page content')
  })
})
