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

describe('GenericViewer (V8 chrome-less)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.commit('updateDiagramType', DiagramType.Sequence)
    store.state.diagram.source = DataSource.CustomContent
    store.state.diagram.isCopy = false
    store.state.diagram.title = 'Login flow'
    store.state.diagram.id = 'content-123'
  })

  describe('layout', () => {
    it('renders the V8 frame with the title and the slot content', () => {
      const wrapper = mount(GenericViewer, {
        global: { plugins: [store] },
        slots: { default: '<div class="diagram-stub">slot</div>' },
      })
      expect(wrapper.find('.v8-frame').exists()).toBe(true)
      expect(wrapper.find('.v8-title').text()).toBe('Login flow')
      expect(wrapper.find('.diagram-stub').exists()).toBe(true)
      expect(wrapper.find('.screen-capture-content').exists()).toBe(true)
    })

    it('falls back to a default title when the diagram has no title', () => {
      store.state.diagram.title = ''
      const wrapper = mountViewer()
      expect(wrapper.find('.v8-title').text()).toBe('Untitled diagram')
    })

    it('reveals top + bottom edges on mouseenter and hides on mouseleave', async () => {
      const wrapper = mountViewer()
      const surface = wrapper.find('.v8-surface')
      expect(surface.classes()).not.toContain('v8-surface--hover')

      await surface.trigger('mouseenter')
      expect(surface.classes()).toContain('v8-surface--hover')

      await surface.trigger('mouseleave')
      expect(surface.classes()).not.toContain('v8-surface--hover')
    })

    it('skips the V8 chrome when hideHeader is true', () => {
      const wrapper = mount(GenericViewer, {
        global: { plugins: [store] },
        props: { hideHeader: true },
        slots: { default: '<div class="diagram-stub" />' },
      })
      expect(wrapper.find('.v8-frame').exists()).toBe(false)
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

  describe('bottom-edge pill actions', () => {
    it('shows the four expected actions for a custom-content diagram', () => {
      const wrapper = mountViewer()
      const labels = wrapper.findAll('.v8-edge-bottom-pill .v8-pill-btn')
        .map(b => b.attributes('aria-label'))
      expect(labels).toEqual(['Copy code', 'Export PNG', 'Versions', 'Copy link'])
    })

    it('hides the Versions button when the diagram is not custom content', () => {
      store.state.diagram.source = DataSource.MacroBody
      const wrapper = mountViewer()
      const labels = wrapper.findAll('.v8-edge-bottom-pill .v8-pill-btn')
        .map(b => b.attributes('aria-label'))
      expect(labels).toEqual(['Copy code', 'Export PNG', 'Copy link'])
    })

    it('opens the export modal when Export PNG is clicked', async () => {
      const wrapper = mountViewer()
      const vm = wrapper.vm as any
      expect(vm.showExportModal).toBe(false)
      await wrapper.find('button[aria-label="Export PNG"]').trigger('click')
      expect(vm.showExportModal).toBe(true)
    })
  })

})
