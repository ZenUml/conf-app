import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FeedbackHost from './FeedbackHost.vue'
import feedbackHostSource from './FeedbackHost.vue?raw'
import type { FeedbackContext } from './feedbackSession'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))

const context: FeedbackContext = {
  surface: 'viewer', hostModule: 'zenuml-macro', diagramType: 'mermaid', diagramTitle: 'Example',
  userAccountId: 'account-example', clientDomain: 'example-tenant', spaceName: 'Example space',
  macroUuid: 'macro-example', contentId: 'content-example', customContentId: 'custom-content-example',
}
const wrappers: ReturnType<typeof mount>[] = []
function show(options: Parameters<typeof mount>[1]) {
  const wrapper = mount(FeedbackHost, options)
  wrappers.push(wrapper)
  return wrapper
}

describe('FeedbackHost', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.useRealTimers()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
  })
  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps an icon trigger visible and expands it on edge hover or keyboard focus', async () => {
    const wrapper = show({ props: { context, openViewModal: vi.fn() } })
    const trigger = wrapper.get('[data-testid="feedback-trigger"]')
    expect(trigger.classes()).toContain('edge-trigger')
    expect(trigger.get('svg path').attributes('d')).toContain('M8.625 12')
    expect(wrapper.get('[data-testid="feedback-edge"]').classes()).not.toContain('revealed')
    expect(trigger.attributes('aria-label')).toBe('Send feedback')
    await trigger.trigger('focusin')
    expect(wrapper.get('[data-testid="feedback-edge"]').classes()).toContain('revealed')
  })

  // jsdom has no layout or hit-testing and does not apply scoped SFC styles, so the hit-area
  // contract is asserted on the component source, the same way ConnectPanel.spec.ts does.
  it('limits the edge hit area to the visible trigger so clicks beside it reach the UI underneath', () => {
    const edgeRule = feedbackHostSource.match(/\.feedback-edge\s*\{([^}]*)\}/)?.[1] ?? ''
    const triggerRule = feedbackHostSource.match(/\.edge-trigger\s*\{([^}]*)\}/)?.[1] ?? ''

    // The fixed container must shrink to the collapsed 32px tab. A fixed container width keeps a
    // transparent strip beside the tab that still takes pointer events and reveals the wide tab.
    expect(triggerRule).toMatch(/(^|[;\s])width\s*:\s*32px/)
    expect(edgeRule).toMatch(/position\s*:\s*fixed/)
    expect(edgeRule).not.toMatch(/(^|[;\s])width\s*:/)
  })

  it('nudges open only once from 600ms until 2400ms', async () => {
    vi.useFakeTimers()
    const wrapper = show({ props: { context, openViewModal: vi.fn() } })
    const edge = wrapper.get('[data-testid="feedback-edge"]')
    expect(edge.classes()).not.toContain('nudging')

    await vi.advanceTimersByTimeAsync(600)
    expect(edge.classes()).toContain('nudging')
    await vi.advanceTimersByTimeAsync(1800)
    expect(edge.classes()).not.toContain('nudging')

    wrapper.unmount()
    const second = show({ props: { context, openViewModal: vi.fn() } })
    await vi.advanceTimersByTimeAsync(600)
    expect(second.get('[data-testid="feedback-edge"]').classes()).not.toContain('nudging')
  })

  it('does not nudge for reduced-motion users', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    const wrapper = show({ props: { context, openViewModal: vi.fn() } })
    await vi.advanceTimersByTimeAsync(2400)
    expect(wrapper.get('[data-testid="feedback-edge"]').classes()).not.toContain('nudging')
  })

  it('opens View feedback through the Forge modal boundary', async () => {
    const openViewModal = vi.fn().mockResolvedValue(undefined)
    const wrapper = show({ props: { context, openViewModal } })
    await wrapper.get('[data-testid="feedback-trigger"]').trigger('click')
    expect(openViewModal).toHaveBeenCalledWith(expect.objectContaining({
      size: 'medium',
      context: expect.objectContaining({ macroMode: 'feedback', feedbackContext: context }),
    }))
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('starts feedback replay from the surface trigger with its macro context', async () => {
    const wrapper = show({
      props: { context, openViewModal: vi.fn().mockResolvedValue(undefined) },
    })

    await wrapper.get('[data-testid="feedback-trigger"]').trigger('click')

    expect(trackAnalyticsEvent).toHaveBeenCalledOnce()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('feedback_report_opened', {
      feature_area: 'feedback',
      surface: 'viewer',
      host_module: 'zenuml-macro',
      macro_type: 'mermaid',
      macro_uuid: 'macro-example',
    })
  })

  it('tracks one feedback opening when an inline dialog mounts after the trigger click', async () => {
    const wrapper = show({
      props: { context: { ...context, surface: 'editor' } },
    })

    await wrapper.get('[data-testid="feedback-trigger"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="dialog"]').exists()).toBe(true)
    expect(trackAnalyticsEvent).toHaveBeenCalledTimes(1)
  })

  it('hides the default surface trigger while PNG Export provides its own trigger', async () => {
    const wrapper = show({
      props: { context, openViewModal: vi.fn() },
      attachTo: document.body,
    })
    const exportBackdrop = document.createElement('div')
    exportBackdrop.className = 'export-modal-backdrop'
    document.body.appendChild(exportBackdrop)

    await flushPromises()

    expect(wrapper.find('[data-testid="feedback-edge"]').exists()).toBe(false)
    wrapper.unmount()
    exportBackdrop.remove()
  })
})
