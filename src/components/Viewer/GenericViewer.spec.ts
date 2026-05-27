import { mount } from '@vue/test-utils'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import GenericViewer from '@/components/Viewer/GenericViewer.vue'
import store from '@/model/store2'
import { DiagramType, DataSource } from '@/model/Diagram/Diagram'
import EventBus from '@/EventBus'

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      canUserEdit: vi.fn(() => Promise.resolve(true)),
      isDisplayMode: vi.fn(() => true),
      _getCurrentUser: vi.fn(() => Promise.resolve({ atlassianAccountId: 'test-user-id' })),
      getCurrentSpace: vi.fn(() => Promise.resolve({ key: 'TEST' })),
      getAndPrintContentVersions: vi.fn(() => Promise.resolve([])),
    }
  }
}))

vi.mock('@forge/bridge', () => ({
  requestConfluence: vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ _links: { base: 'https://example.atlassian.net/wiki', webui: '/spaces/TEST/pages/123' } })
  })),
  // copyLink uses a dynamic import; vitest still routes that through this mock factory.
}))

vi.mock('@/utils/window', () => ({
  trackEvent: vi.fn(),
  getUrlParam: vi.fn(),
}))

vi.mock('@/utils/toast', () => ({
  toast: vi.fn(),
}))

const mountViewer = () => mount(GenericViewer, { global: { plugins: [store] } })

describe('GenericViewer (chrome-less)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.commit('updateDiagramType', DiagramType.Sequence)
    store.state.diagram.source = DataSource.CustomContent
    store.state.diagram.isCopy = false
    store.state.diagram.title = 'Login flow'
    store.state.diagram.id = 'content-123'
  })

  describe('layout', () => {
    it('renders the viewer frame with the title and the slot content', () => {
      const wrapper = mount(GenericViewer, {
        global: { plugins: [store] },
        slots: { default: '<div class="diagram-stub">slot</div>' },
      })
      expect(wrapper.find('.viewer-frame').exists()).toBe(true)
      expect(wrapper.find('.viewer-title').text()).toBe('Login flow')
      expect(wrapper.find('.diagram-stub').exists()).toBe(true)
      expect(wrapper.find('.screen-capture-content').exists()).toBe(true)
    })

    it('falls back to a default title when the diagram has no title', () => {
      store.state.diagram.title = ''
      const wrapper = mountViewer()
      expect(wrapper.find('.viewer-title').text()).toBe('Untitled diagram')
    })

    it('reveals top + bottom edges on mouseenter and hides on mouseleave', async () => {
      const wrapper = mountViewer()
      const surface = wrapper.find('.viewer-surface')
      expect(surface.classes()).not.toContain('viewer-surface--hover')

      await surface.trigger('mouseenter')
      expect(surface.classes()).toContain('viewer-surface--hover')

      await surface.trigger('mouseleave')
      expect(surface.classes()).not.toContain('viewer-surface--hover')
    })

    it('skips the viewer chrome when hideHeader is true', () => {
      const wrapper = mount(GenericViewer, {
        global: { plugins: [store] },
        props: { hideHeader: true },
        slots: { default: '<div class="diagram-stub" />' },
      })
      expect(wrapper.find('.viewer-frame').exists()).toBe(false)
      expect(wrapper.find('.screen-capture-content').exists()).toBe(true)
      expect(wrapper.find('.diagram-stub').exists()).toBe(true)
    })
  })

  describe('top-edge actions', () => {
    it('emits edit on the EventBus when Edit is clicked', async () => {
      const spy = vi.spyOn(EventBus, '$emit')
      const wrapper = mountViewer()
      await wrapper.vm.$nextTick()
      await wrapper.find('button[aria-label="Edit"]').trigger('click')
      expect(spy).toHaveBeenCalledWith('edit')
    })

    it('emits fullscreen on the EventBus when Fullscreen is clicked', async () => {
      const spy = vi.spyOn(EventBus, '$emit')
      const wrapper = mountViewer()
      await wrapper.find('button[aria-label="Fullscreen"]').trigger('click')
      expect(spy).toHaveBeenCalledWith('fullscreen')
    })
  })

  // ZEN-1170 Defect 2b: when the diagram was loaded via orphan-sibling
  // recovery, the in-viewer Edit button must steer the user to Confluence's
  // page editor (where the macro-config surface can actually persist a
  // customContentId repair via view.submit({config})). Our modal-launched
  // edit flow would silently create orphan CCs on save.
  describe('recovered-from-orphan edit gating', () => {
    it('disables the Edit button with a recovery-specific tooltip when diagram.recoveredFromOrphan is true', async () => {
      store.state.diagram.recoveredFromOrphan = true
      const wrapper = mountViewer()
      await wrapper.vm.$nextTick()
      const editBtn = wrapper.find('button[aria-label="Edit"]')
      expect(editBtn.exists()).toBe(true)
      expect(editBtn.attributes('disabled')).toBeDefined()
      const tooltip = editBtn.attributes('title') || ''
      expect(tooltip).toContain('recovered from a backup')
      expect(tooltip).toContain('Edit on the page')
    })

    it('leaves the Edit button enabled when recoveredFromOrphan is not set', async () => {
      store.state.diagram.recoveredFromOrphan = false
      const wrapper = mountViewer()
      await wrapper.vm.$nextTick()
      const editBtn = wrapper.find('button[aria-label="Edit"]')
      expect(editBtn.attributes('disabled')).toBeUndefined()
    })

    // Visible affordance (not just disabled-button tooltip): the recovery
    // chip and banner must render so touch / keyboard users discover the
    // repair path without hovering a disabled button. Variant A treatment:
    // a neutral READ-ONLY chip + a thin info-style status row.
    it('renders a visible READ-ONLY chip and explanatory banner when recoveredFromOrphan is true', async () => {
      store.state.diagram.recoveredFromOrphan = true
      const wrapper = mountViewer()
      await wrapper.vm.$nextTick()
      const chip = wrapper.find('.viewer-recovered-chip')
      expect(chip.exists()).toBe(true)
      expect(chip.text()).toBe('READ-ONLY')
      expect(chip.attributes('tabindex')).toBe('0')
      const banner = wrapper.find('[data-testid="recovered-banner"]')
      expect(banner.exists()).toBe(true)
      expect(banner.text()).toContain('Recovered from backup')
      expect(banner.text()).toContain('page editor')
    })

    it('does not render the recovered chip or banner when recoveredFromOrphan is not set', async () => {
      store.state.diagram.recoveredFromOrphan = false
      const wrapper = mountViewer()
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.viewer-recovered-chip').exists()).toBe(false)
      expect(wrapper.find('[data-testid="recovered-banner"]').exists()).toBe(false)
    })
  })

  describe('bottom-edge pill actions', () => {
    it('shows the five expected actions for a custom-content diagram', () => {
      const wrapper = mountViewer()
      const labels = wrapper.findAll('[role="toolbar"][aria-label="Diagram actions"] button')
        .map(b => b.attributes('aria-label'))
      expect(labels).toEqual(['Copy code', 'Export PNG', 'Versions', 'Copy link', 'More'])
    })

    it('hides the Versions button when the diagram is not custom content', () => {
      store.state.diagram.source = DataSource.MacroBody
      const wrapper = mountViewer()
      const labels = wrapper.findAll('[role="toolbar"][aria-label="Diagram actions"] button')
        .map(b => b.attributes('aria-label'))
      expect(labels).toEqual(['Copy code', 'Export PNG', 'Copy link', 'More'])
    })

    it('opens the export modal when Export PNG is clicked', async () => {
      const wrapper = mountViewer()
      const vm = wrapper.vm as any
      expect(vm.showExportModal).toBe(false)
      await wrapper.find('button[aria-label="Export PNG"]').trigger('click')
      expect(vm.showExportModal).toBe(true)
    })

    // The bottom pill is absolutely positioned over the canvas bottom and
    // appears on hover. In the load-failed empty state the Retry button sits
    // at the bottom of the same flex column, so the pill would cover it.
    // None of the pill's actions (copy code, export PNG, versions, copy link)
    // make sense without a loaded diagram, so we hide the pill entirely.
    it('does not render the bottom-edge pill in the load-failed state', () => {
      store.commit('updateDiagramType', DiagramType.Unknown)
      const wrapper = mountViewer()
      expect(wrapper.find('[role="toolbar"][aria-label="Diagram actions"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="load-failed-generic"] .viewer-load-failed-btn').exists()).toBe(true)
    })
  })

  describe('load-failed support link', () => {
    it('renders the Contact support link in the generic load-failed state', () => {
      store.commit('updateDiagramType', DiagramType.Unknown)
      const wrapper = mountViewer()
      expect(wrapper.find('[data-testid="load-failed-support-link"]').exists()).toBe(true)
    })

    it('does not render the support link in the permission (403) state', () => {
      store.commit('updateDiagramType', DiagramType.Unknown)
      store.state.loadError = { httpStatus: 403 }
      const wrapper = mountViewer()
      expect(wrapper.find('[data-testid="load-failed-permission"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="load-failed-support-link"]').exists()).toBe(false)
    })

    it('clicking copies diagnostic info, tracks the event, then opens the support portal after a delay', async () => {
      const openUrlMod = await import('@/model/globals/forgeGlobal')
      const windowMod = await import('@/utils/window')
      const openUrlSpy = vi.spyOn(openUrlMod, 'openUrl').mockImplementation(() => Promise.resolve())
      const trackSpy = vi.spyOn(windowMod, 'trackEvent')
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })

      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        store.state.loadError = null
        store.commit('updateDiagramType', DiagramType.Unknown)
        const wrapper = mountViewer()
        await wrapper.find('[data-testid="load-failed-support-link"]').trigger('click')
        // Synchronous part: clipboard + toast + tracking happen before the delay.
        await vi.advanceTimersByTimeAsync(0)
        expect(writeText).toHaveBeenCalledOnce()
        const payload = writeText.mock.calls[0][0] as string
        expect(payload).toContain('Diagram failed to load')
        expect(payload).toContain('Content ID:')
        expect(trackSpy).toHaveBeenCalledWith(
          'support_link_clicked',
          'click',
          'load_failed_generic',
          expect.objectContaining({ content_id: expect.any(String) }),
        )
        // openUrl must NOT fire immediately — we hold focus so the toast is readable.
        expect(openUrlSpy).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(1500)
        expect(openUrlSpy).toHaveBeenCalledWith('https://zenuml.atlassian.net/servicedesk')
      } finally {
        vi.useRealTimers()
      }
    })
  })

})
