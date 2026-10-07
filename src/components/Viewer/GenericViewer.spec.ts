import { mount, flushPromises } from '@vue/test-utils'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import GenericViewer from '@/components/Viewer/GenericViewer.vue'
import store from '@/model/store2'
import { DiagramType, DataSource } from '@/model/Diagram/Diagram'
import EventBus from '@/EventBus'
import { trackAnalyticsEvent, trackAnalyticsEventBeforeUnload } from '@/utils/analytics/trackAnalyticsEvent'
import { isAgentLinkEnabled, isArchitectureTokensEnabled, isCreateGuideEnabled } from '@/apis/aiTitleFeatureFlag'
import { openCreateGuide } from '@/features/createGuide/openCreateGuide'
import globals from '@/model/globals'
import forgeRuntime from '@/model/globals/forgeGlobal'
import { persistSession } from '@/composables/agentLink/sessionHandoff'
import ThinkingOverlay from '@/components/AgentLink/ThinkingOverlay.vue'
import ExportModal from '@/components/ExportModal/ExportModal.vue'
import { toast } from '@/utils/toast'
import { parseEmbedDeeplink } from '@/utils/embedDeeplink'
import { getForgeCustomContentId } from '@/utils/viewerLoadOutcome'
import { readCopyAttribution } from '@/utils/analytics/copyAttribution'
import { callRemote } from '@/utils/requestUtil'
import { magicSourceHash } from '@/utils/magic/artifact'
import { writeMagicPreference } from '@/utils/magic/localPreference'
import { PI_MAGIC_SYNTHETIC_ARTIFACT, PI_MAGIC_SYNTHETIC_SOURCE } from './fixtures/piMagicSynthetic'
import { webcrypto } from 'node:crypto'
import { reloadViewer, startRetryMarker, readRetryMarker } from '@/utils/loadFailedRetry'

vi.mock('@/utils/requestUtil', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/utils/requestUtil')>(),
  callRemote: vi.fn(() => Promise.resolve({ outcome: 'miss' })),
}))

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
  trackAnalyticsEventBeforeUnload: vi.fn(() => Promise.resolve()),
}))

// Real marker behaviour (it is the thing under test), stubbed reload — jsdom's
// location.reload throws "Not implemented" and would navigate the runner.
vi.mock('@/utils/loadFailedRetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/loadFailedRetry')>()
  return { ...actual, reloadViewer: vi.fn() }
})

// Live Agent Link master flag defaults to resolved-false here so every
// EXISTING test in this file below exercises the flag-off ("renders exactly
// as today") path without opting in. Individual agent-link tests override
// this per-test with mockResolvedValueOnce(true).
vi.mock('@/apis/aiTitleFeatureFlag', () => ({
  isAgentLinkEnabled: vi.fn(() => Promise.resolve(false)),
  isArchitectureTokensEnabled: vi.fn(() => Promise.resolve(false)),
  isCreateGuideEnabled: vi.fn(() => Promise.resolve(false)),
}))

vi.mock('@/features/createGuide/openCreateGuide', () => ({ openCreateGuide: vi.fn(() => Promise.resolve()) }))

vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      canUserEdit: vi.fn(() => Promise.resolve(true)),
      isDisplayMode: vi.fn(() => true),
      _getCurrentUser: vi.fn(() => Promise.resolve({ atlassianAccountId: 'test-user-id' })),
      getCurrentSpace: vi.fn(() => Promise.resolve({ key: 'TEST' })),
      getAndPrintContentVersions: vi.fn(() => Promise.resolve([])),
      // Copy for AI page context (resolveCopyForAiPage) — same path
      // agentLink's readPage uses. The URL is derived from THIS response's
      // _links (base+webui), not a second request — individual tests
      // override this fixture to exercise the diagram-only fallback and the
      // URL-unresolvable-but-text-present case.
      _getCurrentPageId: vi.fn(() => Promise.resolve('page-123')),
      getCurrentPage: vi.fn(() => Promise.resolve({
        title: 'Login flow page',
        body: { export_view: { value: '<p>Some page context.</p>' } },
        _links: { base: 'https://example.atlassian.net/wiki', webui: '/spaces/TEST/pages/123' },
      })),
    }
  }
}))

vi.mock('@forge/bridge', () => ({
  view: {
    getContext: vi.fn(() => Promise.resolve({
      // A realistic UUID (parseEmbedDeeplink requires 32-36 hex/dash chars) —
      // NOT the plain 'cloud-1' this used to be, which silently produced an
      // unparseable minted URL that no test ever actually parsed back.
      cloudId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
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

vi.mock('@/model/globals/forgeGlobal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/model/globals/forgeGlobal')>()
  return {
    ...actual,
    openUrl: vi.fn(() => Promise.resolve()),
  }
})

vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: vi.fn(() => 'example.atlassian.net'),
  getSpaceKey: vi.fn(() => 'TEST'),
}))

// Isolated from forgeRuntime/getContext() on purpose: those back the
// copyDeeplink tests' @forge/bridge-mocked cloudId resolution below, which
// requires forgeContext to stay falsy until getContext()'s own lazy
// getView() call resolves it. Mutating the real forgeGlobal singleton here
// would short-circuit that for every test in the file, not just these ones.
vi.mock('@/utils/viewerLoadOutcome', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/viewerLoadOutcome')>()
  return {
    ...actual,
    getForgeCustomContentId: vi.fn(() => 'content-123'),
  }
})

const mountViewer = () => mount(GenericViewer, { global: { plugins: [store] } })

// The bottom pill is gone (staged header, 2026-10): its actions live in the
// header More (⋯) menu. Opens it and returns the menu item with that label.
async function openMoreMenu(wrapper: ReturnType<typeof mount>) {
  await wrapper.find('.viewer-act-more .overflow-menu-trigger').trigger('click')
  await wrapper.vm.$nextTick()
}
function moreMenuLabels(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('.viewer-act-more [role="menuitem"]').map(item => item.text())
}
async function clickMoreItem(wrapper: ReturnType<typeof mount>, label: string, { clearAnalytics = false } = {}) {
  await openMoreMenu(wrapper)
  if (clearAnalytics) vi.mocked(trackAnalyticsEvent).mockClear()
  const item = wrapper.findAll('.viewer-act-more [role="menuitem"]').find(i => i.text() === label)
  if (!item) throw new Error(`No More menu item "${label}" in ${JSON.stringify(moreMenuLabels(wrapper))}`)
  await item.trigger('click')
}

describe('GenericViewer (chrome-less)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(callRemote).mockImplementation(async (path) => {
      if (path === '/magic-writeback') return { outcome: 'miss' };
      throw new Error('No remote configured in unit test');
    })
    // Before the store assignments below: wrappers mounted by earlier tests in
    // this file stay mounted and still watch viewerLoadState, so a retry marker
    // left in sessionStorage would make one of them report a retry outcome
    // against the NEXT test's state change.
    sessionStorage.clear()
    localStorage.clear()
    store.commit('updateDiagramType', DiagramType.Sequence)
    store.state.diagram.source = DataSource.CustomContent
    store.state.diagram.isCopy = false
    store.state.diagram.title = 'Login flow'
    // Numeric (parseEmbedDeeplink requires \d+) — NOT the plain 'content-123'
    // this used to be, for the same reason as the cloudId fixture above.
    store.state.diagram.id = '987654321'
    store.state.diagram.snapshotFallback = false
    store.state.diagram.snapshotAt = undefined
    store.state.diagram.magic = undefined
    store.state.diagram.recoveredFromOrphan = false
    store.state.viewerLoadState = 'ready'
    store.state.loadError = null
    // @ts-expect-error — matches the production `// @ts-ignore\nwindow.forgeGlobal = global`
    // assignment in forgeGlobal.ts; isFullscreenMode() reads this directly.
    window.forgeGlobal = {
      forgeContext: {
        extension: { config: { customContentId: 'content-123' } },
      },
    } as any
  })

  describe('Fullscreen Magic', () => {
    it('automatically pulls a persisted artifact and still sanitizes before display', async () => {
      store.commit('updateDiagramType', DiagramType.Mermaid);
      store.state.diagram.mermaidCode = PI_MAGIC_SYNTHETIC_SOURCE;
      vi.mocked(callRemote).mockResolvedValue({ outcome: 'written', artifact: PI_MAGIC_SYNTHETIC_ARTIFACT });
      const wrapper = mountViewer();
      await vi.waitFor(() => expect(wrapper.find('[data-testid="magic-toggle"]').attributes('aria-pressed')).toBe('true'));
      expect(callRemote).toHaveBeenCalledWith('/magic-writeback', 'POST', { contentId: '987654321' });
      expect(trackAnalyticsEvent).toHaveBeenCalledWith('magic_writeback_completed', expect.objectContaining({ magic_writeback_outcome: 'written' }));
      wrapper.unmount();
    });
    it('keeps Original on a miss and does not repeat the optional request', async () => {
      store.commit('updateDiagramType', DiagramType.Mermaid);
      const wrapper = mountViewer();
      await flushPromises();
      const count = vi.mocked(callRemote).mock.calls.filter(([path]) => path === '/magic-writeback').length;
      await (wrapper.vm as any).initializeMagic();
      expect(vi.mocked(callRemote).mock.calls.filter(([path]) => path === '/magic-writeback')).toHaveLength(count);
      expect(wrapper.find('[data-testid="magic-toggle"]').exists()).toBe(false);
      expect((wrapper.vm as any).magicActive).toBe(false);
      wrapper.unmount();
    });
    it('discards a delivered artifact when the viewer source changed during the request', async () => {
      store.commit('updateDiagramType', DiagramType.Mermaid);
      store.state.diagram.mermaidCode = PI_MAGIC_SYNTHETIC_SOURCE;
      let finish: (value: unknown) => void = () => {};
      vi.mocked(callRemote).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
      const wrapper = mountViewer();
      await flushPromises();
      store.state.diagram.mermaidCode = PI_MAGIC_SYNTHETIC_SOURCE + ' ';
      // Resolve the prior request before Vue starts the request for the new source.
      finish({ outcome: 'written', artifact: PI_MAGIC_SYNTHETIC_ARTIFACT });
      await flushPromises();
      expect(store.state.diagram.magic).toBeUndefined();
      expect((wrapper.vm as any).magicActive).toBe(false);
      wrapper.unmount();
    });
    it('rejects a delivered unsafe SVG and keeps Original', async () => {
      store.commit('updateDiagramType', DiagramType.Mermaid);
      store.state.diagram.mermaidCode = PI_MAGIC_SYNTHETIC_SOURCE;
      vi.mocked(callRemote).mockResolvedValue({ outcome: 'written', artifact: { ...PI_MAGIC_SYNTHETIC_ARTIFACT, svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' } });
      const wrapper = mountViewer();
      await flushPromises();
      expect(store.state.diagram.magic).toBeUndefined();
      expect((wrapper.vm as any).magicActive).toBe(false);
      wrapper.unmount();
    });
    const source = 'graph LR\n  A-->B';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><path d="M0 0L20 20"/></svg>';
    const mounted: ReturnType<typeof mount>[] = [];

    afterEach(async () => {
      // Stop shared-store watchers before the next test changes the artifact.
      // An earlier automatic display can still be pending under CI load and
      // otherwise report source_changed into the next test's analytics spy.
      mounted.splice(0).forEach((wrapper) => wrapper.unmount());
      await flushPromises();
      Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    });

    beforeEach(() => {
      Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
      store.commit('updateDiagramType', DiagramType.Mermaid);
      store.commit('updateMermaidCode', source);
      (window.forgeGlobal!.forgeContext!.extension as any).modal = { macroMode: 'fullscreen' };
    });

    async function mountMagic() {
      const wrapper = mount(GenericViewer, { global: { plugins: [store] }, slots: { default: '<div class="original-diagram">Original canvas</div>' } });
      mounted.push(wrapper);
      await flushPromises();
      return wrapper;
    }

    it('hides the version switch when the current diagram has no Magic artifact', async () => {
      const wrapper = await mountMagic();
      expect(wrapper.find('[data-testid="magic-toggle"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="original-toggle"]').exists()).toBe(false);
      expect(wrapper.find('.original-diagram').exists()).toBe(true);
      expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('magic_availability_checked', expect.objectContaining({ magic_availability: 'missing_artifact' }));
      expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('magic_default_resolved', expect.objectContaining({ magic_default_result: 'original_unavailable' }));
      expect(vi.mocked(trackAnalyticsEvent)).not.toHaveBeenCalledWith('magic_view_failed', expect.anything());
      const assessment = vi.mocked(trackAnalyticsEvent).mock.calls.find(([name]) => name === 'magic_availability_checked')?.[1];
      expect(Object.keys(assessment ?? {}).sort()).toEqual(['feature_area', 'macro_type', 'magic_availability', 'surface']);
    });

    it('records one current availability and default outcome without repeating a validated assessment', async () => {
      store.state.diagram.magic = { sourceHash: await magicSourceHash(source), svg, rulesVersion: 'magic-v1', outcome: 'validated' };
      const wrapper = await mountMagic();
      await vi.waitFor(() => expect(wrapper.find('[data-testid="magic-toggle"]').attributes('aria-pressed')).toBe('true'));
      expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('magic_availability_checked', expect.objectContaining({ magic_availability: 'available' }));
      await vi.waitFor(() => expect((wrapper.vm as any).magicDefaultReported).toHaveLength(1));
      expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('magic_default_resolved', expect.objectContaining({ magic_default_result: 'magic_shown' }));
      await (wrapper.vm as any).initializeMagic();
      expect((wrapper.vm as any).magicAvailabilityReported).toHaveLength(1);
      expect((wrapper.vm as any).magicDefaultReported).toHaveLength(1);
    });

    it('counts an available artifact with a saved Original view as Original preferred', async () => {
      const sourceHash = await magicSourceHash(source);
      const previousContext = forgeRuntime.forgeContext;
      forgeRuntime.forgeContext = { ...window.forgeGlobal!.forgeContext, accountId: 'choice-user', cloudId: 'choice-site' };
      // Restore in finally: a leaked 'choice-site' cloudId breaks later tests
      // in this file (Copy diagram link) whenever an assertion here fails.
      try {
        expect(writeMagicPreference({ accountId: 'choice-user', cloudId: 'choice-site', contentId: '987654321', sourceHash }, 'original')).toBe(true);
        store.state.diagram.magic = { sourceHash, svg, rulesVersion: 'magic-v1', outcome: 'validated' };
        const wrapper = await mountMagic();
        await vi.waitFor(() => expect(wrapper.find('[data-testid="original-toggle"]').attributes('aria-pressed')).toBe('true'));
        await vi.waitFor(() => expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('magic_availability_checked', expect.objectContaining({ magic_availability: 'available' })));
        // The default outcome follows an async feedback digest, so it can land
        // after the availability event under load.
        await vi.waitFor(() => expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('magic_default_resolved', expect.objectContaining({ magic_default_result: 'original_preferred' })));
        expect((wrapper.vm as any).magicActive).toBe(false);
      } finally {
        forgeRuntime.forgeContext = previousContext;
      }
    });

    it('records an automatic verification failure as unavailable without a display error', async () => {
      store.state.diagram.magic = { sourceHash: await magicSourceHash(source), svg, rulesVersion: 'magic-v1', outcome: 'validated' };
      Object.defineProperty(globalThis, 'crypto', { value: { subtle: { digest: () => Promise.reject(new Error('digest unavailable')) } }, configurable: true });
      const wrapper = await mountMagic();
      await vi.waitFor(() => expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('magic_availability_checked', expect.objectContaining({ magic_availability: 'check_failed' })));
      expect(wrapper.find('[data-testid="original-toggle"]').exists()).toBe(false);
      expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('magic_default_resolved', expect.objectContaining({ magic_default_result: 'original_unavailable' }));
      expect(vi.mocked(trackAnalyticsEvent)).not.toHaveBeenCalledWith('magic_view_failed', expect.anything());
      Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    });

    it('hides the version switch when an artifact contains unsafe SVG', async () => {
      store.state.diagram.magic = { sourceHash: await magicSourceHash(source),
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        rulesVersion: 'magic-v1', outcome: 'validated' };
      const wrapper = await mountMagic();
      await vi.waitFor(() => expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('magic_availability_checked', expect.objectContaining({ magic_availability: 'unsafe_svg' })));
      expect(wrapper.find('[data-testid="magic-toggle"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="original-toggle"]').exists()).toBe(false);
      expect(wrapper.find('.original-diagram').exists()).toBe(true);
    });

    // Staged header (2026-10): the inline macro gets a single Refined toggle
    // (it used to be Fullscreen-only), with the same availability gate.
    describe('inline Refined toggle', () => {
      beforeEach(() => { (window as any).forgeGlobal.forgeContext.extension.modal = undefined; });

      it('stays absent inline when the diagram has no Magic artifact, without assessment events', async () => {
        const wrapper = await mountMagic();
        expect(wrapper.find('[data-testid="magic-toggle"]').exists()).toBe(false);
        expect(wrapper.find('[data-testid="original-toggle"]').exists()).toBe(false);
        // An inline view of a plain Mermaid diagram is not a Magic assessment —
        // that would be one event per Mermaid page view.
        expect(vi.mocked(trackAnalyticsEvent)).not.toHaveBeenCalledWith('magic_availability_checked', expect.anything());
        expect(callRemote).not.toHaveBeenCalledWith('/magic-writeback', expect.anything(), expect.anything());
      });

      it('shows a single pressed toggle inline for a valid artifact and toggles to Original', async () => {
        store.state.diagram.magic = { sourceHash: await magicSourceHash(source), svg, rulesVersion: 'magic-v1', outcome: 'validated' };
        const wrapper = await mountMagic();
        await vi.waitFor(() => expect(wrapper.find('[data-testid="magic-toggle"]').attributes('aria-pressed')).toBe('true'));
        const toggle = wrapper.find('[data-testid="magic-toggle"]');
        expect(toggle.classes()).toContain('viewer-refined-toggle');
        expect(toggle.attributes('aria-label')).toBe('Refined layout');
        expect(toggle.find('.viewer-btn-label').text()).toBe('Refined');
        expect(wrapper.find('[data-testid="original-toggle"]').exists()).toBe(false);
        expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('magic_view_succeeded', expect.objectContaining({ surface: 'viewer', magic_activation: 'automatic' }));
        expect(callRemote).not.toHaveBeenCalledWith('/magic-writeback', expect.anything(), expect.anything());

        await toggle.trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-testid="magic-toggle"]').attributes('aria-pressed')).toBe('false');
        expect(wrapper.find('.original-diagram').exists()).toBe(true);
        expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('magic_view_restored', expect.objectContaining({ surface: 'viewer' }));

        await wrapper.find('[data-testid="magic-toggle"]').trigger('click');
        await vi.waitFor(() => expect(wrapper.find('[data-testid="magic-toggle"]').attributes('aria-pressed')).toBe('true'));
        expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('magic_view_requested', expect.objectContaining({ surface: 'viewer', magic_activation: 'manual' }));
      });

      it('shows the layout survey strip inline, thanks the voter, then retires it', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
          store.state.diagram.magic = { sourceHash: await magicSourceHash(source), svg, rulesVersion: 'magic-v1', outcome: 'validated' };
          const wrapper = await mountMagic();
          await vi.waitFor(() => expect(wrapper.find('[data-testid="magic-layout-feedback"]').exists()).toBe(true));
          const strip = wrapper.find('[data-testid="magic-layout-feedback"]');
          expect(strip.classes()).toContain('magic-inline-survey');
          expect(strip.text()).toContain('Which layout do you prefer?');
          expect(wrapper.find('[data-testid="magic-disclosure"]').exists()).toBe(false);

          await strip.findAll('button').find(b => b.text() === 'Original')!.trigger('click');
          expect(wrapper.find('[data-testid="magic-layout-feedback"]').text()).toContain('Thanks for sharing');
          expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('magic_layout_feedback_submitted', expect.objectContaining({ surface: 'viewer', magic_layout_preference: 'original' }));

          await vi.advanceTimersByTimeAsync(4100);
          expect(wrapper.find('[data-testid="magic-layout-feedback"]').exists()).toBe(false);
        } finally {
          vi.useRealTimers();
        }
      });
    });

    it('switches prepared SVG into the capture viewport and restores Original without changing source', async () => {
      store.state.diagram.magic = { sourceHash: await magicSourceHash(source), svg, rulesVersion: 'magic-v1', outcome: 'validated' };
      const wrapper = await mountMagic();
      await vi.waitFor(() => expect(wrapper.find('[data-testid="magic-toggle"]').exists()).toBe(true));
      await wrapper.find('[data-testid="magic-toggle"]').trigger('click');
      await vi.waitFor(() => expect(wrapper.find('[data-testid="magic-toggle"]').attributes('aria-pressed')).toBe('true'));
      expect(wrapper.find('.screen-capture-content .diagram-viewport svg').exists()).toBe(true);
      expect(wrapper.find('.original-diagram').exists()).toBe(false);
      expect(store.state.diagram.mermaidCode).toBe(source);
      expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('magic_view_succeeded', expect.objectContaining({ surface: 'fullscreen', macro_type: 'mermaid' }));
      await wrapper.find('[data-testid="original-toggle"]').trigger('click');
      expect(wrapper.find('.original-diagram').exists()).toBe(true);
      expect(wrapper.find('[data-testid="magic-toggle"]').attributes('aria-pressed')).toBe('false');
      expect(wrapper.find('[data-testid="original-toggle"]').attributes('aria-pressed')).toBe('true');
      expect(wrapper.find('[data-testid="magic-toggle"]').text()).toBe('Refined layout');
      expect(wrapper.find('[data-testid="magic-toggle"]').attributes('title')).toBe('Layout refined with AI.');
      expect(wrapper.find('[data-testid="original-toggle"]').text()).toBe('Original layout');
      expect(wrapper.find('[data-testid="original-toggle"]').attributes('title')).toBe('Show original layout');
      expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('magic_view_restored', expect.anything());
    });

    it('keeps comparative feedback unselected until a vote in either view', async () => {
      (window.forgeGlobal!.forgeContext as any).accountId = 'feedback-user';
      (window.forgeGlobal!.forgeContext as any).cloudId = 'feedback-site';
      store.state.diagram.magic = { sourceHash: await magicSourceHash(source), svg, rulesVersion: 'magic-v1', outcome: 'validated' };
      const wrapper = await mountMagic();
      await vi.waitFor(() => expect(wrapper.find('[data-testid="magic-toggle"]').attributes('aria-pressed')).toBe('true'));
      const choices = () => wrapper.findAll('[data-testid="magic-layout-feedback"] button');
      expect(wrapper.find('[data-testid="magic-layout-feedback"]').text()).toContain('Which layout do you prefer?');
      expect(choices().map(button => button.text())).toEqual(['Refined', 'Original', 'No preference']);
      expect(choices().map(button => button.attributes('aria-pressed'))).toEqual(['false', 'false', 'false']);
      await wrapper.find('[data-testid="original-toggle"]').trigger('click');
      expect(wrapper.find('[data-testid="magic-layout-feedback"]').exists()).toBe(true);
      expect(choices().map(button => button.attributes('aria-pressed'))).toEqual(['false', 'false', 'false']);
      expect(vi.mocked(trackAnalyticsEvent)).not.toHaveBeenCalledWith('magic_layout_feedback_submitted', expect.anything());
      await choices()[0].trigger('click');
      expect(wrapper.find('[data-testid="original-toggle"]').attributes('aria-pressed')).toBe('true');
      expect(choices().map(button => button.attributes('aria-pressed'))).toEqual(['true', 'false', 'false']);
      expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('magic_layout_feedback_submitted', expect.objectContaining({ magic_layout_preference: 'magic' }));
      await choices()[2].trigger('click');
      expect(choices().map(button => button.attributes('aria-pressed'))).toEqual(['false', 'false', 'true']);
      expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('magic_layout_feedback_updated', expect.objectContaining({ magic_layout_preference: 'no_preference' }));
      await wrapper.find('[data-testid="magic-toggle"]').trigger('click');
      await flushPromises();
      expect(choices().map(button => button.attributes('aria-pressed'))).toEqual(['false', 'false', 'true']);
      wrapper.unmount();
      const reopened = await mountMagic();
      await vi.waitFor(() => expect(reopened.find('[data-testid="magic-layout-feedback"]').exists()).toBe(true));
      expect(reopened.findAll('[data-testid="magic-layout-feedback"] button').map(button => button.attributes('aria-pressed')))
        .toEqual(['false', 'false', 'false']);
    });

    it('loads the actual Pi-produced artifact from a raw-body JSON round trip and rejects a stale edit', async () => {
      // Confluence custom content stores the Diagram body as JSON. Exercise that
      // shape without writing to a tenant or substituting a hand-drawn SVG.
      const rawBody = JSON.stringify({
        diagramType: DiagramType.Mermaid,
        mermaidCode: PI_MAGIC_SYNTHETIC_SOURCE,
        magic: PI_MAGIC_SYNTHETIC_ARTIFACT,
      });
      const loaded = JSON.parse(rawBody);
      expect(await magicSourceHash(loaded.mermaidCode)).toBe(PI_MAGIC_SYNTHETIC_ARTIFACT.sourceHash);
      store.commit('updateMermaidCode', loaded.mermaidCode);
      store.state.diagram.magic = loaded.magic;
      const wrapper = await mountMagic();
      await vi.waitFor(() => expect(wrapper.find('[data-testid="magic-toggle"]').exists()).toBe(true));
      await wrapper.find('[data-testid="magic-toggle"]').trigger('click');
      await vi.waitFor(() => {
        expect(wrapper.find('[data-testid="magic-toggle"]').attributes('aria-pressed')).toBe('true');
        expect(wrapper.find('.screen-capture-content .diagram-viewport marker#arrow').exists()).toBe(true);
      });
      expect(wrapper.find('.screen-capture-content .diagram-viewport').text()).toContain('Start');
      expect(wrapper.find('.screen-capture-content .diagram-viewport').text()).toContain('Finish');
      await wrapper.find('[data-testid="original-toggle"]').trigger('click');
      expect(wrapper.find('.original-diagram').exists()).toBe(true);
      expect(wrapper.find('[data-testid="magic-toggle"]').attributes('aria-pressed')).toBe('false');
      store.commit('updateMermaidCode', loaded.mermaidCode + ' ');
      await flushPromises();
      expect(wrapper.find('[data-testid="magic-toggle"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="original-toggle"]').exists()).toBe(false);
      expect(wrapper.find('.screen-capture-content .diagram-viewport marker#arrow').exists()).toBe(false);
    });

    it('rejects stale artifacts, and resets active Magic on source or type change', async () => {
      store.state.diagram.magic = { sourceHash: await magicSourceHash(source + ' '), svg, rulesVersion: 'magic-v1', outcome: 'validated' };
      const wrapper = await mountMagic();
      await vi.waitFor(() => expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('magic_availability_checked', expect.objectContaining({ magic_availability: 'stale_source' })));
      expect(wrapper.find('[data-testid="magic-toggle"]').exists()).toBe(false);
      expect(wrapper.find('.original-diagram').exists()).toBe(true);
      expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('magic_availability_checked', expect.objectContaining({ magic_availability: 'stale_source' }));
      expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('magic_default_resolved', expect.objectContaining({ magic_default_result: 'original_unavailable' }));
      expect(vi.mocked(trackAnalyticsEvent)).not.toHaveBeenCalledWith('magic_view_failed', expect.objectContaining({ magic_failure_reason: 'stale_source' }));
      store.state.diagram.magic = { sourceHash: await magicSourceHash(source), svg, rulesVersion: 'magic-v1', outcome: 'validated' };
      await vi.waitFor(() => expect(wrapper.find('[data-testid="magic-toggle"]').exists()).toBe(true));
      await wrapper.find('[data-testid="magic-toggle"]').trigger('click');
      await vi.waitFor(() => {
        expect(wrapper.find('[data-testid="magic-toggle"]').attributes('aria-pressed')).toBe('true');
        expect(wrapper.find('.diagram-viewport svg').exists()).toBe(true);
      });
      store.commit('updateMermaidCode', source + '\n');
      await flushPromises();
      expect(wrapper.find('.original-diagram').exists()).toBe(true);
      expect(wrapper.find('[data-testid="magic-toggle"]').exists()).toBe(false);
      store.commit('updateDiagramType', DiagramType.Sequence);
      await flushPromises();
      expect(wrapper.find('[data-testid="magic-toggle"]').exists()).toBe(false);
    });

    it('ignores a validation result that arrives after the source changes', async () => {
      const hash = await magicSourceHash(source);
      store.state.diagram.magic = { sourceHash: hash, svg, rulesVersion: 'magic-v1', outcome: 'validated' };
      const wrapper = await mountMagic();
      await vi.waitFor(() => expect(wrapper.find('[data-testid="magic-toggle"]').attributes('aria-pressed')).toBe('true'));
      await wrapper.find('[data-testid="original-toggle"]').trigger('click');
      let releaseDigest!: (value: ArrayBuffer) => void;
      const digest = new Promise<ArrayBuffer>(resolve => { releaseDigest = resolve; });
      Object.defineProperty(globalThis, 'crypto', { value: { subtle: { digest: () => digest } }, configurable: true });
      await wrapper.find('[data-testid="magic-toggle"]').trigger('click');
      expect(wrapper.find('[data-testid="magic-toggle"]').attributes('aria-busy')).toBe('true');
      store.commit('updateMermaidCode', source + '\n');
      await flushPromises();
      releaseDigest(Uint8Array.from(Buffer.from(hash, 'hex')).buffer);
      await flushPromises();
      expect(wrapper.find('.original-diagram').exists()).toBe(true);
      expect(wrapper.find('.diagram-viewport svg').exists()).toBe(false);
      expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('magic_view_failed', expect.objectContaining({ magic_failure_reason: 'source_changed' }));
      Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    });

    it('drops an automatic validation result after source changes before it resolves', async () => {
      const hash = await magicSourceHash(source);
      store.state.diagram.magic = { sourceHash: hash, svg, rulesVersion: 'magic-v1', outcome: 'validated' };
      let releaseDigest!: (value: ArrayBuffer) => void;
      const digest = new Promise<ArrayBuffer>(resolve => { releaseDigest = resolve; });
      const digestOnce = vi.fn().mockImplementationOnce(() => digest)
        .mockImplementation((...args: Parameters<typeof webcrypto.subtle.digest>) => webcrypto.subtle.digest(...args));
      Object.defineProperty(globalThis, 'crypto', { value: { subtle: { digest: digestOnce } }, configurable: true });
      const wrapper = await mountMagic();
      expect(wrapper.find('[data-testid="magic-toggle"]').exists()).toBe(false);
      store.commit('updateMermaidCode', source + '\n');
      releaseDigest(Uint8Array.from(Buffer.from(hash, 'hex')).buffer);
      await flushPromises();
      expect(wrapper.find('.original-diagram').exists()).toBe(true);
      expect(wrapper.find('.diagram-viewport svg').exists()).toBe(false);
      expect(vi.mocked(trackAnalyticsEvent)).not.toHaveBeenCalledWith('magic_availability_checked', expect.objectContaining({ magic_availability: 'available' }));
      expect(vi.mocked(trackAnalyticsEvent)).not.toHaveBeenCalledWith('magic_default_resolved', expect.objectContaining({ magic_default_result: 'magic_shown' }));
      Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    });
  });

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

    it('emits export capture mode synchronously on every open and close', () => {
      const wrapper = mountViewer()
      wrapper.vm.showExportModal = true
      expect(wrapper.emitted('capture-mode-change')).toEqual([[true]])
      wrapper.vm.showExportModal = false
      expect(wrapper.emitted('capture-mode-change')).toEqual([[true], [false]])
      wrapper.unmount()
    })

    it('adds adjacent layout only when a sidebar slot is supplied', () => {
      const plain = mountViewer()
      expect(plain.find('.viewer-body').classes()).not.toContain('viewer-body--with-sidebar')
      plain.unmount()
      const wrapper = mount(GenericViewer, {
        global: { plugins: [store] },
        slots: {
          default: '<div class="diagram-stub">diagram</div>',
          'viewer-actions': '<button class="extra-action">Highlights</button>',
          'viewer-sidebar': '<aside class="extra-sidebar">Feedback</aside>',
        },
      })
      expect(wrapper.find('.viewer-top-actions .extra-action').exists()).toBe(true)
      expect(wrapper.find('.viewer-body').classes()).toContain('viewer-body--with-sidebar')
      expect(wrapper.find('.extra-sidebar').element.previousElementSibling?.classList.contains('viewer-surface')).toBe(true)
      expect(wrapper.find('.screen-capture-content .diagram-stub').exists()).toBe(true)
      wrapper.unmount()
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

    it('mounts RelatedDiagramsFooter only for a ready Mermaid or ZenUML sequence diagram when the flag is on and content id is present', async () => {
      vi.mocked(isArchitectureTokensEnabled).mockResolvedValue(true)
      store.commit('updateDiagramType', DiagramType.Mermaid)
      store.commit(
        'updateMermaidCode',
        '\uFEFF  ---\ntitle: Invented checkout\n---\n%%{init: {"theme":"base"}}%%\n%% an invented comment\nsequenceDiagram\n  participant A',
      )

      const sequence = mountViewer()
      await flushPromises()

      const footer = sequence.findComponent({ name: 'RelatedDiagramsFooter' })
      expect(footer.exists()).toBe(true)
      expect(footer.props()).toMatchObject({
        customContentId: 'content-123',
        ready: true,
        enabled: true,
        surface: 'viewer',
      })

      store.commit('updateDiagramType', DiagramType.Sequence)
      store.commit('updateCode2', '@Actor Customer\nCustomer->Service: request')
      await sequence.vm.$nextTick()
      expect(sequence.findComponent({ name: 'RelatedDiagramsFooter' }).exists()).toBe(true)

      store.commit('updateMermaidCode', 'flowchart TD\n  A-->B')
      store.commit('updateDiagramType', DiagramType.Mermaid)
      await sequence.vm.$nextTick()
      expect(sequence.findComponent({ name: 'RelatedDiagramsFooter' }).exists()).toBe(false)

      store.commit('updateMermaidCode', 'sequenceDiagram\n  participant A')
      store.state.viewerLoadState = 'failed_with_source'
      await sequence.vm.$nextTick()
      expect(sequence.findComponent({ name: 'RelatedDiagramsFooter' }).exists()).toBe(false)

      store.state.viewerLoadState = 'ready'
      vi.mocked(isArchitectureTokensEnabled).mockResolvedValue(false)
      const flagOff = mountViewer()
      await flushPromises()
      expect(flagOff.findComponent({ name: 'RelatedDiagramsFooter' }).exists()).toBe(false)

      vi.mocked(isArchitectureTokensEnabled).mockResolvedValue(true)
      ;(window as any).forgeGlobal.forgeContext.extension.modal = { macroMode: 'fullscreen' }
      const fullscreen = mountViewer()
      await flushPromises()
      expect(fullscreen.findComponent({ name: 'RelatedDiagramsFooter' }).props('surface')).toBe('fullscreen')

      sequence.unmount()
      flagOff.unmount()
      fullscreen.unmount()
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

  // ZEN fullscreen-fit follow-up: .viewer-frame had no height rule, so a
  // diagram shorter than the fullscreen viewport left most of the screen a
  // bare void beneath it. viewer-frame--fullscreen ties the frame to the
  // viewport height regardless of diagram type/width (isWide is orthogonal).
  describe('fullscreen height (all diagram types)', () => {
    const setFullscreen = (on: boolean) => {
      ;(window as any).forgeGlobal = on
        ? { forgeContext: { extension: { modal: { macroMode: 'fullscreen' } } } }
        : undefined
    }
    afterEach(() => { delete (window as any).forgeGlobal })

    it('applies viewer-frame--fullscreen in fullscreen mode', () => {
      setFullscreen(true)
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mount(GenericViewer, {
        global: { plugins: [store] },
        props: { wide: false },
        slots: { default: '<div class="diagram-stub" />' },
      })
      expect(wrapper.find('.viewer-frame').classes()).toContain('viewer-frame--fullscreen')
    })

    // The debug strip stacks above .viewer-frame. With the frame at
    // min-height:100vh the page would exceed the viewport and scroll, and the
    // strip covers the top of a surface meant to show the diagram large.
    // jsdom has window.self === window.top, so Debug's own gate is open here
    // and these assertions exercise the isFullscreenMode gate specifically.
    it('hides the debug strip in fullscreen', () => {
      setFullscreen(true)
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mount(GenericViewer, {
        global: { plugins: [store] },
        props: { wide: false },
        slots: { default: '<div class="diagram-stub" />' },
      })
      expect(wrapper.find('[aria-label="Debug information"]').exists()).toBe(false)
    })

    it('keeps the debug strip on the inline page', () => {
      setFullscreen(false)
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mount(GenericViewer, {
        global: { plugins: [store] },
        props: { wide: false },
        slots: { default: '<div class="diagram-stub" />' },
      })
      expect(wrapper.find('[aria-label="Debug information"]').exists()).toBe(true)
    })

    it('does not apply viewer-frame--fullscreen on the inline (non-fullscreen) page', () => {
      setFullscreen(false)
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mount(GenericViewer, {
        global: { plugins: [store] },
        props: { wide: false },
        slots: { default: '<div class="diagram-stub" />' },
      })
      expect(wrapper.find('.viewer-frame').classes()).not.toContain('viewer-frame--fullscreen')
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

  // Viewer Create: opens the slash-command guide (src/features/createGuide). Lite only,
  // behind the create-guide-enabled Forge flag (always on in a dev build), for users who
  // can edit, on diagram types that have a recorded guide, never inside Fullscreen.
  describe('Create guide button', () => {
    const createButton = (wrapper: ReturnType<typeof mountViewer>) => wrapper.find('button[aria-label="Create"]')
    // Unmount after each test: a still-mounted viewer reacts to the next test's store setup
    // (e.g. AsyncAPI -> Sequence) and would report its own impression into that test.
    const mounted: ReturnType<typeof mountViewer>[] = []
    const mountGuideViewer = () => {
      const wrapper = mountViewer()
      mounted.push(wrapper)
      return wrapper
    }

    beforeEach(() => {
      vi.stubEnv('DEV', false)
      // A non-display mount re-applies variant flags from PRODUCT_TYPE; keep it a Lite build.
      vi.stubEnv('PRODUCT_TYPE', 'lite')
      forgeRuntime.isLite = true
      vi.mocked(isCreateGuideEnabled).mockResolvedValue(true)
    })

    afterEach(() => {
      mounted.splice(0).forEach((wrapper) => wrapper.unmount())
      vi.unstubAllEnvs()
      forgeRuntime.isLite = undefined
      vi.mocked(isCreateGuideEnabled).mockResolvedValue(false)
    })

    it('shows Create for a Lite user who can edit once the flag resolves on', async () => {
      const wrapper = mountGuideViewer()
      await flushPromises()
      expect(createButton(wrapper).exists()).toBe(true)
    })

    it('keeps the row visible at rest when Create shows, so only the other buttons wait for hover', async () => {
      const wrapper = mountGuideViewer()
      await flushPromises()
      expect(wrapper.find('.viewer-top-actions').classes()).toContain('viewer-top-actions--with-create')
    })

    it('leaves the row exactly as before when Create is not shown', async () => {
      vi.mocked(isCreateGuideEnabled).mockResolvedValue(false)
      const wrapper = mountGuideViewer()
      await flushPromises()
      expect(createButton(wrapper).exists()).toBe(false)
      expect(wrapper.find('.viewer-top-actions').classes()).not.toContain('viewer-top-actions--with-create')
    })

    it('shows Create in a dev build even while the flag is off', async () => {
      vi.stubEnv('DEV', true)
      vi.mocked(isCreateGuideEnabled).mockResolvedValue(false)
      const wrapper = mountGuideViewer()
      await flushPromises()
      expect(createButton(wrapper).exists()).toBe(true)
    })

    it('hides Create outside the Lite app, whose guide names Lite macros', async () => {
      forgeRuntime.isLite = false
      const wrapper = mountGuideViewer()
      await flushPromises()
      expect(createButton(wrapper).exists()).toBe(false)
    })

    it('hides Create from users who cannot edit', async () => {
      vi.mocked(globals.apWrapper.canUserEdit).mockResolvedValueOnce(false)
      const wrapper = mountGuideViewer()
      await flushPromises()
      expect(createButton(wrapper).exists()).toBe(false)
    })

    it('hides Create for a diagram type without a guide', async () => {
      store.commit('updateDiagramType', DiagramType.AsyncApi)
      const wrapper = mountGuideViewer()
      await flushPromises()
      expect(createButton(wrapper).exists()).toBe(false)
    })

    it('hides Create in Fullscreen', async () => {
      // @ts-expect-error — see the beforeEach above
      window.forgeGlobal = { forgeContext: { extension: { modal: { macroMode: 'fullscreen' } } } } as any
      const wrapper = mountGuideViewer()
      await flushPromises()
      expect(createButton(wrapper).exists()).toBe(false)
    })

    it('opens the guide for the viewed diagram type when clicked', async () => {
      store.commit('updateDiagramType', DiagramType.Graph)
      const wrapper = mountGuideViewer()
      await flushPromises()
      await createButton(wrapper).trigger('click')
      expect(vi.mocked(openCreateGuide)).toHaveBeenCalledWith({ variant: 'graph', macroType: 'graph', hasEditPermission: true })
    })

    it('shows Create on the OpenAPI viewer, whose runtime type is lowercase openapi', async () => {
      store.commit('updateDiagramType', 'openapi')
      const wrapper = mountGuideViewer()
      await flushPromises()
      await createButton(wrapper).trigger('click')
      expect(vi.mocked(openCreateGuide)).toHaveBeenCalledWith({ variant: 'api', macroType: 'openapi', hasEditPermission: true })
    })

    // isDisplayMode is a non-reactive store getter cached for the whole file, so these cases use
    // the row's other gates: the chrome-less preview (hideHeader) and a failed load.
    it('tracks no impression for a chrome-less viewer, whose action row is not rendered', async () => {
      const wrapper = mount(GenericViewer, { props: { hideHeader: true }, global: { plugins: [store] } })
      mounted.push(wrapper)
      await flushPromises()
      expect(wrapper.find('.viewer-top-actions').exists()).toBe(false)
      const impressions = vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'create_guide_impression')
      expect(impressions).toEqual([])
    })

    it('tracks no impression when the diagram failed to load and the row is replaced', async () => {
      store.state.viewerLoadState = 'failed_without_source'
      const wrapper = mountGuideViewer()
      await flushPromises()
      expect(createButton(wrapper).exists()).toBe(false)
      const impressions = vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'create_guide_impression')
      expect(impressions).toEqual([])
    })

    it('tracks one create_guide_impression per viewer when Create shows', async () => {
      store.commit('updateDiagramType', DiagramType.Mermaid)
      const wrapper = mountGuideViewer()
      await flushPromises()
      await wrapper.vm.$forceUpdate()
      await flushPromises()
      const impressions = vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'create_guide_impression')
      expect(impressions).toEqual([[
        'create_guide_impression',
        { feature_area: 'macro', surface: 'viewer', macro_type: 'mermaid', create_guide_variant: 'zenuml' },
      ]])
    })
  })

  // Staged header (Claude Design prototype, 2026-10): labels collapse in a
  // fixed order driven by how much of the title is visible
  // (src/utils/viewerHeaderLayout.ts, unit-tested there). jsdom has no layout,
  // so these tests pin the contract the CSS keys off — data-stage — and the
  // rendered result is checked in a browser.
  describe('staged header', () => {
    const source = readFileSync(resolve(__dirname, './GenericViewer.vue'), 'utf-8')
    const mounted: ReturnType<typeof mountViewer>[] = []

    beforeEach(() => {
      vi.stubEnv('DEV', false)
      vi.stubEnv('PRODUCT_TYPE', 'lite')
      forgeRuntime.isLite = true
      vi.mocked(isCreateGuideEnabled).mockResolvedValue(true)
    })

    afterEach(() => {
      mounted.splice(0).forEach((wrapper) => wrapper.unmount())
      vi.unstubAllEnvs()
      forgeRuntime.isLite = undefined
      vi.mocked(isCreateGuideEnabled).mockResolvedValue(false)
    })

    it('exposes the collapse stage on the inline frame, starting with every label shown', async () => {
      const wrapper = mountViewer()
      mounted.push(wrapper)
      await flushPromises()
      expect(wrapper.find('.viewer-frame').attributes('data-stage')).toBe('0')
      ;(wrapper.vm as any).headerStage = 2
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.viewer-frame').attributes('data-stage')).toBe('2')
    })

    it('has no stage in Fullscreen, whose header is not staged', async () => {
      ;(window as any).forgeGlobal.forgeContext.extension.modal = { macroMode: 'fullscreen' }
      const wrapper = mountViewer()
      mounted.push(wrapper)
      await flushPromises()
      expect(wrapper.find('.viewer-frame').attributes('data-stage')).toBeUndefined()
    })

    it('replaces the fixed container-query breakpoints with stage rules', () => {
      expect(source).not.toMatch(/@container viewer-header/)
      expect(source).not.toMatch(/container: viewer-header/)
      expect(source).toMatch(/\[data-stage="3"\] \.viewer-act-source/)
    })

    // The stage is measured against the whole viewer's width: an auto frame is
    // fit-content, so its own width follows the header and would feed back.
    it('observes the root viewer element, not the fit-content frame', () => {
      expect(source).toMatch(/const root = this\.\$refs\.viewerRoot;[\s\S]*?headerResizeObserver\.observe\(root\)/)
    })

    // lite-stg, 2026-10-02: a squeezed row wrapped "Connect to Agent" onto two lines. The title
    // truncates instead.
    it('lets the title give way rather than squeezing the buttons', () => {
      expect(source).toMatch(/\.viewer-top-actions \{[^}]*flex-shrink: 0;/)
    })

    it('gives every action the hooks the stage rules target, and a visible name once icon-only', async () => {
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mountViewer()
      mounted.push(wrapper)
      await flushPromises()
      for (const [action, label] of [['edit', 'Edit'], ['source', 'Source'], ['copy', 'Copy for AI'], ['fullscreen', 'Fullscreen'], ['create', 'Create']]) {
        const el = wrapper.find(`.viewer-act-${action}`)
        expect(el.exists(), action).toBe(true)
        expect(el.find('.viewer-btn-label').text(), action).toBe(label)
      }
      expect(wrapper.find('.viewer-act-edit').attributes('title')).toBe('Edit')
      expect(wrapper.find('.viewer-act-fullscreen').attributes('title')).toBe('Fullscreen')
      expect(wrapper.find('.viewer-act-more .overflow-menu-trigger').attributes('aria-label')).toBe('More')
    })

    it('moves Source and Copy for AI into the More menu at stage 3', async () => {
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mountViewer()
      mounted.push(wrapper)
      await flushPromises()
      ;(wrapper.vm as any).headerStage = 3
      await wrapper.vm.$nextTick()
      await openMoreMenu(wrapper)
      expect(moreMenuLabels(wrapper)).toEqual([
        'Source', 'Copy for AI', 'Copy diagram link', 'Copy page link', 'Export PNG', 'Versions', 'Download debug info',
      ])
      expect(wrapper.findAll('.viewer-act-more [role="separator"]')).toHaveLength(2)
    })

    it('runs Source and Copy for AI from the menu, recording where they came from', async () => {
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mountViewer()
      mounted.push(wrapper)
      await flushPromises()
      ;(wrapper.vm as any).headerStage = 3
      await wrapper.vm.$nextTick()
      await clickMoreItem(wrapper, 'Source')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-testid="view-source-panel"]').exists()).toBe(true)
      expect(trackAnalyticsEvent).toHaveBeenCalledWith('viewer_source_opened', expect.objectContaining({ action_location: 'header_more_menu' }))
    })
  })

  describe('header reveal', () => {
    it('reveals the header while keyboard focus is inside the macro', async () => {
      const wrapper = mountViewer()
      await flushPromises()
      const surface = wrapper.find('.viewer-surface')
      expect(surface.classes()).not.toContain('viewer-surface--revealed')

      await surface.trigger('focusin')
      expect(surface.classes()).toContain('viewer-surface--revealed')

      // Focus moving between controls inside the macro keeps it revealed.
      await surface.trigger('focusout', { relatedTarget: wrapper.find('.viewer-act-edit').element })
      expect(surface.classes()).toContain('viewer-surface--revealed')

      await surface.trigger('focusout', { relatedTarget: document.body })
      expect(surface.classes()).not.toContain('viewer-surface--revealed')
      wrapper.unmount()
    })

    it('stays revealed while a header menu is open', async () => {
      const wrapper = mountViewer()
      await flushPromises()
      await openMoreMenu(wrapper)
      expect(wrapper.find('.viewer-surface').classes()).toContain('viewer-surface--revealed')
      wrapper.unmount()
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
      expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith(
        'viewer_source_copied',
        expect.objectContaining({
          feature_area: 'macro',
          surface: 'viewer',
          macro_type: DiagramType.Sequence,
          has_edit_permission: true,
          outcome: 'copied',
          copy_source: 'view_source',
          copy_id: expect.any(String),
        }),
      )
      const call = vi.mocked(trackAnalyticsEvent).mock.calls
        .find(([event]) => event === 'viewer_source_copied')
      expect(readCopyAttribution('content-123')).toMatchObject({
        copy_id: (call?.[1] as any).copy_id,
        copy_source: 'view_source',
        custom_content_id: 'content-123',
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

    // ZEN fullscreen-fit: .viewer-frame is fit-content-sized to the diagram
    // in the fullscreen modal (see isWide comment), so the panel must anchor
    // to the actual viewport (fixed) instead of that short box (absolute).
    it('sizes the panel for the fullscreen viewport when opened from the fullscreen modal', async () => {
      ;(window as any).forgeGlobal = { forgeContext: { extension: { modal: { macroMode: 'fullscreen' } } } }
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mountViewer()
      await flushPromises()

      await wrapper.find('[data-testid="view-source-btn"]').trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('[data-testid="view-source-panel"]').classes()).toContain('view-source-panel--fullscreen')

      delete (window as any).forgeGlobal
    })

    it('does not use fullscreen sizing for the inline (non-fullscreen) viewer', async () => {
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mountViewer()
      await flushPromises()

      await wrapper.find('[data-testid="view-source-btn"]').trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('[data-testid="view-source-panel"]').classes()).not.toContain('view-source-panel--fullscreen')
    })

    // ZEN fullscreen-fit follow-up: the panel is position:fixed (out of
    // layout flow) once open, so .viewer-frame's own centering can't see it —
    // the diagram centered on the FULL width, landing right of the actually-
    // visible left pane. generic--source-panel-open reserves the panel's
    // width so the frame centers against the space that's actually visible.
    it('reserves space for the open fullscreen panel so the frame centers on the visible pane', async () => {
      ;(window as any).forgeGlobal = { forgeContext: { extension: { modal: { macroMode: 'fullscreen' } } } }
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mountViewer()
      await flushPromises()

      expect(wrapper.find('.generic').classes()).not.toContain('generic--source-panel-open')

      await wrapper.find('[data-testid="view-source-btn"]').trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.generic').classes()).toContain('generic--source-panel-open')

      await wrapper.find('[data-testid="view-source-close"]').trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.generic').classes()).not.toContain('generic--source-panel-open')

      delete (window as any).forgeGlobal
    })

    it('does not reserve panel space on the inline (non-fullscreen) viewer', async () => {
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mountViewer()
      await flushPromises()

      await wrapper.find('[data-testid="view-source-btn"]').trigger('click')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.generic').classes()).not.toContain('generic--source-panel-open')
    })
  })

  // Fullscreen Viewer v2 (design handoff). Fullscreen gets its own chrome: a
  // diagram-type chip beside the title, a Source button that toggles, and
  // Escape unwinding one layer at a time. The inline macro is unchanged.
  describe('Fullscreen Viewer v2', () => {
    const asFullscreen = () => {
      ;(window as any).forgeGlobal = { forgeContext: { extension: { modal: { macroMode: 'fullscreen' } } } }
    }

    afterEach(() => {
      delete (window as any).forgeGlobal
    })

    describe('diagram-type chip', () => {
      it.each([
        [DiagramType.Sequence, 'Sequence', 'viewer-type-chip--sequence'],
        [DiagramType.Mermaid, 'Mermaid', 'viewer-type-chip--mermaid'],
        [DiagramType.PlantUml, 'PlantUML', 'viewer-type-chip--plantuml'],
        [DiagramType.Graph, 'Graph', 'viewer-type-chip--graph'],
        [DiagramType.OpenApi, 'OpenAPI', 'viewer-type-chip--openapi'],
      ])('labels %s with its accent in fullscreen', async (type, label, accentClass) => {
        asFullscreen()
        store.commit('updateDiagramType', type)
        const wrapper = mountViewer()
        await flushPromises()

        const chip = wrapper.find('[data-testid="viewer-type-chip"]')
        expect(chip.exists()).toBe(true)
        expect(chip.text()).toBe(label)
        expect(chip.find('.viewer-type-chip').classes()).toContain(accentClass)
      })

      // The chip earns its place by naming the type on a surface that fills the
      // screen; the inline macro sits in a Confluence page that already frames
      // it, and its header row is deliberately quiet.
      it('is not rendered on the inline viewer', async () => {
        store.commit('updateDiagramType', DiagramType.Sequence)
        const wrapper = mountViewer()
        await flushPromises()

        expect(wrapper.find('[data-testid="viewer-type-chip"]').exists()).toBe(false)
      })

      // The accent system (colors_and_type.css) defines five ramps and the
      // design's TABS map names five types. AsyncAPI and Embed are in neither,
      // and the chip is not worth inventing an accent for.
      it('is omitted for a diagram type with no accent', async () => {
        asFullscreen()
        store.commit('updateDiagramType', DiagramType.AsyncApi)
        const wrapper = mountViewer()
        await flushPromises()

        expect(wrapper.find('[data-testid="viewer-type-chip"]').exists()).toBe(false)
      })
    })

    describe('Source toggle', () => {
      it('closes the panel it opened when clicked a second time', async () => {
        asFullscreen()
        store.commit('updateDiagramType', DiagramType.Sequence)
        const wrapper = mountViewer()
        await flushPromises()

        const button = wrapper.find('[data-testid="view-source-btn"]')
        await button.trigger('click')
        await wrapper.vm.$nextTick()
        expect(wrapper.find('[data-testid="view-source-panel"]').exists()).toBe(true)
        expect(button.attributes('aria-expanded')).toBe('true')

        await button.trigger('click')
        await wrapper.vm.$nextTick()
        expect(wrapper.find('[data-testid="view-source-panel"]').exists()).toBe(false)
        expect(button.attributes('aria-expanded')).toBe('false')
      })

      // The toggle must not double-count the funnel: viewer_source_opened still
      // means "a panel was opened", once per open.
      it('tracks viewer_source_opened only on the opening click', async () => {
        asFullscreen()
        store.commit('updateDiagramType', DiagramType.Sequence)
        const wrapper = mountViewer()
        await flushPromises()

        const button = wrapper.find('[data-testid="view-source-btn"]')
        await button.trigger('click')
        await button.trigger('click')
        await button.trigger('click')
        await wrapper.vm.$nextTick()

        const opens = vi.mocked(trackAnalyticsEvent).mock.calls.filter(([name]) => name === 'viewer_source_opened')
        expect(opens).toHaveLength(2)
      })
    })

    describe('Escape', () => {
      it('closes the source panel', async () => {
        asFullscreen()
        store.commit('updateDiagramType', DiagramType.Sequence)
        const wrapper = mountViewer()
        await flushPromises()

        await wrapper.find('[data-testid="view-source-btn"]').trigger('click')
        await wrapper.vm.$nextTick()
        expect(wrapper.find('[data-testid="view-source-panel"]').exists()).toBe(true)

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        await wrapper.vm.$nextTick()
        expect(wrapper.find('[data-testid="view-source-panel"]').exists()).toBe(false)

        wrapper.unmount()
      })

      // One Escape, one layer: the Copy-for-AI menu is on top, so it goes first
      // and the panel behind it survives. Regression guard for the
      // capture-phase listener — a bubble-phase one reads the menu as already
      // closed (CopyForAiMenu's own handler runs first) and closes both.
      it('closes the Copy for AI menu before the panel', async () => {
        asFullscreen()
        store.commit('updateDiagramType', DiagramType.Sequence)
        const wrapper = mountViewer()
        await flushPromises()

        await wrapper.find('[data-testid="view-source-btn"]').trigger('click')
        await wrapper.find('[data-testid="copy-for-ai-menu-btn"]').trigger('click')
        await wrapper.vm.$nextTick()
        expect(wrapper.find('[role="menu"]').exists()).toBe(true)

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        await wrapper.vm.$nextTick()
        expect(wrapper.find('[role="menu"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="view-source-panel"]').exists()).toBe(true)

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        await wrapper.vm.$nextTick()
        expect(wrapper.find('[data-testid="view-source-panel"]').exists()).toBe(false)

        wrapper.unmount()
      })

      // The listener is document-level; an unmounted viewer must not keep
      // answering keystrokes.
      it('stops listening once the viewer unmounts', async () => {
        asFullscreen()
        store.commit('updateDiagramType', DiagramType.Sequence)
        const removeSpy = vi.spyOn(document, 'removeEventListener')
        const wrapper = mountViewer()
        await flushPromises()

        wrapper.unmount()
        expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true)
        removeSpy.mockRestore()
      })
    })
  })

  // One-click "Copy for AI" clipboard payload (copy_for_ai_clicked, catalog.ts).
  describe('Copy for AI', () => {
    const SOURCE_DSL = 'Alice->Bob: hello\nBob->Alice: hi'
    let originalClipboard: PropertyDescriptor | undefined
    let originalIsSecureContext: PropertyDescriptor | undefined

    // The button's visible label is a CSS grid-stack (GenericViewer.vue):
    // every state's label is a permanent DOM node — sized but
    // visibility:hidden when inactive — so the button's width never changes
    // across states. That means wrapper.find(...).text() now concatenates
    // ALL five labels regardless of which is showing; scope state-specific
    // assertions to the one cell marked data-active="true".
    const activeCopyLabel = (root: ReturnType<typeof mountViewer>, testid = 'copy-for-ai-btn') =>
      root.find(`[data-testid="${testid}"] [data-active="true"]`).text()

    beforeEach(() => {
      store.state.diagram.code = SOURCE_DSL
      store.state.diagram.mermaidCode = 'sequenceDiagram\n  A->>B: hi'
      store.state.diagram.plantUmlCode = '@startuml\nA -> B\n@enduml'
      originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
      originalIsSecureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext')
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn(() => Promise.resolve()) },
      })
      Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        value: true,
      })
    })

    // Restore the globals this block stubs. Without this the clipboard/
    // isSecureContext stubs (and any per-test forgeGlobal / execCommand) leak
    // into every describe that runs after this one in the same file.
    afterEach(() => {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
      else delete (navigator as any).clipboard
      if (originalIsSecureContext) Object.defineProperty(window, 'isSecureContext', originalIsSecureContext)
      else delete (window as any).isSecureContext
      delete (window as any).forgeGlobal
      delete (document as any).execCommand
    })

    it('fires one eligible-viewer impression for the Copy for AI CTA', async () => {
      store.commit('updateDiagramType', DiagramType.Sequence)
      mountViewer()
      await flushPromises()

      const calls = vi.mocked(trackAnalyticsEvent).mock.calls
        .filter(([event]) => event === 'copy_for_ai_impression')
      expect(calls).toHaveLength(1)
      expect(calls[0][1]).toMatchObject({
        feature_area: 'macro',
        surface: 'viewer',
        macro_type: DiagramType.Sequence,
        has_edit_permission: true,
        instance_nonce: expect.any(String),
      })
    })

    it('does not fire an impression when viewer chrome hides the CTA', async () => {
      store.commit('updateDiagramType', DiagramType.Sequence)
      mount(GenericViewer, {
        global: { plugins: [store] },
        props: { hideHeader: true },
      })
      await flushPromises()

      expect(vi.mocked(trackAnalyticsEvent).mock.calls
        .some(([event]) => event === 'copy_for_ai_impression')).toBe(false)
    })

    it('fires once if the CTA becomes eligible after the viewer recovers from a load-failed state', async () => {
      store.commit('updateDiagramType', DiagramType.Sequence)
      store.state.viewerLoadState = 'failed_with_source'
      const wrapper = mountViewer()
      await flushPromises()
      expect(vi.mocked(trackAnalyticsEvent).mock.calls
        .some(([event]) => event === 'copy_for_ai_impression')).toBe(false)

      store.state.viewerLoadState = 'ready'
      await wrapper.vm.$nextTick()

      expect(vi.mocked(trackAnalyticsEvent).mock.calls
        .filter(([event]) => event === 'copy_for_ai_impression')).toHaveLength(1)
    })

    it.each([
      DiagramType.Sequence,
      DiagramType.Mermaid,
      DiagramType.PlantUml,
    ])('renders the Copy for AI button for text-DSL type %s', async (type) => {
      store.commit('updateDiagramType', type)
      const wrapper = mountViewer()
      await flushPromises()
      const btn = wrapper.find('[data-testid="copy-for-ai-btn"]')
      expect(btn.exists()).toBe(true)
      expect(activeCopyLabel(wrapper)).toBe('Copy for AI')
      expect(btn.attributes('data-copy-state')).toBe('idle')
      expect(btn.attributes('disabled')).toBeUndefined()
    })

    it.each([
      DiagramType.Graph,
      DiagramType.OpenApi,
      DiagramType.AsyncApi,
      DiagramType.Embed,
    ])('hides the Copy for AI button for non-text-DSL type %s', async (type) => {
      store.commit('updateDiagramType', type)
      const wrapper = mountViewer()
      await flushPromises()
      expect(wrapper.find('[data-testid="copy-for-ai-btn"]').exists()).toBe(false)
    })

    it('copies diagram + page context to the clipboard and fires copy_for_ai_clicked with outcome copied', async () => {
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mountViewer()
      await flushPromises()

      await wrapper.find('[data-testid="copy-for-ai-btn"]').trigger('click')
      await flushPromises()

      const btn = wrapper.find('[data-testid="copy-for-ai-btn"]')
      expect(btn.attributes('data-copy-state')).toBe('copied')
      expect(activeCopyLabel(wrapper)).toBe('Copied')
      expect(wrapper.find('[data-testid="copy-for-ai-announcement"]').text()).toBe('Copied')
      expect(toast).not.toHaveBeenCalled()

      const writeText = vi.mocked(navigator.clipboard.writeText)
      expect(writeText).toHaveBeenCalledTimes(1)
      const copiedText = writeText.mock.calls[0][0] as string
      expect(copiedText).toContain(SOURCE_DSL)
      expect(copiedText).toContain('Login flow page')
      // URL is derived from getCurrentPage()'s own _links — no second
      // /pages/{id} round trip (resolvePageUrl stays copyLink-only).
      expect(copiedText).toContain('https://example.atlassian.net/wiki/spaces/TEST/pages/123')

      const call = vi.mocked(trackAnalyticsEvent).mock.calls.find(c => c[0] === 'copy_for_ai_clicked')
      expect(call).toBeTruthy()
      expect(call![1]).toMatchObject({
        feature_area: 'macro',
        surface: 'viewer',
        macro_type: DiagramType.Sequence,
        outcome: 'copied',
        job: 'generic',
      })
      expect((call![1] as any).dsl_bytes).toBeGreaterThan(0)
      expect((call![1] as any).page_bytes).toBeGreaterThan(0)
    })

    it('writes same-tab attribution metadata after a successful Copy for AI action', async () => {
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mountViewer()
      await flushPromises()

      await wrapper.find('[data-testid="copy-for-ai-btn"]').trigger('click')
      await flushPromises()

      const call = vi.mocked(trackAnalyticsEvent).mock.calls
        .find(([event]) => event === 'copy_for_ai_clicked')
      expect(call?.[1]).toMatchObject({
        outcome: 'copied',
        copy_source: 'copy_for_ai',
        copy_job: 'generic',
        copy_id: expect.any(String),
      })
      expect(readCopyAttribution('content-123')).toMatchObject({
        copy_id: (call?.[1] as any).copy_id,
        copy_source: 'copy_for_ai',
        copy_job: 'generic',
        custom_content_id: 'content-123',
      })
    })

    // The button must show its transient "copying" state (disabled,
    // aria-busy, "Copying…" label) for the whole async window — page fetch
    // + clipboard write — not just flash and resolve synchronously.
    it('shows the copying state (disabled, aria-busy, "Copying…") while the page fetch is pending, then resolves to copied', async () => {
      let resolveGetCurrentPage!: (value: unknown) => void
      const pending = new Promise((resolve) => { resolveGetCurrentPage = resolve })
      vi.mocked(globals.apWrapper.getCurrentPage).mockReturnValueOnce(pending as any)

      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mountViewer()
      await flushPromises()

      await wrapper.find('[data-testid="copy-for-ai-btn"]').trigger('click')

      let btn = wrapper.find('[data-testid="copy-for-ai-btn"]')
      expect(btn.attributes('data-copy-state')).toBe('copying')
      expect(btn.attributes('disabled')).toBeDefined()
      expect(btn.attributes('aria-busy')).toBe('true')
      expect(activeCopyLabel(wrapper)).toBe('Copying…')
      // No writeText yet — this environment has no ClipboardItem, so the
      // legacy fallback runs and resolves the page fetch before writing.
      // The activation-preserving path is covered by the #442 block below.
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled()

      // A second click while copying must not start an overlapping copy.
      await btn.trigger('click')
      await flushPromises()
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled()

      resolveGetCurrentPage({
        title: 'Login flow page',
        body: { export_view: { value: '<p>Some page context.</p>' } },
        _links: { base: 'https://example.atlassian.net/wiki', webui: '/spaces/TEST/pages/123' },
      })
      await flushPromises()

      btn = wrapper.find('[data-testid="copy-for-ai-btn"]')
      expect(btn.attributes('data-copy-state')).toBe('copied')
      expect(btn.attributes('disabled')).toBeUndefined()
      expect(btn.attributes('aria-busy')).toBe('false')
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
      expect(toast).not.toHaveBeenCalled()
    })

    // #442: Safari revokes the transient user activation across the awaited
    // page fetch, so a clipboard call made after that await always throws
    // NotAllowedError there. The fix hands the STILL-PENDING payload to a
    // ClipboardItem constructed synchronously in the click task and calls
    // navigator.clipboard.write() before any await. jsdom has no
    // ClipboardItem, so this block stubs it; every other test in this file
    // (no ClipboardItem stub) exercises the legacy writeText fallback.
    describe('activation-preserving clipboard write (#442)', () => {
      class FakeClipboardItem {
        static instances: FakeClipboardItem[] = []
        data: Record<string, Promise<Blob> | Blob | string>
        constructor(data: Record<string, Promise<Blob> | Blob | string>) {
          this.data = data
          FakeClipboardItem.instances.push(this)
        }
      }
      let write: ReturnType<typeof vi.fn>

      beforeEach(() => {
        FakeClipboardItem.instances = []
        write = vi.fn(() => Promise.resolve())
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { write, writeText: vi.fn(() => Promise.resolve()) },
        })
        ;(window as any).ClipboardItem = FakeClipboardItem
      })

      afterEach(() => {
        delete (window as any).ClipboardItem
      })

      it('calls clipboard.write with a synchronously constructed ClipboardItem while the page fetch is still pending', async () => {
        let resolveGetCurrentPage!: (value: unknown) => void
        const pending = new Promise((resolve) => { resolveGetCurrentPage = resolve })
        vi.mocked(globals.apWrapper.getCurrentPage).mockReturnValueOnce(pending as any)

        store.commit('updateDiagramType', DiagramType.Sequence)
        const wrapper = mountViewer()
        await flushPromises()

        await wrapper.find('[data-testid="copy-for-ai-btn"]').trigger('click')

        // The write must already be in flight BEFORE the page fetch resolves —
        // this is the property Safari enforces.
        expect(write).toHaveBeenCalledTimes(1)
        expect(FakeClipboardItem.instances).toHaveLength(1)

        resolveGetCurrentPage({
          title: 'Login flow page',
          body: { export_view: { value: '<p>Some page context.</p>' } },
          _links: { base: 'https://example.atlassian.net/wiki', webui: '/spaces/TEST/pages/123' },
        })
        await flushPromises()

        // The payload handed to the ClipboardItem resolves to the full text.
        // (FileReader instead of Blob.text() — jsdom's Blob has no .text().)
        const blob = await FakeClipboardItem.instances[0].data['text/plain']
        const text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error)
          reader.readAsText(blob as Blob)
        })
        expect(text).toContain(SOURCE_DSL)
        expect(text).toContain('Login flow page')

        expect(wrapper.find('[data-testid="copy-for-ai-btn"]').attributes('data-copy-state')).toBe('copied')
        expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
        const call = vi.mocked(trackAnalyticsEvent).mock.calls.find(c => c[0] === 'copy_for_ai_clicked')
        expect(call).toBeTruthy()
        expect(call![1]).toMatchObject({ outcome: 'copied', job: 'generic' })
      })

      it('falls back to the legacy writeText path when clipboard.write rejects', async () => {
        write.mockRejectedValueOnce(new Error('promise payloads unsupported'))

        store.commit('updateDiagramType', DiagramType.Sequence)
        const wrapper = mountViewer()
        await flushPromises()

        await wrapper.find('[data-testid="copy-for-ai-btn"]').trigger('click')
        await flushPromises()

        expect(write).toHaveBeenCalledTimes(1)
        expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
        expect(wrapper.find('[data-testid="copy-for-ai-btn"]').attributes('data-copy-state')).toBe('copied')
        const call = vi.mocked(trackAnalyticsEvent).mock.calls.find(c => c[0] === 'copy_for_ai_clicked')
        expect(call![1]).toMatchObject({ outcome: 'copied' })
      })

      it('reports clipboard_failed when both the modern write and the fallback fail', async () => {
        write.mockRejectedValueOnce(new Error('denied'))
        vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'))
        ;(document as any).execCommand = vi.fn(() => false)

        store.commit('updateDiagramType', DiagramType.Sequence)
        const wrapper = mountViewer()
        await flushPromises()

        await wrapper.find('[data-testid="copy-for-ai-btn"]').trigger('click')
        await flushPromises()

        expect(write).toHaveBeenCalledTimes(1)
        expect(wrapper.find('[data-testid="copy-for-ai-btn"]').attributes('data-copy-state')).toBe('failed')
        expect(activeCopyLabel(wrapper)).toBe('Copy failed')
        const call = vi.mocked(trackAnalyticsEvent).mock.calls.find(c => c[0] === 'copy_for_ai_clicked')
        expect(call![1]).toMatchObject({ outcome: 'clipboard_failed' })
        expect(call![1]).not.toHaveProperty('copy_id')
        expect(readCopyAttribution('content-123')).toBeNull()
      })
    })

    it('reverts from "Copied" to idle ~2s after a successful copy', async () => {
      vi.useFakeTimers()
      try {
        store.commit('updateDiagramType', DiagramType.Sequence)
        const wrapper = mountViewer()
        await vi.advanceTimersByTimeAsync(0)

        await wrapper.find('[data-testid="copy-for-ai-btn"]').trigger('click')
        await vi.advanceTimersByTimeAsync(0)

        let btn = wrapper.find('[data-testid="copy-for-ai-btn"]')
        expect(btn.attributes('data-copy-state')).toBe('copied')
        expect(activeCopyLabel(wrapper)).toBe('Copied')

        // Not yet reverted just before the ~2s mark.
        await vi.advanceTimersByTimeAsync(1900)
        expect(wrapper.find('[data-testid="copy-for-ai-btn"]').attributes('data-copy-state')).toBe('copied')

        await vi.advanceTimersByTimeAsync(200)
        btn = wrapper.find('[data-testid="copy-for-ai-btn"]')
        expect(btn.attributes('data-copy-state')).toBe('idle')
        expect(activeCopyLabel(wrapper)).toBe('Copy for AI')
        expect(wrapper.find('[data-testid="copy-for-ai-announcement"]').text()).toBe('')
      } finally {
        vi.useRealTimers()
      }
    })

    it('derives the page URL from getCurrentPage() without a second /pages/{id} request', async () => {
      const { requestConfluence } = await import('@forge/bridge')
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mountViewer()
      await flushPromises()

      await wrapper.find('[data-testid="copy-for-ai-btn"]').trigger('click')
      await flushPromises()

      // globals.apWrapper.getCurrentPage() is stubbed above (not the real
      // ApWrapper2), so it never reaches requestConfluence in this harness —
      // meaning ANY call recorded here can only have come from
      // resolvePageUrl()'s own dynamic `@forge/bridge` import. Before this
      // change resolveCopyForAiPage called resolvePageUrl for the URL (1
      // call); now it derives the URL from getCurrentPage()'s own _links, so
      // resolvePageUrl is never reached from the Copy for AI path — zero
      // calls (resolvePageUrl remains copyLink-only, tested separately).
      expect(vi.mocked(requestConfluence)).not.toHaveBeenCalled()
    })

    // Item 2: resolveCopyForAiPage no longer makes a second request for the
    // URL — it derives from getCurrentPage()'s own _links. When those are
    // missing/unresolvable but title+text fetched fine, the page still goes
    // to the builder with an empty url; outcome stays 'copied' (pageBytes>0).
    it('keeps page context (outcome copied) when the page has no resolvable URL but text was fetched', async () => {
      vi.mocked(globals.apWrapper.getCurrentPage).mockResolvedValueOnce({
        title: 'Login flow page',
        body: { export_view: { value: '<p>Some page context.</p>' } },
        _links: {},
      } as any)
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mountViewer()
      await flushPromises()

      await wrapper.find('[data-testid="copy-for-ai-btn"]').trigger('click')
      await flushPromises()

      const writeText = vi.mocked(navigator.clipboard.writeText)
      expect(writeText).toHaveBeenCalledTimes(1)
      const copiedText = writeText.mock.calls[0][0] as string
      expect(copiedText).toContain(SOURCE_DSL)
      expect(copiedText).toContain('## Page: Login flow page')
      expect(copiedText).not.toMatch(/## Page:.*\nhttps?:\/\//)

      const call = vi.mocked(trackAnalyticsEvent).mock.calls.find(c => c[0] === 'copy_for_ai_clicked')
      expect(call).toBeTruthy()
      expect(call![1]).toMatchObject({ outcome: 'copied', job: 'generic' })
      expect((call![1] as any).page_bytes).toBeGreaterThan(0)
    })

    // Item 1: mirrors copyCode's empty-source guard — no clipboard write, no
    // toast, no analytics event (an empty copy is not demand signal), but the
    // button DOES surface "Nothing to copy" inline for ~2s (the 'failed'
    // state, distinct label) before reverting — same as any other failure.
    it('guards an empty DSL: shows "Nothing to copy", no clipboard write, no copy_for_ai_clicked event, no toast', async () => {
      store.state.diagram.code = ''
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mountViewer()
      await flushPromises()

      await wrapper.find('[data-testid="copy-for-ai-btn"]').trigger('click')
      await flushPromises()

      const btn = wrapper.find('[data-testid="copy-for-ai-btn"]')
      expect(btn.attributes('data-copy-state')).toBe('failed')
      expect(activeCopyLabel(wrapper)).toBe('Nothing to copy')
      expect(wrapper.find('[data-testid="copy-for-ai-announcement"]').text()).toBe('Nothing to copy')
      expect(toast).not.toHaveBeenCalled()

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
      const call = vi.mocked(trackAnalyticsEvent).mock.calls.find(c => c[0] === 'copy_for_ai_clicked')
      expect(call).toBeUndefined()
    })

    // surface must distinguish the Fullscreen modal from the inline macro view
    // (isFullscreenMode reads window.forgeGlobal.forgeContext.extension.modal.macroMode,
    // same signal the "fullscreen width" describe block above uses).
    it('fires copy_for_ai_clicked with surface "fullscreen" when opened from the fullscreen modal', async () => {
      ;(window as any).forgeGlobal = { forgeContext: { extension: { modal: { macroMode: 'fullscreen' } } } }
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mountViewer()
      await flushPromises()

      await wrapper.find('[data-testid="copy-for-ai-btn"]').trigger('click')
      await flushPromises()

      const call = vi.mocked(trackAnalyticsEvent).mock.calls.find(c => c[0] === 'copy_for_ai_clicked')
      expect(call).toBeTruthy()
      expect(call![1]).toMatchObject({ surface: 'fullscreen', job: 'generic' })
    })

    it('falls back to a diagram-only payload (still copied) when the page fetch rejects', async () => {
      vi.mocked(globals.apWrapper.getCurrentPage).mockRejectedValueOnce(new Error('network error'))
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mountViewer()
      await flushPromises()

      await wrapper.find('[data-testid="copy-for-ai-btn"]').trigger('click')
      await flushPromises()

      const writeText = vi.mocked(navigator.clipboard.writeText)
      expect(writeText).toHaveBeenCalledTimes(1)
      expect(writeText.mock.calls[0][0]).toContain(SOURCE_DSL)

      const call = vi.mocked(trackAnalyticsEvent).mock.calls.find(c => c[0] === 'copy_for_ai_clicked')
      expect(call).toBeTruthy()
      expect(call![1]).toMatchObject({ outcome: 'copied_diagram_only', page_bytes: 0, job: 'generic' })
      expect((call![1] as any).dsl_bytes).toBeGreaterThan(0)
    })

    it('shows "Copy failed" and does not throw when the clipboard write rejects (no toast)', async () => {
      // Reject BOTH the modern clipboard API and the legacy execCommand
      // fallback copyToClipboard falls through to, so the whole write
      // genuinely rejects (not just returns false) — exercising copyForAi's
      // own catch block, the same shape as copyCode's failure handling.
      vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'))
      // jsdom doesn't implement execCommand at all — define it (throwing) so
      // the legacy fallback copyToClipboard falls through to also fails,
      // making the whole write genuinely reject.
      ;(document as any).execCommand = () => { throw new Error('execCommand unavailable') }

      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mountViewer()
      await flushPromises()

      await expect(
        wrapper.find('[data-testid="copy-for-ai-btn"]').trigger('click'),
      ).resolves.not.toThrow()
      await flushPromises()

      const btn = wrapper.find('[data-testid="copy-for-ai-btn"]')
      expect(btn.attributes('data-copy-state')).toBe('failed')
      expect(activeCopyLabel(wrapper)).toBe('Copy failed')
      expect(wrapper.find('[data-testid="copy-for-ai-announcement"]').text()).toBe('Copy failed')
      expect(toast).not.toHaveBeenCalled()

      const call = vi.mocked(trackAnalyticsEvent).mock.calls.find(c => c[0] === 'copy_for_ai_clicked')
      expect(call).toBeTruthy()
      expect(call![1]).toMatchObject({ outcome: 'clipboard_failed', job: 'generic' })
      expect((call![1] as any).dsl_bytes).toBeGreaterThan(0)
    })

    it('reverts from "Copy failed" to idle ~2s after a rejected clipboard write', async () => {
      vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'))
      ;(document as any).execCommand = () => { throw new Error('execCommand unavailable') }

      vi.useFakeTimers()
      try {
        store.commit('updateDiagramType', DiagramType.Sequence)
        const wrapper = mountViewer()
        await vi.advanceTimersByTimeAsync(0)

        await wrapper.find('[data-testid="copy-for-ai-btn"]').trigger('click')
        await vi.advanceTimersByTimeAsync(0)

        let btn = wrapper.find('[data-testid="copy-for-ai-btn"]')
        expect(btn.attributes('data-copy-state')).toBe('failed')
        expect(activeCopyLabel(wrapper)).toBe('Copy failed')

        await vi.advanceTimersByTimeAsync(2000)
        btn = wrapper.find('[data-testid="copy-for-ai-btn"]')
        expect(btn.attributes('data-copy-state')).toBe('idle')
        expect(activeCopyLabel(wrapper)).toBe('Copy for AI')
      } finally {
        vi.useRealTimers()
      }
    })

    // Split button: chevron segment opens a menu of five job-framed entry
    // points (CopyForAiMenu.vue). Every entry runs the exact same copyForAi
    // flow with its own `job` value — same clipboard/toast/outcome logic as
    // the primary segment above, only the preamble text and tracked `job`
    // property differ.
    describe('split-button menu', () => {
      it('renders the chevron trigger with aria-haspopup/aria-expanded, gated the same as the primary button', async () => {
        store.commit('updateDiagramType', DiagramType.Sequence)
        const wrapper = mountViewer()
        await flushPromises()

        const menuBtn = wrapper.find('[data-testid="copy-for-ai-menu-btn"]')
        expect(menuBtn.exists()).toBe(true)
        expect(menuBtn.attributes('aria-haspopup')).toBe('menu')
        expect(menuBtn.attributes('aria-expanded')).toBe('false')
      })

      it.each([
        DiagramType.Graph,
        DiagramType.OpenApi,
        DiagramType.AsyncApi,
        DiagramType.Embed,
      ])('is absent for non-text-DSL type %s (same gate as the primary button)', async (type) => {
        store.commit('updateDiagramType', type)
        const wrapper = mountViewer()
        await flushPromises()
        expect(wrapper.find('[data-testid="copy-for-ai-menu-btn"]').exists()).toBe(false)
      })

      it('opens a menu with the five job-framed items on click', async () => {
        store.commit('updateDiagramType', DiagramType.Sequence)
        const wrapper = mountViewer()
        await flushPromises()

        const menuBtn = wrapper.find('[data-testid="copy-for-ai-menu-btn"]')
        await menuBtn.trigger('click')
        await wrapper.vm.$nextTick()

        expect(menuBtn.attributes('aria-expanded')).toBe('true')
        const menu = wrapper.find('[role="menu"]')
        expect(menu.exists()).toBe(true)
        expect(wrapper.findAll('[role="menuitem"]')).toHaveLength(5)

        expect(wrapper.find('[data-testid="copy-for-ai-job-explain"]').text()).toContain('Ask about this flow')
        expect(wrapper.find('[data-testid="copy-for-ai-job-update"]').text()).toContain('Update this diagram')
        expect(wrapper.find('[data-testid="copy-for-ai-job-implement"]').text()).toContain('Implement this design')
        expect(wrapper.find('[data-testid="copy-for-ai-job-audit"]').text()).toContain('Check against my codebase')
        expect(wrapper.find('[data-testid="copy-for-ai-job-tests"]').text()).toContain('Generate test cases')
      })

      it('fires copy_for_ai_menu_opened on every closed-to-open transition', async () => {
        store.commit('updateDiagramType', DiagramType.Sequence)
        const wrapper = mountViewer()
        await flushPromises()
        vi.mocked(trackAnalyticsEvent).mockClear()

        const menuBtn = wrapper.find('[data-testid="copy-for-ai-menu-btn"]')
        await menuBtn.trigger('click')
        await menuBtn.trigger('click')
        await menuBtn.trigger('click')

        const calls = vi.mocked(trackAnalyticsEvent).mock.calls
          .filter(([event]) => event === 'copy_for_ai_menu_opened')
        expect(calls).toHaveLength(2)
        expect(calls[0][1]).toMatchObject({
          feature_area: 'macro',
          surface: 'viewer',
          macro_type: DiagramType.Sequence,
        })
      })

      it('clicking a job item copies that job\'s preamble, fires copy_for_ai_clicked with its job + outcome copied, and drives the PRIMARY segment\'s state machine (no toast)', async () => {
        store.commit('updateDiagramType', DiagramType.Sequence)
        const wrapper = mountViewer()
        await flushPromises()

        await wrapper.find('[data-testid="copy-for-ai-menu-btn"]').trigger('click')
        await wrapper.vm.$nextTick()
        await wrapper.find('[data-testid="copy-for-ai-job-update"]').trigger('click')
        await flushPromises()

        const writeText = vi.mocked(navigator.clipboard.writeText)
        expect(writeText).toHaveBeenCalledTimes(1)
        const copiedText = writeText.mock.calls[0][0] as string
        expect(copiedText).toContain(SOURCE_DSL)
        expect(copiedText).toContain("I want to change this diagram.")

        // Same state machine as a primary-segment click — plays on the
        // PRIMARY button (data-testid="copy-for-ai-btn"), not the chevron.
        const primaryBtn = wrapper.find('[data-testid="copy-for-ai-btn"]')
        expect(primaryBtn.attributes('data-copy-state')).toBe('copied')
        expect(activeCopyLabel(wrapper)).toBe('Copied')
        expect(wrapper.find('[data-testid="copy-for-ai-announcement"]').text()).toBe('Copied')
        expect(toast).not.toHaveBeenCalled()

        const call = vi.mocked(trackAnalyticsEvent).mock.calls.find(c => c[0] === 'copy_for_ai_clicked')
        expect(call).toBeTruthy()
        expect(call![1]).toMatchObject({
          feature_area: 'macro',
          surface: 'viewer',
          macro_type: DiagramType.Sequence,
          outcome: 'copied',
          job: 'update',
        })
      })

      it('closes the menu immediately after selecting a job item, while the primary segment is already showing "Copying…"', async () => {
        store.commit('updateDiagramType', DiagramType.Sequence)
        const wrapper = mountViewer()
        await flushPromises()

        await wrapper.find('[data-testid="copy-for-ai-menu-btn"]').trigger('click')
        await wrapper.vm.$nextTick()
        expect(wrapper.find('[role="menu"]').exists()).toBe(true)

        // Deliberately don't flushPromises() here — this asserts the menu
        // closes and the primary segment starts its state machine on the
        // SAME tick as the click, not after the copy's async work settles.
        await wrapper.find('[data-testid="copy-for-ai-job-tests"]').trigger('click')
        expect(wrapper.find('[role="menu"]').exists()).toBe(false)
        expect(wrapper.find('[data-testid="copy-for-ai-btn"]').attributes('data-copy-state')).toBe('copying')

        await flushPromises()
        expect(wrapper.find('[data-testid="copy-for-ai-btn"]').attributes('data-copy-state')).toBe('copied')
      })
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

  // The bottom pill is gone (staged header, 2026-10). Its actions moved into
  // the header More (⋯) menu, in the prototype's order.
  describe('header More menu', () => {
    afterEach(() => { vi.unstubAllEnvs() })

    it('lists the former pill actions for a custom-content diagram, then debug info', async () => {
      vi.stubEnv('PRODUCT_TYPE', 'lite')
      const wrapper = mountViewer()
      await openMoreMenu(wrapper)
      expect(moreMenuLabels(wrapper)).toEqual(['Copy diagram link', 'Copy page link', 'Export PNG', 'Versions', 'Download debug info'])
      expect(wrapper.findAll('.viewer-act-more [role="separator"]')).toHaveLength(1)
    })

    it('hides Versions AND Copy diagram link when the diagram is not custom content (no custom content id)', async () => {
      vi.stubEnv('PRODUCT_TYPE', 'lite')
      store.state.diagram.source = DataSource.MacroBody
      const wrapper = mountViewer()
      await openMoreMenu(wrapper)
      expect(moreMenuLabels(wrapper)).toEqual(['Copy page link', 'Export PNG', 'Download debug info'])
    })

    // asyncapi has no deeplinkHost mapping (embedDeeplink.ts) — deferred, its
    // viewer doesn't route through GenericViewer anyway — so the item must
    // stay hidden even though isCustomContent is true (Versions still shows).
    it('hides Copy diagram link for asyncapi even with a custom content id (no mapped host)', async () => {
      vi.stubEnv('PRODUCT_TYPE', 'asyncapi')
      const wrapper = mountViewer()
      await openMoreMenu(wrapper)
      expect(moreMenuLabels(wrapper)).toEqual(['Copy page link', 'Export PNG', 'Versions', 'Download debug info'])
    })

    it('renders no bottom pill', () => {
      const wrapper = mountViewer()
      expect(wrapper.find('.viewer-edge-bottom-pill').exists()).toBe(false)
      expect(wrapper.find('[aria-label="Diagram actions"]').exists()).toBe(false)
    })

    it('fires viewer_more_menu_opened with the header stage', async () => {
      const wrapper = mountViewer()
      await flushPromises()
      ;(wrapper.vm as any).headerStage = 2
      await wrapper.vm.$nextTick()
      vi.mocked(trackAnalyticsEvent).mockClear()
      await openMoreMenu(wrapper)
      expect(trackAnalyticsEvent).toHaveBeenCalledWith('viewer_more_menu_opened', {
        feature_area: 'macro',
        surface: 'viewer',
        macro_type: DiagramType.Sequence,
        header_stage: 2,
      })
    })

    // Behaviour change: on the inline macro the button no longer opens the
    // dialog in place — the iframe is 564x256 on production page 2774138946 and
    // the dialog cannot be operated at that size. It opens Fullscreen instead,
    // where the dialog opens on arrival (see openExport / the routing suite).
    it('routes Export PNG to Fullscreen rather than opening the dialog inline', async () => {
      const wrapper = mountViewer()
      const vm = wrapper.vm as any
      const emitted: unknown[] = []
      const handler = (payload: unknown) => emitted.push(payload)
      EventBus.$on('fullscreen', handler)

      expect(vm.showExportModal).toBe(false)
      await clickMoreItem(wrapper, 'Export PNG')

      expect(vm.showExportModal).toBe(false)
      expect(emitted).toEqual([{ openExport: true }])
      expect(trackAnalyticsEvent).toHaveBeenCalledWith('fullscreen_opened', expect.objectContaining({ entry_point: 'export', action_location: 'header_more_menu' }))
      EventBus.$off('fullscreen', handler)
    })

    it('keeps the legacy Versions and Copy page link events, tagged with the menu', async () => {
      const { trackEvent } = await import('@/utils/window')
      const wrapper = mountViewer()
      await clickMoreItem(wrapper, 'Versions')
      expect(trackEvent).toHaveBeenCalledWith('show_content_versions', 'click', 'viewing', { action_location: 'header_more_menu' })
      await clickMoreItem(wrapper, 'Copy page link')
      expect(trackEvent).toHaveBeenCalledWith('copy_link', 'click', 'viewing', { action_location: 'header_more_menu' })
    })

    it('opens with the first item focused and moves with the arrow, Home and End keys', async () => {
      const wrapper = mount(GenericViewer, { global: { plugins: [store] }, attachTo: document.body })
      try {
        await openMoreMenu(wrapper)
        await wrapper.vm.$nextTick()
        const items = wrapper.findAll('.viewer-act-more [role="menuitem"]')
        const menu = wrapper.find('.viewer-act-more [role="menu"]')
        expect(document.activeElement).toBe(items[0].element)
        await menu.trigger('keydown', { key: 'ArrowDown' })
        expect(document.activeElement).toBe(items[1].element)
        await menu.trigger('keydown', { key: 'End' })
        expect(document.activeElement).toBe(items[items.length - 1].element)
        await menu.trigger('keydown', { key: 'ArrowDown' })
        expect(document.activeElement).toBe(items[0].element)
        await menu.trigger('keydown', { key: 'ArrowUp' })
        expect(document.activeElement).toBe(items[items.length - 1].element)
        await menu.trigger('keydown', { key: 'Home' })
        expect(document.activeElement).toBe(items[0].element)
      } finally {
        wrapper.unmount()
      }
    })

    it('closes on Escape, returns focus to the trigger, and leaves the Source panel open', async () => {
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mount(GenericViewer, { global: { plugins: [store] }, attachTo: document.body })
      try {
        await flushPromises()
        await wrapper.find('[data-testid="view-source-btn"]').trigger('click')
        await openMoreMenu(wrapper)
        await wrapper.vm.$nextTick()
        const first = wrapper.find('.viewer-act-more [role="menuitem"]').element as HTMLElement
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        first.dispatchEvent(event)
        await wrapper.vm.$nextTick()
        expect(event.defaultPrevented).toBe(true)
        expect(wrapper.find('.viewer-act-more [role="menu"]').exists()).toBe(false)
        expect(document.activeElement).toBe(wrapper.find('.viewer-act-more .overflow-menu-trigger').element)
        expect(wrapper.find('[data-testid="view-source-panel"]').exists()).toBe(true)
      } finally {
        wrapper.unmount()
      }
    })

    it('closes on Tab and opens from the trigger with ArrowUp', async () => {
      const wrapper = mount(GenericViewer, { global: { plugins: [store] }, attachTo: document.body })
      try {
        const trigger = wrapper.find('.viewer-act-more .overflow-menu-trigger')
        await trigger.trigger('keydown', { key: 'ArrowUp' })
        await wrapper.vm.$nextTick()
        expect(wrapper.find('.viewer-act-more [role="menu"]').exists()).toBe(true)
        await wrapper.find('.viewer-act-more [role="menu"]').trigger('keydown', { key: 'Tab' })
        expect(wrapper.find('.viewer-act-more [role="menu"]').exists()).toBe(false)
      } finally {
        wrapper.unmount()
      }
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

    it('does not render the header actions in the load-failed state', () => {
      store.state.viewerLoadState = 'failed_with_source'
      const wrapper = mountViewer()
      expect(wrapper.find('.viewer-act-more').exists()).toBe(false)
      expect(wrapper.find('[data-testid="load-failed-generic"] .viewer-lf-btn-primary').exists()).toBe(true)
    })
  })

  // Fullscreen header (staged header prototype): the former pill actions are
  // buttons; More holds only Download debug info; an Exit button closes.
  describe('Fullscreen header actions', () => {
    beforeEach(() => {
      vi.stubEnv('PRODUCT_TYPE', 'lite')
      ;(window as any).forgeGlobal.forgeContext.extension.modal = { macroMode: 'fullscreen' }
    })
    afterEach(() => { vi.unstubAllEnvs() })

    it('shows the former pill actions as header buttons in the prototype order', async () => {
      store.commit('updateDiagramType', DiagramType.Sequence)
      const wrapper = mountViewer()
      await flushPromises()
      const labels = wrapper.findAll('.viewer-top-actions .viewer-fs-act').map(b => b.attributes('aria-label'))
      expect(labels).toEqual(['Diagram link', 'Page link', 'Export PNG', 'Versions'])
      expect(wrapper.find('.viewer-act-edit').exists()).toBe(false)
      expect(wrapper.find('.viewer-act-fullscreen').exists()).toBe(false)
    })

    it('keeps only Download debug info in More', async () => {
      const wrapper = mountViewer()
      await flushPromises()
      await openMoreMenu(wrapper)
      expect(moreMenuLabels(wrapper)).toEqual(['Download debug info'])
    })

    it('opens Export PNG in place and tags header actions with fullscreen_header', async () => {
      const { trackEvent } = await import('@/utils/window')
      const wrapper = mountViewer()
      await flushPromises()
      await wrapper.find('.viewer-fs-act[aria-label="Export PNG"]').trigger('click')
      expect((wrapper.vm as any).showExportModal).toBe(true)
      await wrapper.find('.viewer-fs-act[aria-label="Versions"]').trigger('click')
      expect(trackEvent).toHaveBeenCalledWith('show_content_versions', 'click', 'viewing', { action_location: 'fullscreen_header' })
    })

    it('exits Fullscreen from its own close button', async () => {
      const wrapper = mountViewer()
      await flushPromises()
      const emitted: unknown[] = []
      const handler = () => emitted.push('closeFullscreen')
      EventBus.$on('closeFullscreen', handler)
      const close = wrapper.find('[data-testid="fullscreen-exit"]')
      expect(close.attributes('aria-label')).toBe('Exit fullscreen')
      await close.trigger('click')
      expect(emitted).toEqual(['closeFullscreen'])
      EventBus.$off('closeFullscreen', handler)
    })
  })

  describe('load-failed recovery panel', () => {
    it('does not render the diagram slot while load-failed', () => {
      store.state.viewerLoadState = 'failed_with_source'
      const wrapper = mount(GenericViewer, {
        global: { plugins: [store] },
        slots: { default: '<div class="diagram-stub">slot</div>' },
      })
      expect(wrapper.find('.diagram-stub').exists()).toBe(false)
      expect(wrapper.find('[data-testid="load-failed-generic"]').exists()).toBe(true)
    })

    it('renders retry and support actions for failed_with_source', () => {
      store.state.viewerLoadState = 'failed_with_source'
      const wrapper = mountViewer()
      expect(wrapper.text()).toContain("This diagram isn't available")
      expect(wrapper.text()).toContain('Try again')
      expect(wrapper.text()).toContain('Contact support')
    })

    it('renders only Contact support for failed_without_source', () => {
      store.state.viewerLoadState = 'failed_without_source'
      vi.mocked(getForgeCustomContentId).mockReturnValueOnce(undefined)
      const wrapper = mountViewer()
      expect(wrapper.text()).toContain('The diagram data is no longer available')
      expect(wrapper.text()).not.toContain('Try again')
      expect(wrapper.find('[data-testid="load-failed-support-link"]').exists()).toBe(true)
    })

    it('fires load_failed_shown once when the failed state appears', async () => {
      const windowMod = await import('@/utils/window')
      const trackSpy = vi.spyOn(windowMod, 'trackEvent')
      store.state.viewerLoadState = 'failed_with_source'
      mountViewer()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(trackSpy).toHaveBeenCalledWith(
        'load_failed_shown',
        'view',
        'load_failed_generic',
        expect.objectContaining({ state: 'with_id', content_id: 'content-123' }),
      )
    })

    it('copies diagnostics, tracks support click, then opens the support portal after a delay', async () => {
      const openUrlMod = await import('@/model/globals/forgeGlobal')
      const windowMod = await import('@/utils/window')
      const openUrlSpy = vi.spyOn(openUrlMod, 'openUrl').mockImplementation(() => Promise.resolve())
      const trackSpy = vi.spyOn(windowMod, 'trackEvent')
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })

      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        store.state.viewerLoadState = 'failed_without_source'
        store.state.loadError = { httpStatus: 403 }
        const wrapper = mountViewer()
        await wrapper.find('[data-testid="load-failed-support-link"]').trigger('click')
        await vi.advanceTimersByTimeAsync(0)
        expect(writeText).toHaveBeenCalledOnce()
        const payload = writeText.mock.calls[0][0] as string
        expect(payload).toContain("ZenUML couldn't display a diagram")
        expect(payload).toContain('Custom content ID:')
        expect(payload).toContain('Page ID:')
        expect(payload).toContain('Macro UUID:')
        expect(payload).toContain('Space key:')
        expect(payload).toContain('Client domain:')
        expect(payload).toContain('Module key:')
        expect(payload).toContain('Direct fetch status:')
        expect(payload).toContain('Load error HTTP status: 403')
        expect(trackSpy).toHaveBeenCalledWith(
          'support_link_clicked',
          'click',
          'load_failed_generic',
          expect.objectContaining({ content_id: expect.any(String) }),
        )
        expect(openUrlSpy).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1500)
        expect(openUrlSpy).toHaveBeenCalledWith('https://zenuml.atlassian.net/servicedesk')
      } finally {
        vi.useRealTimers()
      }
    })

    // Retry telemetry. `retry()` reloads the iframe, so the click and its
    // result are two separate page lifetimes joined by the sessionStorage
    // marker; these tests drive each half separately. The marker key falls back
    // to the custom content id here because the forgeContext fixture carries no
    // localId.
    describe('retry outcome', () => {
      // The store is a singleton and these tests drive it directly, so a
      // wrapper left mounted keeps watching viewerLoadState and reacts to the
      // NEXT test's state change with its own marker still in storage.
      const mounted: ReturnType<typeof mountViewer>[] = []
      const mountTracked = () => {
        const wrapper = mountViewer()
        mounted.push(wrapper)
        return wrapper
      }

      afterEach(() => {
        while (mounted.length) mounted.pop()?.unmount()
      })

      // The reload aborts an XHR-transported event, so the click must go out on
      // the unload-safe path AND the reload must wait for it. Production on
      // 2026-08-23 recorded 0 clicked against 1 resolved before this.
      it('tracks the retry click on the unload-safe path, then reloads', async () => {
        const order: string[] = []
        vi.mocked(trackAnalyticsEventBeforeUnload).mockImplementation(async () => {
          order.push('track')
        })
        vi.mocked(reloadViewer).mockImplementation(() => {
          order.push('reload')
        })

        store.state.viewerLoadState = 'failed_with_source'
        const wrapper = mountTracked()
        await wrapper.find('[data-testid="load-failed-retry"]').trigger('click')
        await flushPromises()

        expect(trackAnalyticsEventBeforeUnload).toHaveBeenCalledWith(
          'load_failed_retry_clicked',
          expect.objectContaining({
            feature_area: 'macro',
            surface: 'viewer',
            content_id: 'content-123',
            retry_attempt: 1,
          }),
        )
        expect(reloadViewer).toHaveBeenCalledOnce()
        expect(order).toEqual(['track', 'reload'])
      })

      // A blocked or slow beacon must not strand the user on the failed panel.
      it('reloads even when tracking rejects', async () => {
        vi.mocked(trackAnalyticsEventBeforeUnload).mockRejectedValueOnce(new Error('blocked'))
        store.state.viewerLoadState = 'failed_with_source'
        const wrapper = mountTracked()
        await wrapper.find('[data-testid="load-failed-retry"]').trigger('click')
        await flushPromises()
        expect(reloadViewer).toHaveBeenCalledOnce()
      })

      it('reports a diagram that came back after the reload', async () => {
        startRetryMarker('content-123')
        store.state.viewerLoadState = 'ready'
        mountTracked()
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(trackAnalyticsEvent).toHaveBeenCalledWith(
          'load_failed_retry_resolved',
          expect.objectContaining({ retry_outcome: 'recovered', retry_attempt: 1 }),
        )
        expect(readRetryMarker('content-123')).toBeNull()
      })

      it('reports a failure that survived the reload and numbers the next retry 2', async () => {
        startRetryMarker('content-123')
        store.state.viewerLoadState = 'failed_with_source'
        const wrapper = mountTracked()
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(trackAnalyticsEvent).toHaveBeenCalledWith(
          'load_failed_retry_resolved',
          expect.objectContaining({ retry_outcome: 'failed_again', retry_attempt: 1 }),
        )
        await wrapper.find('[data-testid="load-failed-retry"]').trigger('click')
        await flushPromises()
        expect(trackAnalyticsEventBeforeUnload).toHaveBeenCalledWith(
          'load_failed_retry_clicked',
          expect.objectContaining({ retry_attempt: 2 }),
        )
      })

      it('reports nothing when the viewer remounts without a retry', async () => {
        store.state.viewerLoadState = 'ready'
        mountTracked()
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(trackAnalyticsEvent).not.toHaveBeenCalledWith(
          'load_failed_retry_resolved',
          expect.anything(),
        )
      })
    })
  })

  // Task 6 (docs/superpowers/sdd/2026-07-26-embed-deeplink-productization):
  // mints https://<host>/d/<cloudId>/<contentId> — the bare deeplink, never
  // the ticketed /deeplink-ticket share-preview URL — and copies it via the
  // same copyToClipboard/toast pattern as Copy page link.
  describe('Copy diagram link (task 6)', () => {
    let originalClipboard: PropertyDescriptor | undefined
    let originalIsSecureContext: PropertyDescriptor | undefined
    let writeText: ReturnType<typeof vi.fn>

    beforeEach(() => {
      originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
      originalIsSecureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext')
      writeText = vi.fn(() => Promise.resolve())
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
      Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    })

    afterEach(() => {
      vi.unstubAllEnvs()
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
      else delete (navigator as any).clipboard
      if (originalIsSecureContext) Object.defineProperty(window, 'isSecureContext', originalIsSecureContext)
      else delete (window as any).isSecureContext
      delete (document as any).execCommand
    })

    it.each([
      ['lite', 'conf-lite.zenuml.com'],
      ['diagramly', 'conf-lite.zenuml.com'],
      ['full', 'conf-full.zenuml.com'],
    ])('mints the %s-variant host, copies it, and fires deeplink_copied with link_source header_more_menu', async (productType, expectedHost) => {
      vi.stubEnv('PRODUCT_TYPE', productType)
      store.commit('updateDiagramType', DiagramType.Mermaid)
      const wrapper = mountViewer()
      await flushPromises()
      vi.mocked(trackAnalyticsEvent).mockClear()

      await clickMoreItem(wrapper, 'Copy diagram link', { clearAnalytics: true })
      await flushPromises()

      const expectedUrl = `https://${expectedHost}/d/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/987654321`
      expect(writeText).toHaveBeenCalledWith(expectedUrl)
      // The minted URL must round-trip through the SAME parser the paste-side
      // autoConvert handler uses (finding: the old 'cloud-1'/'content-123'
      // fixtures minted a URL parseEmbedDeeplink could never actually parse).
      expect(parseEmbedDeeplink(expectedUrl)).toEqual({
        cloudId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        contentId: '987654321',
      })
      expect(toast).toHaveBeenCalledWith({ message: 'Diagram link copied to clipboard', duration: 2000 })
      expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('deeplink_copied', {
        feature_area: 'macro',
        surface: 'viewer',
        macro_type: DiagramType.Mermaid,
        link_source: 'header_more_menu',
        outcome: 'copied',
      })
    })

    it('surfaces a toast on clipboard failure — never silently swallows — and fires deeplink_copied with outcome clipboard_failed', async () => {
      vi.stubEnv('PRODUCT_TYPE', 'lite')
      writeText.mockRejectedValueOnce(new Error('denied'))
      ;(document as any).execCommand = () => { throw new Error('execCommand unavailable') }
      const wrapper = mountViewer()
      await flushPromises()
      vi.mocked(trackAnalyticsEvent).mockClear()

      await expect(
        clickMoreItem(wrapper, 'Copy diagram link', { clearAnalytics: true }),
      ).resolves.not.toThrow()
      await flushPromises()

      expect(toast).toHaveBeenCalledWith({ message: 'Failed to copy diagram link', duration: 2000 })
      expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('deeplink_copied', {
        feature_area: 'macro',
        surface: 'viewer',
        macro_type: DiagramType.Sequence,
        link_source: 'header_more_menu',
        outcome: 'clipboard_failed',
      })
    })

    // getContext() memoizes on forgeRuntime.forgeContext (see forgeGlobal.ts)
    // and by this point in the file it's already cached from the tests
    // above, so mutating it directly (rather than re-mocking '@forge/bridge')
    // is the only way to exercise an unresolvable cloudId without disturbing
    // every other test's fixture.
    it('surfaces a toast (never a thrown error) when cloudId cannot be resolved, and fires deeplink_copied with outcome unavailable', async () => {
      vi.stubEnv('PRODUCT_TYPE', 'lite')
      const originalCloudId = (forgeRuntime as any).forgeContext?.cloudId
      ;(forgeRuntime as any).forgeContext = { ...(forgeRuntime as any).forgeContext, cloudId: undefined }
      try {
        const wrapper = mountViewer()
        await flushPromises()
        vi.mocked(trackAnalyticsEvent).mockClear()

        await expect(
          clickMoreItem(wrapper, 'Copy diagram link', { clearAnalytics: true }),
        ).resolves.not.toThrow()
        await flushPromises()

        expect(writeText).not.toHaveBeenCalled()
        expect(toast).toHaveBeenCalledWith({ message: 'Diagram link not available', duration: 2000 })
        expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(trackAnalyticsEvent)).toHaveBeenCalledWith('deeplink_copied', {
          feature_area: 'macro',
          surface: 'viewer',
          macro_type: DiagramType.Sequence,
          link_source: 'header_more_menu',
          outcome: 'unavailable',
        })
      } finally {
        (forgeRuntime as any).forgeContext = { ...(forgeRuntime as any).forgeContext, cloudId: originalCloudId }
      }
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

    // The rail is 316px + a 16px gap of the fullscreen width. ConnectPanel has no
    // `idle` branch, so before a session exists it renders nothing at all — and the
    // only way to start one is the small-macro Connect button, which is hidden in
    // fullscreen. A blank 332px column stayed reserved next to the diagram, which is
    // why a wide PlantUML diagram started scrolling well before it ran out of window.
    // The fullscreen column is capped at 1000px so the byline under the diagram stays
    // a readable line length. A PlantUML diagram that overflows that column gains
    // nothing from the cap — it just scrolls sooner while the window sits unused, so
    // the capture box drops the cap for that case (the byline keeps it).
    it('lets an overflowing PlantUML diagram use the full fullscreen width', async () => {
      setFullscreen(true)
      store.commit('updateDiagramType', DiagramType.PlantUml)
      const wrapper = mountViewer()
      await flushPromises()

      expect(wrapper.find('.screen-capture-content').classes())
        .toContain('screen-capture-content--uncapped')
    })

    it('lets a Graph diagram use the full fullscreen width too', async () => {
      setFullscreen(true)
      store.commit('updateDiagramType', DiagramType.Graph)
      const wrapper = mountViewer()
      await flushPromises()

      expect(wrapper.find('.screen-capture-content').classes())
        .toContain('screen-capture-content--uncapped')
    })

    // ZEN-1207: mermaid was grouped with the text types and kept the 1000px cap, but it
    // is a rendered picture that scales down into its column — in a 1920px window it drew
    // into 1000px while PlantUML got 1864px, and no zoom control exists to recover the
    // difference. It belongs with Graph, not with the line-by-line text types.
    it('lets a Mermaid diagram use the full fullscreen width', async () => {
      setFullscreen(true)
      store.commit('updateDiagramType', DiagramType.Mermaid)
      const wrapper = mountViewer()
      await flushPromises()

      expect(wrapper.find('.screen-capture-content').classes())
        .toContain('screen-capture-content--uncapped')
    })

    it('keeps the 1000px column for the text-bearing diagram types', async () => {
      setFullscreen(true)
      const wrapper = mountViewer()
      await flushPromises()

      expect(wrapper.find('.screen-capture-content').classes())
        .not.toContain('screen-capture-content--uncapped')

      for (const type of [DiagramType.OpenApi]) {
        store.commit('updateDiagramType', type)
        const w = mountViewer()
        await flushPromises()
        expect(w.find('.screen-capture-content').classes())
          .not.toContain('screen-capture-content--uncapped')
      }
    })

    it('collapses the Fullscreen rail while the panel is idle', async () => {
      // readAnySession() scans every localStorage key, so a handoff left behind by
      // another spec file hydrates this mount to `waiting` and there is no idle state
      // left to assert. The suite's beforeEach only clears sessionStorage.
      localStorage.clear()
      setFullscreen(true)
      vi.mocked(isAgentLinkEnabled).mockResolvedValueOnce(true)
      const wrapper = mountViewer()
      await flushPromises()

      const rail = wrapper.find('[data-testid="agent-link-fullscreen-rail"]')
      expect(rail.exists()).toBe(true)
      expect(rail.classes()).toContain('agent-link-rail--collapsed')
      expect(wrapper.find('.viewer-body').classes()).not.toContain('viewer-body--with-agent-rail')
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

    it('reserves the rail width once a session exists', async () => {
      setFullscreenWithPageId('page-123')
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

      const rail = wrapper.find('[data-testid="agent-link-fullscreen-rail"]')
      expect(rail.classes()).not.toContain('agent-link-rail--collapsed')
      expect(wrapper.find('.viewer-body').classes()).toContain('viewer-body--with-agent-rail')
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

describe('GenericViewer — Export PNG routes through Fullscreen', () => {
  // The export dialog cannot be operated inside the inline macro: the iframe is
  // 564x256 on production page 2774138946, and the annotation controls end up in
  // a 24px scroller over 312px of form. Rendering it in flow instead grows the
  // iframe but pushes the preview out of view while the controls are edited, so
  // the export UI belongs on the surface that has room — the Fullscreen modal.
  it('opens Fullscreen carrying openExport instead of the inline dialog', async () => {
    const wrapper = mountViewer()
    const emitted: unknown[] = []
    const handler = (payload: unknown) => emitted.push(payload)
    EventBus.$on('fullscreen', handler)

    await wrapper.vm.openExport()

    expect(emitted).toEqual([{ openExport: true }])
    expect(wrapper.vm.showExportModal).toBe(false)
    EventBus.$off('fullscreen', handler)
    wrapper.unmount()
  })

  it('opens the dialog in place when already in Fullscreen', async () => {
    window.forgeGlobal = {
      ...(window.forgeGlobal || {}),
      forgeContext: { extension: { modal: { macroMode: 'fullscreen' } } },
    }
    const wrapper = mountViewer()
    const emitted: unknown[] = []
    const handler = (payload: unknown) => emitted.push(payload)
    EventBus.$on('fullscreen', handler)

    await wrapper.vm.openExport()

    expect(wrapper.vm.showExportModal).toBe(true)
    expect(emitted).toEqual([])
    EventBus.$off('fullscreen', handler)
    wrapper.unmount()
    delete window.forgeGlobal.forgeContext.extension.modal
  })
})

describe('GenericViewer — auto-opening the export dialog in Fullscreen', () => {
  function inFullscreen(openExport: boolean) {
    window.forgeGlobal = {
      ...(window.forgeGlobal || {}),
      forgeContext: { extension: { modal: { macroMode: 'fullscreen', openExport } } },
    }
  }

  afterEach(() => {
    if (window.forgeGlobal?.forgeContext?.extension) {
      delete window.forgeGlobal.forgeContext.extension.modal
    }
  })

  it('covers the viewer immediately, then enables preview capture when the diagram is ready', async () => {
    // The export-entry route intentionally skips the fullscreen paywall. Its
    // opaque export surface must therefore cover viewer controls immediately;
    // only the preview capture waits for the renderer readiness signal.
    inFullscreen(true)
    const wrapper = mountViewer()
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.showExportModal).toBe(true)
    expect(wrapper.vm.exportPreviewReady).toBe(false)

    EventBus.$emit('diagramLoaded', 'A->B: hi', DiagramType.Sequence)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.showExportModal).toBe(true)
    expect(wrapper.vm.exportPreviewReady).toBe(true)
    wrapper.unmount()
  })

  it('opens once, so closing it does not reopen on the next render', async () => {
    inFullscreen(true)
    const wrapper = mountViewer()
    EventBus.$emit('diagramLoaded', 'A->B: hi', DiagramType.Sequence)
    await wrapper.vm.$nextTick()
    wrapper.vm.showExportModal = false

    EventBus.$emit('diagramLoaded', 'A->B: hi', DiagramType.Sequence)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.showExportModal).toBe(false)
    wrapper.unmount()
  })

  it('does not reopen when dismissed before renderer readiness', async () => {
    inFullscreen(true)
    const wrapper = mountViewer()
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.exportPreviewReady).toBe(false)

    await wrapper.vm.onExportModalClose()
    EventBus.$emit('diagramLoaded', 'A->B: hi', DiagramType.Sequence)
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.showExportModal).toBe(false)
    wrapper.unmount()
  })

  it('opens on viewerRenderSettled, the readiness signal Graph and OpenAPI emit', async () => {
    inFullscreen(true)
    const wrapper = mountViewer()
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.showExportModal).toBe(true)
    expect(wrapper.vm.exportPreviewReady).toBe(false)

    EventBus.$emit('viewerRenderSettled', 'graph')
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.showExportModal).toBe(true)
    expect(wrapper.vm.exportPreviewReady).toBe(true)
    wrapper.unmount()
  })

  it('opens on the last-resort floor when a renderer never reports at all', async () => {
    // A crashed DrawIO boot or a SwaggerUI throw emits nothing; without the
    // floor the user sits in Fullscreen with no dialog and no way to one.
    vi.useFakeTimers()
    inFullscreen(true)
    const wrapper = mountViewer()
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.showExportModal).toBe(true)
    expect(wrapper.vm.exportPreviewReady).toBe(false)

    vi.advanceTimersByTime(15000)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.showExportModal).toBe(true)
    expect(wrapper.vm.exportPreviewReady).toBe(true)
    vi.useRealTimers()
    wrapper.unmount()
  })

  it('closes the whole Fullscreen modal when an export-entry dialog is dismissed', async () => {
    // The export route skips the fullscreen-viewer paywall, so the fullscreen
    // viewer behind the dialog must not become a way to read a saturated Lite
    // space for free: dismissing the dialog leaves the modal, it does not
    // reveal what the gate protects.
    inFullscreen(true)
    const wrapper = mountViewer()
    const closes: unknown[] = []
    const handler = () => closes.push(true)
    EventBus.$on('closeFullscreen', handler)

    EventBus.$emit('diagramLoaded', 'A->B: hi', DiagramType.Sequence)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.showExportModal).toBe(true)

    await wrapper.vm.onExportModalClose()
    expect(wrapper.vm.showExportModal).toBe(false)
    expect(closes).toHaveLength(1)
    EventBus.$off('closeFullscreen', handler)
    wrapper.unmount()
  })

  it('keeps the Fullscreen viewer open when the dialog was opened by hand there', async () => {
    inFullscreen(false)
    const wrapper = mountViewer()
    const closes: unknown[] = []
    const handler = () => closes.push(true)
    EventBus.$on('closeFullscreen', handler)

    await wrapper.vm.openExport()
    expect(wrapper.vm.showExportModal).toBe(true)
    await wrapper.vm.onExportModalClose()

    expect(wrapper.vm.showExportModal).toBe(false)
    expect(closes).toHaveLength(0)
    EventBus.$off('closeFullscreen', handler)
    wrapper.unmount()
  })

  it('leaves the dialog closed for an ordinary Fullscreen open', async () => {
    inFullscreen(false)
    const wrapper = mountViewer()
    EventBus.$emit('diagramLoaded', 'A->B: hi', DiagramType.Sequence)
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.showExportModal).toBe(false)
    wrapper.unmount()
  })
})

describe('GenericViewer embed detection', () => {
  const source = readFileSync(resolve(__dirname, './GenericViewer.vue'), 'utf-8')

  it('uses a Forge moduleKey-based embed detection (inline or via isEmbedMode helper)', () => {
    // The viewer uses inline regex on forgeContext.moduleKey instead of importing
    // the isEmbedMode helper — both are equivalent; accept either pattern.
    const usesHelper = /isEmbedMode/.test(source)
    const usesInline = /moduleKey/.test(source) && /embed-macro/.test(source)
    expect(usesHelper || usesInline).toBe(true)
  })
})
