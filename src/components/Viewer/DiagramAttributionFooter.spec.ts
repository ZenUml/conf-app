import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DiagramAttributionFooter from './DiagramAttributionFooter.vue'
import { registerDiagramImpactView } from '@/services/DiagramImpact'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

const impact = { audienceCount: 0 }

vi.mock('@/utils/requestUtil', () => ({
  forgeRequest: vi.fn(async () => ({ displayName: 'Peng' })),
}))

vi.mock('@/services/DiagramImpact', () => ({
  getDiagramImpact: vi.fn(async () => ({
    audienceCount: impact.audienceCount,
    viewerRelation: 'viewer',
  })),
  registerDiagramImpactView: vi.fn(),
}))

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}))

// Stub IntersectionObserver: jsdom has none, and the component skips the
// observer entirely when `typeof IntersectionObserver === 'undefined'` (see
// the view-count tests below, which rely on exactly that skip). The dwell
// tests need a real callback to drive, so they install this stub themselves.
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  callback: (entries: Array<Pick<IntersectionObserverEntry, 'isIntersecting' | 'intersectionRect' | 'boundingClientRect'>>) => void
  observedElement: Element | null = null
  constructor(callback: FakeIntersectionObserver['callback']) {
    this.callback = callback
    FakeIntersectionObserver.instances.push(this)
  }
  observe(element: Element) { this.observedElement = element }
  unobserve() {}
  disconnect() {}
}

function dwellEntry(overrides: Partial<{ isIntersecting: boolean; intersectionHeight: number; boundingHeight: number }> = {}) {
  const { isIntersecting = true, intersectionHeight = 300, boundingHeight = 300 } = overrides
  return {
    isIntersecting,
    intersectionRect: { height: intersectionHeight } as DOMRectReadOnly,
    boundingClientRect: { height: boundingHeight } as DOMRectReadOnly,
  }
}

function mountFooter(props: Partial<{ ready: boolean; diagramHost: () => HTMLElement | null }> = {}) {
  return mount(DiagramAttributionFooter, {
    props: {
      attribution: { customContentId: 'content-1', createdByAccountId: 'account-1' },
      macroType: 'sequence',
      ready: false,
      ...props,
    },
  })
}

async function renderFooter() {
  const wrapper = mount(DiagramAttributionFooter, {
    props: {
      attribution: { customContentId: 'content-1', createdByAccountId: 'account-1' },
      macroType: 'sequence',
      ready: false,
    },
  })
  await flushPromises()
  return wrapper
}

describe('DiagramAttributionFooter view count', () => {
  beforeEach(() => {
    impact.audienceCount = 0
  })

  it('hides the view metric when nobody else has viewed the diagram', async () => {
    const wrapper = await renderFooter()

    expect(wrapper.text()).toBe('Created by Peng')
  })

  it('shows one qualifying viewer as a neutral view count', async () => {
    impact.audienceCount = 1

    const wrapper = await renderFooter()

    expect(wrapper.text().replace(/\s+/g, ' ').trim()).toBe('Created by Peng · 1 view')
  })

  it('shows the exact plural view count', async () => {
    impact.audienceCount = 5

    const wrapper = await renderFooter()

    expect(wrapper.text().replace(/\s+/g, ' ').trim()).toBe('Created by Peng · 5 views')
  })
})

describe('DiagramAttributionFooter viewport dwell gate', () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = []
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    vi.mocked(registerDiagramImpactView).mockReset()
    vi.mocked(trackAnalyticsEvent).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('observes the diagramHost element when the prop is given', async () => {
    const diagramEl = document.createElement('div')
    mountFooter({ diagramHost: () => diagramEl })
    await flushPromises()

    expect(FakeIntersectionObserver.instances).toHaveLength(1)
    expect(FakeIntersectionObserver.instances[0].observedElement).toBe(diagramEl)
  })

  it('falls back to observing the footer element when diagramHost is absent', async () => {
    const wrapper = mountFooter()
    await flushPromises()

    expect(FakeIntersectionObserver.instances).toHaveLength(1)
    expect(FakeIntersectionObserver.instances[0].observedElement).toBe(
      wrapper.find('[data-testid="diagram-attribution"]').element,
    )
  })

  it('does not register when ready flips true while the diagram is not intersecting (over-count regression)', async () => {
    // Against the old `refreshTimer(Boolean(root.value))` code this test FAILS:
    // root.value always exists once mounted, so the ready-watcher would arm the
    // 3s timer with no viewport check and registration would fire regardless
    // of `intersecting`.
    const wrapper = mountFooter({ ready: false })
    await flushPromises()

    const observer = FakeIntersectionObserver.instances[0]
    observer.callback([dwellEntry({ isIntersecting: false, intersectionHeight: 0, boundingHeight: 300 })])

    vi.useFakeTimers()
    await wrapper.setProps({ ready: true })
    await vi.advanceTimersByTimeAsync(3000)

    expect(registerDiagramImpactView).not.toHaveBeenCalled()
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith('diagram_audience_registration_succeeded', expect.anything())
  })

  it('registers after a 3s dwell once intersecting and ready, tagging was_intersecting true', async () => {
    vi.mocked(registerDiagramImpactView).mockResolvedValue({ audienceCount: 3, viewerRelation: 'viewer' } as any)
    mountFooter({ ready: true })
    await flushPromises()

    const observer = FakeIntersectionObserver.instances[0]
    vi.useFakeTimers()
    observer.callback([dwellEntry({ isIntersecting: true, intersectionHeight: 300, boundingHeight: 300 })])
    await vi.advanceTimersByTimeAsync(3000)

    expect(registerDiagramImpactView).toHaveBeenCalledWith('content-1')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'diagram_audience_registration_succeeded',
      expect.objectContaining({ was_intersecting: true }),
    )
  })

  it('clears the pending dwell timer when scrolling out of view before 3s elapses', async () => {
    mountFooter({ ready: true })
    await flushPromises()

    const observer = FakeIntersectionObserver.instances[0]
    vi.useFakeTimers()
    observer.callback([dwellEntry({ isIntersecting: true, intersectionHeight: 300, boundingHeight: 300 })])
    await vi.advanceTimersByTimeAsync(1500)
    observer.callback([dwellEntry({ isIntersecting: false, intersectionHeight: 0, boundingHeight: 300 })])
    await vi.advanceTimersByTimeAsync(3000)

    expect(registerDiagramImpactView).not.toHaveBeenCalled()
  })

  // `getCaptureNode()` returns `this.$refs.captureNode ?? null` and is null
  // while the load-failed panel is mounted, so the `?? root.value` fallback can
  // silently restore the 29px footer target the diagram target replaces. These
  // two cover the recovery and the reporting of that state.
  it('re-attaches to the diagram when the capture node appears only after ready flips', async () => {
    const diagram = document.createElement('div')
    let node: HTMLElement | null = null
    const wrapper = mountFooter({ ready: false, diagramHost: () => node })
    await flushPromises()

    expect(FakeIntersectionObserver.instances).toHaveLength(1)
    expect(FakeIntersectionObserver.instances[0].observedElement).not.toBe(diagram)

    node = diagram
    await wrapper.setProps({ ready: true })
    await flushPromises()

    expect(FakeIntersectionObserver.instances).toHaveLength(2)
    expect(FakeIntersectionObserver.instances[1].observedElement).toBe(diagram)
  })

  it('reports gate_target footer when the diagram node never becomes available', async () => {
    const wrapper = mountFooter({ ready: false, diagramHost: () => null })
    await flushPromises()
    await wrapper.setProps({ ready: true })
    await flushPromises()

    const observer = FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1]
    vi.useFakeTimers()
    observer.callback([dwellEntry({ isIntersecting: true, intersectionHeight: 20, boundingHeight: 29 })])
    await vi.advanceTimersByTimeAsync(3000)

    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'diagram_audience_registration_succeeded',
      expect.objectContaining({ gate_target: 'footer' }),
    )
  })

  it('reports gate_target diagram when the diagram node is available at mount', async () => {
    const diagram = document.createElement('div')
    mountFooter({ ready: true, diagramHost: () => diagram })
    await flushPromises()

    const observer = FakeIntersectionObserver.instances[0]
    expect(observer.observedElement).toBe(diagram)
    vi.useFakeTimers()
    observer.callback([dwellEntry({ isIntersecting: true, intersectionHeight: 300, boundingHeight: 3000 })])
    await vi.advanceTimersByTimeAsync(3000)

    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'diagram_audience_registration_succeeded',
      expect.objectContaining({ gate_target: 'diagram' }),
    )
  })
})
