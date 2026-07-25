import { mount, flushPromises } from '@vue/test-utils'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import GenericViewer from '@/components/Viewer/GenericViewer.vue'
import store from '@/model/store2'
import { DiagramType, DataSource } from '@/model/Diagram/Diagram'
import EventBus from '@/EventBus'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { isAgentLinkEnabled } from '@/apis/aiTitleFeatureFlag'
import globals from '@/model/globals'
import forgeRuntime from '@/model/globals/forgeGlobal'
import { persistSession } from '@/composables/agentLink/sessionHandoff'
import ThinkingOverlay from '@/components/AgentLink/ThinkingOverlay.vue'
import ExportModal from '@/components/ExportModal/ExportModal.vue'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))

// Live Agent Link master flag defaults to resolved-false here so every
// EXISTING test in this file below exercises the flag-off ("renders exactly
// as today") path without opting in. Individual agent-link tests override
// this per-test with mockResolvedValueOnce(true).
vi.mock('@/apis/aiTitleFeatureFlag', () => ({
  isAgentLinkEnabled: vi.fn(() => Promise.resolve(false)),
}))

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
  view: {
    getContext: vi.fn(() => Promise.resolve({
      cloudId: 'cloud-1',
      environmentType: 'DEVELOPMENT',
      extension: {
        content: { id: 'page-123' },
        modal: { macroMode: 'fullscreen' },
      },
    })),
  },
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
    store.state.diagram.snapshotFallback = false
    store.state.diagram.snapshotAt = undefined
    store.state.diagram.recoveredFromOrphan = false
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

  // The fullscreen viewer modal mounts DiagramPortal with autoResize=false, so
  // GenericViewer's `wide` prop is false and the frame is `.viewer-frame--auto`
  // (width: fit-content). ONLY mermaid breaks there: its SVG is width:100% with no
  // intrinsic px, so in a shrink-to-fit parent it collapses to the CSS default 300px.
  // sequence (ZenUML, explicit px) and plantuml (explicit px) wrap correctly and stay
  // centered — forcing them wide would left-align them. So the fix is mermaid-scoped.
  describe('fullscreen width (mermaid-scoped)', () => {
    const setFullscreen = (on: boolean) => {
      ;(window as any).forgeGlobal = on
        ? { forgeContext: { extension: { modal: { macroMode: 'fullscreen' } } } }
        : undefined
    }
    afterEach(() => { delete (window as any).forgeGlobal })

    it('forces the frame full-width in fullscreen for MERMAID (the type that collapses)', () => {
      setFullscreen(true)
      store.commit('updateDiagramType', DiagramType.Mermaid)
      const wrapper = mount(GenericViewer, {
        global: { plugins: [store] },
        props: { wide: false },
        slots: { default: '<div class="diagram-stub" />' },
      })
      const frame = wrapper.find('.viewer-frame')
      expect(frame.classes()).toContain('viewer-frame--wide')
      expect(frame.classes()).not.toContain('viewer-frame--auto')
    })

    // Regression guard: sequence/plantuml don't collapse, so they must stay
    // fit-content (centered) in fullscreen — NOT forced wide (which left-aligns them).
    it('keeps SEQUENCE fit-content (auto) in fullscreen — must not be forced wide', () => {
      setFullscreen(true)
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mount(GenericViewer, {
        global: { plugins: [store] },
        props: { wide: false },
        slots: { default: '<div class="diagram-stub" />' },
      })
      const frame = wrapper.find('.viewer-frame')
      expect(frame.classes()).toContain('viewer-frame--auto')
      expect(frame.classes()).not.toContain('viewer-frame--wide')
    })

    it('keeps the frame fit-content (auto) on the inline page when not fullscreen and wide is false', () => {
      setFullscreen(false)
      store.commit('updateDiagramType', DiagramType.Mermaid)
      const wrapper = mount(GenericViewer, {
        global: { plugins: [store] },
        props: { wide: false },
        slots: { default: '<div class="diagram-stub" />' },
      })
      const frame = wrapper.find('.viewer-frame')
      expect(frame.classes()).toContain('viewer-frame--auto')
      expect(frame.classes()).not.toContain('viewer-frame--wide')
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

    it('fires fullscreen_opened Mixpanel event with macro_type when Fullscreen is clicked', async () => {
      store.commit('updateDiagramType', DiagramType.Mermaid)
      const wrapper = mountViewer()
      await wrapper.find('button[aria-label="Fullscreen"]').trigger('click')
      expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('fullscreen_opened', {
        feature_area: 'macro',
        surface: 'viewer',
        macro_type: 'mermaid',
        entry_point: 'page_view',
      })
    })
  })

  // #333 — View Source: read-only DSL panel for text-DSL types, available to
  // ALL viewers (including users without edit permission).
  describe('View Source (#333)', () => {
    const SOURCE_DSL = 'Alice->Bob: hello\nBob->Alice: hi'

    beforeEach(() => {
      store.state.diagram.code = SOURCE_DSL
      store.state.diagram.mermaidCode = 'sequenceDiagram\n  A->>B: hi'
      store.state.diagram.plantUmlCode = '@startuml\nA -> B\n@enduml'
    })

    it.each([
      [DiagramType.Sequence, 'ZenUML', SOURCE_DSL],
      [DiagramType.Mermaid, 'Mermaid', 'sequenceDiagram\n  A->>B: hi'],
      [DiagramType.PlantUml, 'PlantUML', '@startuml\nA -> B\n@enduml'],
    ] as const)(
      'shows Source for %s and opens a read-only panel with in-memory DSL',
      async (type, dslLabel, expectedSource) => {
        store.commit('updateDiagramType', type)
        const wrapper = mountViewer()
        await flushPromises()

        const btn = wrapper.find('[data-testid="view-source-btn"]')
        expect(btn.exists()).toBe(true)
        expect(btn.text()).toContain('Source')

        await btn.trigger('click')
        await wrapper.vm.$nextTick()

        const panel = wrapper.find('[data-testid="view-source-panel"]')
        expect(panel.exists()).toBe(true)
        expect(panel.find('#view-source-panel-title').text()).toBe(`Diagram source · ${dslLabel}`)
        expect(panel.find('[data-testid="view-source-code"]').text()).toBe(expectedSource)
        expect(panel.find('[data-testid="view-source-meta"]').text()).toMatch(/read-only/)
      },
    )

    it.each([
      DiagramType.Graph,
      DiagramType.OpenApi,
      DiagramType.AsyncApi,
      DiagramType.Embed,
    ])('hides Source for non-text-DSL type %s', async (type) => {
      store.commit('updateDiagramType', type)
      const wrapper = mountViewer()
      await flushPromises()
      expect(wrapper.find('[data-testid="view-source-btn"]').exists()).toBe(false)
    })

    it('shows Source when the user cannot edit (not gated on canUserEdit)', async () => {
      vi.mocked(globals.apWrapper.canUserEdit).mockResolvedValueOnce(false)
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mountViewer()
      await flushPromises()

      // Source must remain available even when canUserEdit resolves false.
      // (Edit visibility is separate and may still show under import.meta.env.DEV.)
      expect(wrapper.find('[data-testid="view-source-btn"]').exists()).toBe(true)
      expect((wrapper.vm as any).canUserEdit).toBe(false)

      await wrapper.find('[data-testid="view-source-btn"]').trigger('click')
      expect(wrapper.find('[data-testid="view-source-panel"]').exists()).toBe(true)
    })

    it('fires viewer_source_opened with macro_type, surface viewer, and has_edit_permission', async () => {
      store.commit('updateDiagramType', DiagramType.Mermaid)
      const wrapper = mountViewer()
      await flushPromises()

      await wrapper.find('[data-testid="view-source-btn"]').trigger('click')
      expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('viewer_source_opened', {
        feature_area: 'macro',
        surface: 'viewer',
        macro_type: DiagramType.Mermaid,
        has_edit_permission: true,
      })
    })

    it('fires viewer_source_opened with has_edit_permission false for read-only viewers', async () => {
      vi.mocked(globals.apWrapper.canUserEdit).mockResolvedValueOnce(false)
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mountViewer()
      await flushPromises()

      await wrapper.find('[data-testid="view-source-btn"]').trigger('click')
      expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith(
        'viewer_source_opened',
        expect.objectContaining({
          has_edit_permission: false,
          surface: 'viewer',
          macro_type: DiagramType.Sequence,
        }),
      )
    })

    it('fires viewer_source_copied when Copy is clicked in the panel', async () => {
      const writeText = vi.fn(() => Promise.resolve())
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      })
      Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        value: true,
      })

      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mountViewer()
      await flushPromises()

      await wrapper.find('[data-testid="view-source-btn"]').trigger('click')
      await wrapper.vm.$nextTick()
      vi.mocked(trackAnalyticsEvent).mockClear()

      await wrapper.find('[data-testid="view-source-copy"]').trigger('click')
      await flushPromises()

      expect(writeText).toHaveBeenCalledWith(SOURCE_DSL)
      expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('viewer_source_copied', {
        feature_area: 'macro',
        surface: 'viewer',
        macro_type: DiagramType.Sequence,
        has_edit_permission: true,
      })
    })

    it('closes the panel when the close button is clicked', async () => {
      const wrapper = mountViewer()
      await flushPromises()
      await wrapper.find('[data-testid="view-source-btn"]').trigger('click')
      expect(wrapper.find('[data-testid="view-source-panel"]').exists()).toBe(true)

      await wrapper.find('[data-testid="view-source-close"]').trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-testid="view-source-panel"]').exists()).toBe(false)
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

  // Source-snapshot fallback (docs/superpowers/plans/2026-07-18-diagram-
  // source-snapshot-attachments.md Task 6): when the viewer mounts a diagram
  // restored from a host-page JSON snapshot, Edit is disabled with an honest
  // "cached copy" notice rather than claiming the live source is available.
  describe('snapshot fallback cached-copy notice', () => {
    it('editDisabledReason contains "cached copy" when snapshotFallback is true', () => {
      store.state.diagram.snapshotFallback = true
      store.state.diagram.snapshotAt = '2026-07-01T00:00:00.000Z'
      store.state.diagram.isCopy = false
      store.state.diagram.recoveredFromOrphan = false
      const wrapper = mountViewer()
      expect((wrapper.vm as any).editDisabledReason).toContain('cached copy')
    })
  })

  // The viewer computes only the zero-network cross-page verdict at load
  // (ApWrapper2.detectCrossPageCopy); same-page duplicates are detected on
  // edit/config surfaces only. An undefined verdict must read as "no
  // restriction", and a verdict written into the store must update the
  // banner reactively without a remount.
  describe('cross-page copy verdict', () => {
    it('treats an undefined verdict as no restriction and reacts when isCopy lands', async () => {
      store.state.diagram.isCopy = undefined
      store.state.diagram.copyReason = undefined
      const wrapper = mountViewer()
      await wrapper.vm.$nextTick()
      expect((wrapper.vm as any).editDisabledReason).toBeNull()

      store.state.diagram.isCopy = true
      store.state.diagram.copyReason = 'cross-page'
      await wrapper.vm.$nextTick()

      expect((wrapper.vm as any).editDisabledReason).toContain('lives on another page')
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

    // Export PNG (code review): ExportModal must receive the capture element
    // via a getter, not rediscover it with a global querySelector, and must
    // know the diagram title for the export filename.
    it('passes a capture-node getter resolving to .screen-capture-content, and the diagram title, to ExportModal', () => {
      const wrapper = mountViewer()
      const exportModal = wrapper.findComponent(ExportModal)
      expect(exportModal.props('diagramTitle')).toBe('Login flow')
      const getter = exportModal.props('captureNodeGetter') as () => HTMLElement | null
      expect(typeof getter).toBe('function')
      expect(getter()).toBe(wrapper.find('.screen-capture-content').element)
    })
  })

  // Live Agent Link (docs/superpowers/specs/2026-07-08-live-agent-link-design.md)
  // — the whole feature is gated behind agent-link-enabled, defaulting off.
  // Flag resolution is async (mounted()), so every assertion here awaits
  // flushPromises() after mount to let that promise settle before asserting.
  describe('Live Agent Link (flag-gated)', () => {
    const setFullscreen = (on: boolean) => {
      ;(window as any).forgeGlobal = on
        ? { forgeContext: { extension: { modal: { macroMode: 'fullscreen' } } } }
        : undefined
    }
    afterEach(() => { delete (window as any).forgeGlobal })

    it('does NOT render Connect to Agent when the flag resolves false (default)', async () => {
      const wrapper = mountViewer()
      await flushPromises()
      expect(wrapper.find('[data-testid="agent-link-connect-btn"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="agent-link-live-badge"]').exists()).toBe(false)
    })

    it('renders Connect to Agent in the action area when the flag resolves true', async () => {
      vi.mocked(isAgentLinkEnabled).mockResolvedValueOnce(true)
      const wrapper = mountViewer()
      await flushPromises()
      expect(wrapper.find('[data-testid="agent-link-connect-btn"]').exists()).toBe(true)
    })

    it('does not render Connect to Agent for a non-MVP diagram type (graph) even when the flag is on', async () => {
      store.commit('updateDiagramType', DiagramType.Graph)
      vi.mocked(isAgentLinkEnabled).mockResolvedValueOnce(true)
      const wrapper = mountViewer()
      await flushPromises()
      expect(wrapper.find('[data-testid="agent-link-connect-btn"]').exists()).toBe(false)
    })

    it('clicking Connect to Agent starts the session and opens Fullscreen', async () => {
      vi.mocked(isAgentLinkEnabled).mockResolvedValueOnce(true)
      const spy = vi.spyOn(EventBus, '$emit')
      const wrapper = mountViewer()
      await flushPromises()

      await wrapper.find('[data-testid="agent-link-connect-btn"]').trigger('click')

      expect(spy).toHaveBeenCalledWith('fullscreen')
      expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith(
        'agent_link_connect_clicked',
        expect.objectContaining({ feature_area: 'agent_link', macro_type: DiagramType.Sequence })
      )
    })

    it('mounts the Fullscreen Connect rail (not the small-macro button/badge) when in fullscreen with the flag on', async () => {
      setFullscreen(true)
      vi.mocked(isAgentLinkEnabled).mockResolvedValueOnce(true)
      const wrapper = mountViewer()
      await flushPromises()

      expect(wrapper.find('[data-testid="agent-link-fullscreen-rail"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="agent-link-connect-btn"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="agent-link-live-badge"]').exists()).toBe(false)
    })

    it('does not mount the Fullscreen rail when the flag resolves false', async () => {
      setFullscreen(true)
      const wrapper = mountViewer()
      await flushPromises()
      expect(wrapper.find('[data-testid="agent-link-fullscreen-rail"]').exists()).toBe(false)
    })

    // Amendment D: the composable's alreadyLinkedUntil (set from a mint 409's
    // lockExpiresAt) must reach ConnectPanel's already_linked SessionNotice for
    // an honest countdown instead of a blind "already linked" notice.
    it('wires the composable alreadyLinkedUntil into the Fullscreen ConnectPanel as lock-expires-at', async () => {
      setFullscreen(true)
      vi.mocked(isAgentLinkEnabled).mockResolvedValueOnce(true)
      const wrapper = mountViewer()
      await flushPromises()

      const vm = wrapper.vm as any
      const lockExpiresAt = Date.now() + 5 * 60 * 1000
      vm.agentLinkSession.state.value = 'already_linked'
      vm.agentLinkSession.alreadyLinkedUntil.value = lockExpiresAt
      await wrapper.vm.$nextTick()

      const notice = wrapper.find('[data-testid="agent-link-notice"]')
      expect(notice.exists()).toBe(true)
      expect(notice.text()).toContain('expires in ~5 min')
    })

    // Track F — perceived-latency thinking overlay on the diagram render surface.
    it('does NOT mount the thinking overlay seam at all when the flag resolves false (flag-off DOM unchanged)', async () => {
      const wrapper = mountViewer()
      await flushPromises()
      expect(wrapper.findComponent(ThinkingOverlay).exists()).toBe(false)
      expect(wrapper.find('[data-testid="agent-thinking-overlay"]').exists()).toBe(false)
    })

    it('mounts the thinking overlay seam (idle, rendering nothing) on the render surface when the flag is on', async () => {
      vi.mocked(isAgentLinkEnabled).mockResolvedValueOnce(true)
      const wrapper = mountViewer()
      await flushPromises()
      // Seam is mounted for both surfaces (inline + fullscreen)...
      expect(wrapper.findComponent(ThinkingOverlay).exists()).toBe(true)
      // ...but renders nothing while idle (no op in flight).
      expect(wrapper.find('[data-testid="agent-thinking-overlay"]').exists()).toBe(false)
    })

    it('does not mount the thinking overlay for a non-MVP diagram type (graph) even with the flag on', async () => {
      store.commit('updateDiagramType', DiagramType.Graph)
      vi.mocked(isAgentLinkEnabled).mockResolvedValueOnce(true)
      const wrapper = mountViewer()
      await flushPromises()
      expect(wrapper.findComponent(ThinkingOverlay).exists()).toBe(false)
    })

    it('shows the shimmer overlay on the render surface when the session is thinking', async () => {
      vi.mocked(isAgentLinkEnabled).mockResolvedValueOnce(true)
      const wrapper = mountViewer()
      await flushPromises()

      // Drive the composable's thinking state (a real op would set this via the
      // relay) and confirm it surfaces on the diagram render surface.
      ;(wrapper.vm as any).agentLinkSession.thinkingState.value = 'thinking'
      await wrapper.vm.$nextTick()

      const overlay = wrapper.find('[data-testid="agent-thinking-overlay"]')
      expect(overlay.exists()).toBe(true)
      expect(overlay.classes()).toContain('agent-thinking-overlay--thinking')
      expect(wrapper.find('[data-testid="agent-thinking-spinner"]').exists()).toBe(true)
    })
  })

  // Finding #4 (live spot-check, 2026-07-09): the real Fullscreen modal iframe
  // showed `agent-link-panel--idle` (blank) even though a live session was
  // sitting in localStorage — because the hydration used to live INSIDE the
  // `agentLinkFeatureEnabled && globals.apWrapper` block, and apWrapper wasn't
  // set up the same way in that iframe. Hydration must not depend on
  // apWrapper/the bridge block at all — these tests remove apWrapper entirely
  // and confirm the rail still hydrates.
  describe('Fullscreen hydration is independent of globals.apWrapper (finding #4)', () => {
    const setFullscreenWithPageId = (pageId?: string) => {
      ;(window as any).forgeGlobal = {
        forgeContext: {
          extension: {
            modal: { macroMode: 'fullscreen' },
            content: pageId != null ? { id: pageId } : undefined,
          },
        },
      }
    }
    let originalApWrapper: any
    let originalGetCurrentPageId: any
    let originalIsForge: any
    let originalForgeContext: any

    beforeEach(() => {
      originalApWrapper = (globals as any).apWrapper
      originalGetCurrentPageId = originalApWrapper?._getCurrentPageId
      originalIsForge = (forgeRuntime as any).isForge
      originalForgeContext = (forgeRuntime as any).forgeContext
    })
    afterEach(() => {
      delete (window as any).forgeGlobal
      ;(globals as any).apWrapper = originalApWrapper
      if (originalApWrapper) {
        if (originalGetCurrentPageId === undefined) {
          delete originalApWrapper._getCurrentPageId
        } else {
          originalApWrapper._getCurrentPageId = originalGetCurrentPageId
        }
      }
      ;(forgeRuntime as any).isForge = originalIsForge
      ;(forgeRuntime as any).forgeContext = originalForgeContext
      localStorage.clear()
    })

    it('hydrates the rail to waiting via readSession(pageId) even when globals.apWrapper is absent', async () => {
      setFullscreenWithPageId('page-123')
      ;(globals as any).apWrapper = undefined
      vi.mocked(isAgentLinkEnabled).mockResolvedValueOnce(true)
      persistSession({
        token: 'tok-abc',
        cloudId: 'cloud-1',
        pageId: 'page-123',
        contentId: 'content-123',
        state: 'waiting',
      })

      const wrapper = mountViewer()
      await flushPromises()

      const panel = wrapper.find('[data-testid="agent-link-panel"]')
      expect(panel.classes()).toContain('agent-link-panel--waiting')
      expect(wrapper.find('[data-testid="agent-link-prompt"]').text()).toContain('tok-abc')
    })

    it('falls back to readAnySession() when the Fullscreen iframe has no resolvable pageId', async () => {
      setFullscreenWithPageId(undefined)
      ;(globals as any).apWrapper = undefined
      vi.mocked(isAgentLinkEnabled).mockResolvedValueOnce(true)
      persistSession({
        token: 'tok-xyz',
        cloudId: 'cloud-1',
        pageId: 'some-other-page',
        contentId: 'content-999',
        state: 'waiting',
      })

      const wrapper = mountViewer()
      await flushPromises()

      const panel = wrapper.find('[data-testid="agent-link-panel"]')
      expect(panel.classes()).toContain('agent-link-panel--waiting')
      expect(wrapper.find('[data-testid="agent-link-prompt"]').text()).toContain('tok-xyz')
    })

    it('still hydrates normally when globals.apWrapper IS present (no regression on the inline/bridge path)', async () => {
      setFullscreenWithPageId('page-456')
      vi.mocked(isAgentLinkEnabled).mockResolvedValueOnce(true)
      persistSession({
        token: 'tok-present',
        cloudId: 'cloud-1',
        pageId: 'page-456',
        contentId: 'content-456',
        state: 'waiting',
      })

      const wrapper = mountViewer()
      await flushPromises()

      const panel = wrapper.find('[data-testid="agent-link-panel"]')
      expect(panel.classes()).toContain('agent-link-panel--waiting')
      expect(wrapper.find('[data-testid="agent-link-prompt"]').text()).toContain('tok-present')
    })

    it('keeps the rendered Fullscreen rail reactive when the real bridge session replaces the placeholder after first render', async () => {
      setFullscreenWithPageId('page-reactive')
      vi.mocked(isAgentLinkEnabled).mockResolvedValueOnce(true)
      persistSession({
        token: 'CL-TEST',
        cloudId: 'cloud-1',
        pageId: 'page-reactive',
        contentId: 'content-123',
        state: 'waiting',
      })

      let resolvePageId!: (pageId: string) => void
      const pageIdPromise = new Promise<string>((resolve) => {
        resolvePageId = resolve
      })
      ;(forgeRuntime as any).isForge = true
      ;(forgeRuntime as any).forgeContext = undefined
      ;(globals as any).apWrapper._getCurrentPageId = vi.fn(() => pageIdPromise)

      const wrapper = mountViewer()
      await flushPromises()
      await wrapper.vm.$nextTick()

      expect(wrapper.find('[data-testid="agent-link-panel"]').classes()).toContain('agent-link-panel--idle')

      resolvePageId('page-reactive')
      await flushPromises()
      await wrapper.vm.$nextTick()

      const panel = wrapper.find('[data-testid="agent-link-panel"]')
      expect(panel.classes()).toContain('agent-link-panel--waiting')
      expect(wrapper.find('[data-testid="agent-link-prompt"]').text()).toContain('CL-TEST')
    })

    // Regression (live spot-check 2026-07-09): the normal order is Connect
    // persists 'waiting' FIRST, then Fullscreen opens and finds it. The old
    // code did a one-shot hydrateFrom on the found record and NEVER subscribed,
    // so when the relay owner later persisted 'connected' (agent paired), the
    // panel stayed 'waiting' forever — no green "connected" border, even though
    // localStorage said connected. The fix always keeps watching after the
    // initial hydrate.
    it('flips waiting -> connected when the relay owner persists connected AFTER Fullscreen mount', async () => {
      setFullscreenWithPageId('page-conn')
      vi.mocked(isAgentLinkEnabled).mockResolvedValueOnce(true)
      persistSession({
        token: 'CL-CONN',
        cloudId: 'cloud-1',
        pageId: 'page-conn',
        contentId: 'content-conn',
        state: 'waiting',
      })

      const wrapper = mountViewer()
      await flushPromises()
      expect(wrapper.find('[data-testid="agent-link-panel"]').classes()).toContain(
        'agent-link-panel--waiting',
      )

      // Agent pairs -> relay owner persists 'connected' AFTER mount, and raises
      // the same-origin storage notification a cross-frame write would.
      persistSession({
        token: 'CL-CONN',
        cloudId: 'cloud-1',
        pageId: 'page-conn',
        contentId: 'content-conn',
        state: 'connected',
      })
      window.dispatchEvent(new StorageEvent('storage', { key: 'agentLinkSession:page-conn' }))
      await flushPromises()
      await wrapper.vm.$nextTick()

      expect(wrapper.find('[data-testid="agent-link-panel"]').classes()).toContain(
        'agent-link-panel--connected',
      )
    })
  })

})
