// Component-level verification of the AI auto-title feature on the Graph
// (DrawIO) macro — the integration the pure unit specs (useAutoTitle,
// extractGraphText) don't cover: currentXml → extractGraphText → useAutoTitle →
// DrawIoHeader UI + the window.ensureTitle publish-path.
//
// Runs in the vitest/jsdom harness without a Forge site. Drives the real
// DrawIoExtension + DrawIoHeader components; only the /ai-generate-title
// backend, toast and analytics are mocked at the boundary.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// Reactive store so the title computed (and the ensureTitle publish-gate, which
// reads currentTitle after generation) behave like the real Vuex store.
vi.mock('@/model/store2', async () => {
  const { reactive } = await import('vue')
  const state = reactive({ diagram: { title: '', id: undefined as string | undefined } })
  const dispatch = vi.fn((action: string, payload: any) => {
    if (action === 'updateTitle') state.diagram.title = (payload || '').trim()
  })
  return { default: { state, dispatch } }
})
vi.mock('@/apis/aiGenerateTitle', () => ({ default: vi.fn() }))
vi.mock('@/apis/aiTitleFeatureFlag', () => ({ resetFeatureFlagsForTests: vi.fn() }))
vi.mock('@/utils/toast', () => ({ toast: vi.fn() }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))

import DrawIoExtension from '@/components/DrawIoExtension/DrawIoExtension.vue'
import store from '@/model/store2'
import aiGenerateTitle from '@/apis/aiGenerateTitle'
import { useAutoTitle, TYPEWRITER_MS_PER_CHAR, SPARK_FADEOUT_MS } from '@/composables/useAutoTitle'

const SPARK = 'button[title="Generate title with AI"]'
const DISMISS = 'button[title="Dismiss suggested title"]'

const TITLE = 'Order Flow'
const okRes = (text: string) => ({ ok: true, text: async () => text }) as any

const EMPTY_GRAPH = `<mxfile><diagram><mxGraphModel><root>
  <mxCell id="0" /><mxCell id="1" parent="0" />
</root></mxGraphModel></diagram></mxfile>`

const LABELLED_XML = `<mxGraphModel><root>
  <mxCell id="0" />
  <mxCell id="2" value="Login" vertex="1" />
  <mxCell id="3" value="Validate" vertex="1" />
  <mxCell id="4" value="Dashboard" vertex="1" />
</root></mxGraphModel>`
const LABELLED_DSL = 'Login\nValidate\nDashboard'

const AWS_XML = `<mxGraphModel><root>
  <mxCell id="2" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.ec2;" vertex="1" />
  <mxCell id="3" style="resIcon=mxgraph.aws4.rds;" vertex="1" />
  <mxCell id="4" edge="1" source="2" target="3" />
</root></mxGraphModel>`
const AWS_DSL = 'Diagram shapes: ec2, rds. 1 connector.'

// Drive the whole generate() timeline: debounce (for the auto path) is advanced
// by the caller; here we flush the API microtask, the typewriter, and the spark
// fade-out.
async function runGeneration(title = TITLE) {
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(title.length * TYPEWRITER_MS_PER_CHAR + SPARK_FADEOUT_MS + 20)
  await flushPromises()
}

function mountGraphTitle(currentXml: string, editorMode: 'diagram' | 'board' = 'diagram') {
  return mount(DrawIoExtension, { props: { doc: {}, currentXml, editorMode } })
}

describe('Graph macro AI auto-title (DrawIoExtension + DrawIoHeader)', () => {
  beforeEach(() => {
    ;(useAutoTitle as any).__resetForTests()
    vi.mocked(store.dispatch as any).mockClear()
    ;(store as any).state.diagram.title = ''
    vi.mocked(aiGenerateTitle).mockReset().mockResolvedValue(okRes(TITLE))
    ;(window as any).graphXml = undefined
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('renders the AI spark button', async () => {
    const wrapper = mountGraphTitle(EMPTY_GRAPH)
    await flushPromises()
    expect(wrapper.find(SPARK).exists()).toBe(true)
  })

  it('keeps the title clear of DrawIO sketch Publish chrome in Board mode', async () => {
    const wrapper = mountGraphTitle(EMPTY_GRAPH, 'board')
    await flushPromises()
    const header = wrapper.find('[data-editor-mode="board"]')
    expect(header.exists()).toBe(true)
    expect(header.classes()).toContain('drawio-header--board')
  })

  it('reserves the complete Board action area instead of overlapping Publish', async () => {
    const wrapper = mountGraphTitle(EMPTY_GRAPH, 'board')
    await flushPromises()
    const header = wrapper.find('[data-editor-mode="board"]')
    const style = header.element.style

    // Sketch keeps its native Publish/Close group at the top-right. The
    // title overlay must end before that group; 164px is the measured native
    // action footprint (12px right inset + 152px action group) at the
    // Storybook/Confluence editor width.
    expect(Number.parseFloat(style.right)).toBeGreaterThanOrEqual(164)
    expect(header.element.querySelector('div')?.classList.contains('w-72')).toBe(true)
  })

  it('auto-generates a title from shape labels and commits it to the store', async () => {
    const wrapper = mountGraphTitle(LABELLED_XML)
    await flushPromises() // onMounted: schedule debounced auto-generate
    await vi.advanceTimersByTimeAsync(1500) // debounce elapses → generate('init')
    await runGeneration()

    // currentXml → extractGraphText → backend call with the labels + graph type.
    expect(aiGenerateTitle).toHaveBeenCalledWith({ dsl: LABELLED_DSL, type: 'flowchart' })
    // Generated title committed to the store (→ window.diagram.title for save).
    expect(store.dispatch).toHaveBeenCalledWith('updateTitle', TITLE)
    // Dismiss affordance appears, and the committed title shows in the box.
    expect(wrapper.find(DISMISS).exists()).toBe(true)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('input').element.value).toBe(TITLE)
  })

  it('types the generated title into the box during the animation', async () => {
    const wrapper = mountGraphTitle(LABELLED_XML)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1500) // debounce → generate; typewriter armed
    await vi.advanceTimersByTimeAsync(3 * TYPEWRITER_MS_PER_CHAR + 5) // ~3 chars typed
    await wrapper.vm.$nextTick()
    const partial = wrapper.find('input').element.value
    expect(partial.length).toBeGreaterThan(0)
    expect(partial.length).toBeLessThan(TITLE.length)
    expect(TITLE.startsWith(partial)).toBe(true)
    await runGeneration()
  })

  it('falls back to shape descriptors when the diagram has no labels', async () => {
    const wrapper = mountGraphTitle(AWS_XML)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1500)
    await runGeneration()
    expect(aiGenerateTitle).toHaveBeenCalledWith({ dsl: AWS_DSL, type: 'flowchart' })
    expect(store.dispatch).toHaveBeenCalledWith('updateTitle', TITLE)
    void wrapper
  })

  it('reverts the title to empty when the suggestion is dismissed', async () => {
    const wrapper = mountGraphTitle(LABELLED_XML)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1500)
    await runGeneration()
    vi.mocked(store.dispatch as any).mockClear()
    await wrapper.find(DISMISS).trigger('click')
    expect(store.dispatch).toHaveBeenCalledWith('updateTitle', '')
  })

  it('generates on the manual spark click', async () => {
    const wrapper = mountGraphTitle(EMPTY_GRAPH) // empty → no auto-generation
    await flushPromises()
    await wrapper.setProps({ currentXml: LABELLED_XML })
    await wrapper.find(SPARK).trigger('click') // generate('user') immediately
    await runGeneration()
    expect(aiGenerateTitle).toHaveBeenCalledWith({ dsl: LABELLED_DSL, type: 'flowchart' })
    expect(store.dispatch).toHaveBeenCalledWith('updateTitle', TITLE)
  })

  // The exact bug from the reported UI: publishing with an empty title now
  // generates on demand from the just-saved content instead of blocking.
  it('window.ensureTitle generates from the saved graph when the title is empty', async () => {
    const wrapper = mountGraphTitle(EMPTY_GRAPH)
    await flushPromises()
    ;(window as any).graphXml = LABELLED_XML // set by the save handler before ensureTitle
    const pending = (window as any).ensureTitle() as Promise<string>
    await runGeneration()
    const resolved = await pending
    expect(aiGenerateTitle).toHaveBeenCalledWith({ dsl: LABELLED_DSL, type: 'flowchart' })
    expect(store.dispatch).toHaveBeenCalledWith('updateTitle', TITLE)
    expect(resolved).toBe(TITLE)
    void wrapper
  })

  it('explains the missing title and focuses the empty input while Publish waits (#354)', async () => {
    const wrapper = mount(DrawIoExtension, { props: { doc: {}, currentXml: EMPTY_GRAPH }, attachTo: document.body })
    try {
      await flushPromises()
      const pending = (window as any).ensureTitle() as Promise<string>
      await wrapper.vm.$nextTick()

      const input = wrapper.find('input')
      expect(input.element.value).toBe('')
      expect(document.activeElement).toBe(input.element)
      expect(input.attributes('aria-invalid')).toBe('true')
      const message = wrapper.find('[role="alert"]')
      expect(message.text()).toBe('Enter a title, then press Enter or Publish.')
      expect(input.attributes('aria-describedby')).toBe(message.attributes('id'))

      await input.setValue('Order flow')
      await input.trigger('keydown.enter')
      await expect(pending).resolves.toBe('Order flow')
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    } finally {
      wrapper.unmount()
    }
  })

  it('does not release a pending Publish for a whitespace-only title', async () => {
    const wrapper = mountGraphTitle(EMPTY_GRAPH)
    try {
      await flushPromises()
      let title: string | undefined
      const pending = (window as any).ensureTitle().then((value: string) => { title = value })
      await wrapper.find('input').setValue('   ')
      await flushPromises()

      expect(title).toBeUndefined()
      expect(store.state.diagram.title).toBe('')
      await wrapper.find('input').setValue('  Order flow  ')
      await wrapper.find('input').trigger('keydown.enter')
      await pending
      expect(title).toBe('Order flow')
    } finally {
      wrapper.unmount()
    }
  })

  it('shows title guidance when AI title generation fails at Publish', async () => {
    vi.mocked(aiGenerateTitle).mockResolvedValue({ ok: false, text: async () => 'Unavailable' } as any)
    const wrapper = mountGraphTitle(EMPTY_GRAPH)
    try {
      await flushPromises()
      ;(window as any).graphXml = LABELLED_XML
      const pending = (window as any).ensureTitle() as Promise<string>
      await runGeneration()

      expect(wrapper.find('[role="alert"]').text()).toMatch(/enter a title.*publish/i)
      await wrapper.find('input').setValue('Manual title')
      await wrapper.find('input').trigger('keydown.enter')
      await expect(pending).resolves.toBe('Manual title')
    } finally {
      wrapper.unmount()
    }
  })
  it.each(['Enter', 'Publish'])('waits for %s after the complete manual title, including repeated empty Publish clicks', async confirm => {
    const wrapper = mountGraphTitle(EMPTY_GRAPH)
    try {
      await flushPromises()
      const saved = vi.fn()
      const first = window.ensureTitle().then(saved)
      const repeated = window.ensureTitle()
      const input = wrapper.find('input')
      await input.setValue('   ')
      await input.trigger('keydown.enter')
      await input.setValue('G')
      await flushPromises()
      expect(saved).not.toHaveBeenCalled()
      await input.setValue('   ')
      await input.trigger('keydown.enter')
      expect(wrapper.find('[role="alert"]').text()).toContain('press Enter or Publish')
      await input.setValue('Graph title complete')
      await flushPromises()
      expect(saved).not.toHaveBeenCalled()
      if (confirm === 'Enter') await input.trigger('keydown.enter')
      else await window.ensureTitle()
      await Promise.all([first, repeated])
      expect(saved).toHaveBeenCalledTimes(1)
      expect(saved).toHaveBeenCalledWith('Graph title complete')
    } finally { wrapper.unmount() }
  })

  it.each(['G', '   '])('does not publish or replace manual input %j when a cancelled AI request finishes', async typed => {
    let finish!: (response: any) => void
    vi.mocked(aiGenerateTitle).mockReturnValue(new Promise(resolve => { finish = resolve }))
    const wrapper = mountGraphTitle(EMPTY_GRAPH)
    try {
      await flushPromises()
      ;(window as any).graphXml = LABELLED_XML
      const saved = vi.fn()
      const pending = window.ensureTitle().then(saved)
      await wrapper.find('input').setValue(typed)
      finish(okRes(TITLE))
      await runGeneration()
      expect(saved).not.toHaveBeenCalled()
      expect(store.state.diagram.title).toBe(typed.trim())
      await wrapper.find('input').setValue('Graph manual title')
      await wrapper.find('input').trigger('keydown.enter')
      await pending
      expect(saved).toHaveBeenCalledTimes(1)
      expect(saved).toHaveBeenCalledWith('Graph manual title')
    } finally { wrapper.unmount() }
  })

  it('an already-running AI generation can complete a waiting Publish', async () => {
    const wrapper = mountGraphTitle(LABELLED_XML)
    try {
      await flushPromises()
      await vi.advanceTimersByTimeAsync(1500)
      const pending = window.ensureTitle()
      await runGeneration()
      await expect(pending).resolves.toBe(TITLE)
    } finally { wrapper.unmount() }
  })

})
