import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ViewSourcePanel from '@/components/Viewer/ViewSourcePanel.vue'

describe('ViewSourcePanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders nothing when not visible', () => {
    const wrapper = mount(ViewSourcePanel, {
      props: { visible: false, source: 'A->B: hi', dslLabel: 'ZenUML' },
    })
    expect(wrapper.find('[data-testid="view-source-panel"]').exists()).toBe(false)
  })

  it('shows header with DSL label, source text, and line caption', () => {
    // Trailing newline is preserved in the prop / clipboard path; DOM .text()
    // trims a lone trailing newline, so assert content without relying on it.
    const source = 'A->B: hi\nB->C: ok\n'
    const wrapper = mount(ViewSourcePanel, {
      props: { visible: true, source, dslLabel: 'Mermaid' },
    })
    expect(wrapper.find('[data-testid="view-source-panel"]').exists()).toBe(true)
    expect(wrapper.find('#view-source-panel-title').text()).toBe('Diagram source · Mermaid')
    expect(wrapper.find('[data-testid="view-source-code"]').text()).toBe('A->B: hi\nB->C: ok')
    expect(wrapper.find('[data-testid="view-source-meta"]').text()).toBe('2 lines · read-only')
  })

  it('uses singular "line" for a single-line source', () => {
    const wrapper = mount(ViewSourcePanel, {
      props: { visible: true, source: 'Alice->Bob: hi', dslLabel: 'ZenUML' },
    })
    expect(wrapper.find('[data-testid="view-source-meta"]').text()).toBe('1 line · read-only')
  })

  it('does not use fullscreen sizing by default', () => {
    const wrapper = mount(ViewSourcePanel, {
      props: { visible: true, source: 'x', dslLabel: 'ZenUML' },
    })
    expect(wrapper.find('[data-testid="view-source-panel"]').classes()).not.toContain('view-source-panel--fullscreen')
  })

  it('applies fullscreen sizing class when fullscreen prop is true', () => {
    const wrapper = mount(ViewSourcePanel, {
      props: { visible: true, source: 'x', dslLabel: 'ZenUML', fullscreen: true },
    })
    expect(wrapper.find('[data-testid="view-source-panel"]').classes()).toContain('view-source-panel--fullscreen')
  })

  it('emits close when the X button is clicked', async () => {
    const wrapper = mount(ViewSourcePanel, {
      props: { visible: true, source: 'x', dslLabel: 'PlantUML' },
    })
    await wrapper.find('[data-testid="view-source-close"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('copies source to the clipboard and emits copy with brief Copied feedback', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    })

    const source = 'sequenceDiagram\n  A->>B: hi'
    const wrapper = mount(ViewSourcePanel, {
      props: { visible: true, source, dslLabel: 'Mermaid' },
    })
    const copyBtn = wrapper.find('[data-testid="view-source-copy"]')
    expect(copyBtn.text()).toBe('Copy')

    await copyBtn.trigger('click')
    await wrapper.vm.$nextTick()
    // flush the clipboard promise
    await Promise.resolve()
    await wrapper.vm.$nextTick()

    expect(writeText).toHaveBeenCalledWith(source)
    expect(wrapper.emitted('copy')).toHaveLength(1)
    expect(copyBtn.text()).toBe('Copied')

    vi.advanceTimersByTime(1500)
    await wrapper.vm.$nextTick()
    expect(copyBtn.text()).toBe('Copy')
  })
})
