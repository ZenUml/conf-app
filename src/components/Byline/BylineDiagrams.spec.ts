import { mount, enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import BylineDiagrams from '@/components/Byline/BylineDiagrams.vue';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { openModal } from '@/model/globals/forgeGlobal';
import { DiagramType } from '@/model/Diagram/Diagram';
import { readUnplacedMarker } from '@/utils/byline/unplacedMarker';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

const apWrapper = vi.hoisted(() => ({
  _getCurrentPageId: vi.fn(async () => 'page-1'),
  listPageDiagramContents: vi.fn(async () => [] as any[]),
  getAttachmentsV2: vi.fn(async () => []),
  referencedCustomContentIds: vi.fn(async () => undefined as string[] | undefined),
}));
vi.mock('@/model/globals', () => ({ default: { apWrapper } }));

const forgeGlobalMock = vi.hoisted(() => ({ forgeContext: { cloudId: 'cloud-1' } as any }));
vi.mock('@/model/globals/forgeGlobal', () => ({
  default: forgeGlobalMock,
  openModal: vi.fn(async () => {}),
}));

// Thumbnails are a separate, deliberately non-blocking concern; stubbed so the
// list assertions below are not racing image fetches.
vi.mock('@/utils/byline/thumbnails', () => ({
  indexThumbnails: vi.fn(() => []),
  fetchThumbnailDataUrl: vi.fn(async () => ''),
}));

const spaceKey = vi.hoisted(() => ({ value: 'SPACE' }));
vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  NO_SPACE_CONTEXT: 'no_space_context',
  getSpaceKey: () => spaceKey.value,
  getClientDomain: () => 'example-tenant',
}));

const routerNavigate = vi.hoisted(() => vi.fn(async () => {}));
const viewClose = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@forge/bridge', () => ({
  router: { navigate: routerNavigate, open: vi.fn() },
  view: { close: viewClose },
}));

const child = (id: string, title: string, diagramType: string, code = 'A->B: hi') => ({
  id,
  title,
  body: { raw: { value: JSON.stringify({ diagramType, code }) } },
});
const ok = (...children: any[]) => ({ results: children });
/** What a 403 actually looks like on this path: forgeRequest resolves the error
 *  body rather than throwing, so nothing rejects. */
const forbidden = { errors: [{ status: 403, title: 'Forbidden' }] };

const events = (name: string) =>
  vi.mocked(trackAnalyticsEvent).mock.calls.filter(([n]) => n === name);

async function mountByline() {
  const wrapper = mount(BylineDiagrams);
  await flushPromises();
  return wrapper;
}

/** Run the modal's onClose, which is what drives the post-create diff. */
async function closeEditor() {
  const opts = vi.mocked(openModal).mock.calls.at(-1)?.[0] as any;
  await opts.onClose();
  await flushPromises();
}

describe('BylineDiagrams', () => {
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    spaceKey.value = 'SPACE';
    forgeGlobalMock.forgeContext = { cloudId: 'cloud-1' };
    apWrapper._getCurrentPageId.mockResolvedValue('page-1');
    apWrapper.listPageDiagramContents.mockResolvedValue([]);
    apWrapper.getAttachmentsV2.mockResolvedValue([]);
    apWrapper.referencedCustomContentIds.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => {}) },
      configurable: true,
    });
  });

  describe('the listing readout', () => {
    it('fires byline_opened exactly once per open, no matter how many retries', async () => {
      // byline_opened IS the Phase 1 readout. The retry button re-runs the same
      // loader, so an unguarded emit counted a retry as a second open — and only
      // users who hit a load failure can retry, so the inflation biased the
      // primary metric toward the failure population.
      apWrapper.listPageDiagramContents.mockResolvedValue([forbidden]);
      const wrapper = await mountByline();
      expect(events('byline_opened')).toHaveLength(1);

      apWrapper.listPageDiagramContents.mockResolvedValue([ok(child('1', 'Login', DiagramType.Sequence))]);
      await wrapper.find('[data-testid="byline-retry"]').trigger('click');
      await flushPromises();

      expect(events('byline_opened')).toHaveLength(1);
      expect(events('byline_list_retried')).toHaveLength(1);
      expect(events('byline_list_retried')[0][1]).toMatchObject({ result: 'recovered' });
    });

    it('reports an unreadable page as unknown, not as a page with no diagrams', async () => {
      apWrapper.listPageDiagramContents.mockResolvedValue([forbidden, forbidden]);
      const wrapper = await mountByline();

      // Without listing health this is indistinguishable from an empty page in
      // both the UI and Mixpanel: nothing rejected and diagram_count is 0.
      expect(wrapper.find('[data-testid="byline-failed"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="byline-empty"]').exists()).toBe(false);
      expect(events('byline_opened')[0][1]).toMatchObject({
        listing_failed: true,
        failed_type_count: 2,
        diagram_count: 0,
      });
    });

    it('still calls a genuinely empty page empty', async () => {
      apWrapper.listPageDiagramContents.mockResolvedValue([ok(), ok()]);
      const wrapper = await mountByline();

      expect(wrapper.find('[data-testid="byline-empty"]').exists()).toBe(true);
      expect(events('byline_opened')[0][1]).toMatchObject({ listing_failed: false });
    });

    it('treats empty survivors plus a failed type as unknown, not empty', async () => {
      // A graphs-only page whose graph listing 403s while the sequence listing
      // succeeds with nothing: whether the page is empty is unknown — the
      // failed type may hold ALL of its diagrams. "Nothing diagrammed here
      // yet" would be the clean-empty-wrong answer in partial form.
      apWrapper.listPageDiagramContents.mockResolvedValue([ok(), forbidden]);
      const wrapper = await mountByline();

      expect(wrapper.find('[data-testid="byline-failed"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="byline-empty"]').exists()).toBe(false);
      expect(events('byline_opened')[0][1]).toMatchObject({
        listing_failed: false,
        failed_type_count: 1,
        diagram_count: 0,
      });
    });

    it('renders the survivors when a type fails but another has rows', async () => {
      // An incomplete list beats a false error: with any survivor row the list
      // shows, and diagram_count keeps the readout honest.
      apWrapper.listPageDiagramContents.mockResolvedValue([
        ok(child('1', 'Login', DiagramType.Sequence)),
        forbidden,
      ]);
      const wrapper = await mountByline();

      expect(wrapper.find('[data-testid="byline-failed"]').exists()).toBe(false);
      expect(wrapper.findAll('[data-testid="byline-item"]')).toHaveLength(1);
    });
  });

  describe('dismissal tracking', () => {
    it('fires byline_dismissed on pagehide — the only signal that exists in production', async () => {
      // Closing the Forge modal destroys the iframe without unmounting Vue, so
      // onBeforeUnmount alone never runs outside tests; pagehide is the real
      // dismissal path.
      await mountByline();

      window.dispatchEvent(new Event('pagehide'));

      expect(events('byline_dismissed')).toHaveLength(1);
    });

    it('does not double-fire when unmount follows pagehide', async () => {
      const wrapper = await mountByline();

      window.dispatchEvent(new Event('pagehide'));
      wrapper.unmount();

      expect(events('byline_dismissed')).toHaveLength(1);
    });

    it('stays silent on a productive open', async () => {
      apWrapper.listPageDiagramContents.mockResolvedValue([ok()]);
      const wrapper = await mountByline();
      await wrapper.find('[data-testid="byline-type-sequence"]').trigger('click');
      await flushPromises();

      window.dispatchEvent(new Event('pagehide'));
      wrapper.unmount();

      expect(events('byline_dismissed')).toHaveLength(0);
    });
  });

  describe('copying a diagram\'s source', () => {
    it('is not counted as opening the diagram', async () => {
      apWrapper.listPageDiagramContents.mockResolvedValue([ok(child('1', 'Login', DiagramType.Sequence))]);
      const wrapper = await mountByline();

      await wrapper.find('[data-testid="byline-copy-source"]').trigger('click');
      await flushPromises();

      expect(events('byline_diagram_source_copied')).toHaveLength(1);
      expect(events('byline_diagram_opened')).toHaveLength(0);
    });
  });

  describe('after the byline editor closes', () => {
    async function openEditorFrom(wrapper: any) {
      await wrapper.find('[data-testid="byline-type-sequence"]').trigger('click');
      await flushPromises();
    }

    it('hands back a typed deeplink, not the read-only embed form', async () => {
      apWrapper.listPageDiagramContents.mockResolvedValue([ok()]);
      const wrapper = await mountByline();
      await openEditorFrom(wrapper);

      apWrapper.listPageDiagramContents.mockResolvedValue([
        ok(child('99', 'New', DiagramType.Sequence)),
      ]);
      await closeEditor();

      // 4-segment /d/<type>/<cloudId>/<id>. The old 3-segment fallback was
      // called with two arguments against a (host, cloudId, contentId)
      // signature, producing `https://<cloudId>/d/<id>/undefined`.
      const link = wrapper.find('[data-testid="byline-created-link"]').text();
      expect(link).toBe('https://confluence.zenuml.com/d/sequence/cloud-1/99');
      expect(link).not.toContain('undefined');
      expect(events('byline_diagram_created')[0][1]).toMatchObject({ result: 'linked' });
    });

    it('reports no_cloud_id instead of handing over an unusable link', async () => {
      // The fallback always returned a non-empty string, so this branch was
      // unreachable and `result` was always 'linked'.
      forgeGlobalMock.forgeContext = { cloudId: undefined };
      apWrapper.listPageDiagramContents.mockResolvedValue([ok()]);
      const wrapper = await mountByline();
      await openEditorFrom(wrapper);

      apWrapper.listPageDiagramContents.mockResolvedValue([
        ok(child('99', 'New', DiagramType.Sequence)),
      ]);
      await closeEditor();

      expect(events('byline_diagram_created')[0][1]).toMatchObject({ result: 'no_cloud_id' });
      expect(wrapper.find('[data-testid="byline-created"]').exists()).toBe(false);
    });

    it('does not report a save as a cancellation when the re-read fails', async () => {
      apWrapper.listPageDiagramContents.mockResolvedValue([
        ok(child('1', 'Existing', DiagramType.Sequence)),
      ]);
      const wrapper = await mountByline();
      await openEditorFrom(wrapper);

      apWrapper.listPageDiagramContents.mockResolvedValue([forbidden]);
      await closeEditor();

      // The user's diagram may exist and already be counted against the Lite
      // limit. Treating the unreadable re-read as "no new id" wiped the list,
      // emitted byline_create_cancelled for a saved diagram, and left no link.
      expect(events('byline_create_cancelled')).toHaveLength(0);
      expect(events('byline_diagram_created')[0][1]).toMatchObject({ result: 'listing_failed' });
      expect(wrapper.find('[data-testid="byline-create-unresolved"]').exists()).toBe(true);
    });

    it('holds an unresolved create when the re-read is partial and finds no new id', async () => {
      // The save may have landed in exactly the type that errored; calling it
      // cancelled would fire byline_create_cancelled for a saved diagram —
      // the total-failure inversion, in partial form.
      apWrapper.listPageDiagramContents.mockResolvedValue([
        ok(child('1', 'Existing', DiagramType.Sequence)),
      ]);
      const wrapper = await mountByline();
      await openEditorFrom(wrapper);

      apWrapper.listPageDiagramContents.mockResolvedValue([
        ok(child('1', 'Existing', DiagramType.Sequence)),
        forbidden,
      ]);
      await closeEditor();

      expect(events('byline_create_cancelled')).toHaveLength(0);
      expect(events('byline_diagram_created')[0][1]).toMatchObject({ result: 'listing_partial' });
      expect(wrapper.find('[data-testid="byline-create-unresolved"]').exists()).toBe(true);
    });

    it('a found id proves the save even when another type failed', async () => {
      apWrapper.listPageDiagramContents.mockResolvedValue([
        ok(child('1', 'Existing', DiagramType.Sequence)),
      ]);
      const wrapper = await mountByline();
      await openEditorFrom(wrapper);

      apWrapper.listPageDiagramContents.mockResolvedValue([
        ok(child('1', 'Existing', DiagramType.Sequence), child('99', 'New', DiagramType.Sequence)),
        forbidden,
      ]);
      await closeEditor();

      expect(wrapper.find('[data-testid="byline-created"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="byline-create-unresolved"]').exists()).toBe(false);
    });

    it('re-runs the diff against the original snapshot on retry', async () => {
      apWrapper.listPageDiagramContents.mockResolvedValue([
        ok(child('1', 'Existing', DiagramType.Sequence)),
      ]);
      const wrapper = await mountByline();
      await openEditorFrom(wrapper);

      apWrapper.listPageDiagramContents.mockResolvedValue([forbidden]);
      await closeEditor();

      apWrapper.listPageDiagramContents.mockResolvedValue([
        ok(child('1', 'Existing', DiagramType.Sequence), child('99', 'New', DiagramType.Sequence)),
      ]);
      await wrapper.find('[data-testid="byline-retry-create"]').trigger('click');
      await flushPromises();

      // '99' is only new relative to the pre-editor snapshot, so the retry has
      // to reuse it rather than re-baseline against the failed read.
      expect(wrapper.find('[data-testid="byline-created-link"]').text()).toContain('/99');
      expect(events('byline_create_cancelled')).toHaveLength(0);
    });

    it('still reports a real cancellation', async () => {
      apWrapper.listPageDiagramContents.mockResolvedValue([ok()]);
      const wrapper = await mountByline();
      await openEditorFrom(wrapper);
      await closeEditor();

      expect(events('byline_create_cancelled')).toHaveLength(1);
      expect(wrapper.find('[data-testid="byline-create-unresolved"]').exists()).toBe(false);
    });
  });

  describe('the paste link on the clipboard', () => {
    async function reachCreatedPanel() {
      apWrapper.listPageDiagramContents.mockResolvedValue([ok()]);
      const wrapper = await mountByline();
      await wrapper.find('[data-testid="byline-type-sequence"]').trigger('click');
      await flushPromises();
      apWrapper.listPageDiagramContents.mockResolvedValue([
        ok(child('99', 'New', DiagramType.Sequence)),
      ]);
      await closeEditor();
      return wrapper;
    }

    it('copies the link for the user as soon as the diagram is saved', async () => {
      const wrapper = await reachCreatedPanel();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'https://confluence.zenuml.com/d/sequence/cloud-1/99',
      );
      expect(events('advocacy_message_copied')).toHaveLength(1);
      expect(events('advocacy_message_copied')[0][1]).toMatchObject({
        ui_component: 'byline_created_link',
        copy_trigger: 'auto',
        result: 'copied',
      });
      expect(wrapper.find('[data-testid="byline-copy-link"]').text()).toContain('Copied');
    });

    it('returns the button to a clickable state so the link can be re-copied', async () => {
      // The automatic copy happens once. Anything the user copies afterwards
      // replaces it, and a button latched on '✓ Copied' reads as done — no
      // signal that clicking again would help, and no feedback when they do.
      vi.useFakeTimers();
      try {
        const wrapper = await reachCreatedPanel();
        expect(wrapper.find('[data-testid="byline-copy-link"]').text()).toContain('Copied');

        vi.advanceTimersByTime(2000);
        await wrapper.vm.$nextTick();
        expect(wrapper.find('[data-testid="byline-copy-link"]').text()).toBe('Copy');
      } finally {
        vi.useRealTimers();
      }
    });

    it('re-copies on demand and reports it as a separate trigger', async () => {
      const wrapper = await reachCreatedPanel();
      vi.mocked(navigator.clipboard.writeText).mockClear();

      await wrapper.find('[data-testid="byline-copy-link"]').trigger('click');
      await flushPromises();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'https://confluence.zenuml.com/d/sequence/cloud-1/99',
      );
      expect(events('advocacy_message_copied').at(-1)?.[1]).toMatchObject({
        copy_trigger: 'manual',
        result: 'copied',
      });
    });

    it('keeps the button usable when the automatic copy is refused', async () => {
      // The save-time write is not user-gesture-initiated, so the Forge iframe
      // can refuse it. The manual click is, which is the whole reason the
      // button has to survive an auto-copy failure.
      vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const wrapper = await reachCreatedPanel();

      expect(events('advocacy_message_copied')[0][1]).toMatchObject({
        copy_trigger: 'auto',
        result: 'failed',
      });
      expect(wrapper.find('[data-testid="byline-copy-link"]').text()).toBe('Copy');

      await wrapper.find('[data-testid="byline-copy-link"]').trigger('click');
      await flushPromises();

      expect(events('advocacy_message_copied').at(-1)?.[1]).toMatchObject({
        copy_trigger: 'manual',
        result: 'copied',
      });
      consoleErrorSpy.mockRestore();
    });
  });

  describe('when the byline is opened from inside the page editor', () => {
    // A real Confluence editor URL carries the NUMERIC content id, which is
    // what separates it from a view URL whose last segment is the page title.
    const EDIT_URL = 'https://example.atlassian.net/wiki/spaces/SPACE/pages/edit-v2/703430669';

    async function reachCreatedPanel() {
      apWrapper.listPageDiagramContents.mockResolvedValue([ok()]);
      const wrapper = await mountByline();
      await wrapper.find('[data-testid="byline-type-sequence"]').trigger('click');
      await flushPromises();
      apWrapper.listPageDiagramContents.mockResolvedValue([
        ok(child('99', 'New', DiagramType.Sequence)),
      ]);
      await closeEditor();
      return wrapper;
    }

    it('does not offer to open the editor the user is already in', async () => {
      forgeGlobalMock.forgeContext = { cloudId: 'cloud-1', extension: { location: EDIT_URL } };
      const wrapper = await reachCreatedPanel();

      // Taking that button would navigate to where they already are, reloading
      // the editor they were typing in.
      expect(wrapper.find('[data-testid="byline-open-editor"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="byline-created-done"]').text()).toBe('Done');
      // The link is still there to copy — the paste is the whole remaining step.
      expect(wrapper.find('[data-testid="byline-created-link"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="byline-created-sub-editing"]').text()).toContain(
        'Paste the link where you want it',
      );
    });

    it('still offers the handoff from a view-mode page', async () => {
      forgeGlobalMock.forgeContext = {
        cloudId: 'cloud-1',
        extension: { location: 'https://example.atlassian.net/wiki/spaces/SPACE/pages/703430669/Title' },
      };
      const wrapper = await reachCreatedPanel();

      expect(wrapper.find('[data-testid="byline-open-editor"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="byline-created-sub-editing"]').exists()).toBe(false);
    });

    it('closes the byline view when Done is pressed, instead of falling back to the list', async () => {
      // Reported from whimet4: Done cleared the created panel, which fell
      // through to "Diagrams on this page" — a panel sitting over the page the
      // user needs to click into to paste. In the editor the flow is finished.
      forgeGlobalMock.forgeContext = { cloudId: 'cloud-1', extension: { location: EDIT_URL } };
      const wrapper = await reachCreatedPanel();

      await wrapper.find('[data-testid="byline-created-done"]').trigger('click');
      await flushPromises();

      expect(viewClose).toHaveBeenCalled();
      expect(events('byline_view_close_requested')[0][1]).toMatchObject({ result: 'closed' });
      // Never the index, under any close outcome.
      expect(wrapper.find('[data-testid="byline-list"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="byline-empty"]').exists()).toBe(false);
    });

    it('lands on a terminal state, never the index, when the close is not honoured', async () => {
      // Forge documents view.close() as a *request* and says nothing about
      // contentBylineItem, so a no-op is possible. The state reset must not be
      // conditional on it, or a refused close would strand the user on the
      // created panel — strictly worse than the list it replaced.
      viewClose.mockRejectedValueOnce(new Error('not supported here'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      forgeGlobalMock.forgeContext = { cloudId: 'cloud-1', extension: { location: EDIT_URL } };
      const wrapper = await reachCreatedPanel();

      await wrapper.find('[data-testid="byline-created-done"]').trigger('click');
      await flushPromises();

      // A resolved-but-ignored close() is undetectable, so the fallback must be
      // a terminal state rather than the diagram index the user just left.
      expect(wrapper.find('[data-testid="byline-finished"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="byline-list"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="byline-empty"]').exists()).toBe(false);
      // The link stays available — pasting it is the whole remaining step.
      expect(wrapper.find('[data-testid="byline-created-link"]').exists()).toBe(true);
      // Done is spent; pressing it again could not change the outcome.
      expect(wrapper.find('[data-testid="byline-created-done"]').exists()).toBe(false);
      expect(events('byline_view_close_requested')[0][1]).toMatchObject({ result: 'failed' });
      consoleErrorSpy.mockRestore();
    });

    it('reports which journey this was, so the detection is verifiable', async () => {
      // Detection silently degrading to false looks identical to "nobody opens
      // the byline while editing", so it has to be readable from the data.
      forgeGlobalMock.forgeContext = { cloudId: 'cloud-1', extension: { location: EDIT_URL } };
      await reachCreatedPanel();

      expect(events('byline_opened')[0][1]).toMatchObject({ host_in_editor: true });
      expect(events('byline_diagram_created')[0][1]).toMatchObject({ host_in_editor: true });
    });
  });

  describe('the editor handoff', () => {
    async function reachCreatedPanel() {
      apWrapper.listPageDiagramContents.mockResolvedValue([ok()]);
      const wrapper = await mountByline();
      await wrapper.find('[data-testid="byline-type-sequence"]').trigger('click');
      await flushPromises();
      apWrapper.listPageDiagramContents.mockResolvedValue([
        ok(child('99', 'New', DiagramType.Sequence)),
      ]);
      await closeEditor();
      return wrapper;
    }

    it('does not navigate into the no_space_context sentinel', async () => {
      // getSpaceKey returns the sentinel STRING, so the old `|| ''` never fired
      // and the handoff navigated to /wiki/spaces/no_space_context/... — a 404,
      // reported as result: 'after_create'.
      spaceKey.value = 'no_space_context';
      const wrapper = await reachCreatedPanel();

      await wrapper.find('[data-testid="byline-open-editor"]').trigger('click');
      await flushPromises();

      expect(routerNavigate).not.toHaveBeenCalled();
      expect(events('byline_editor_deeplinked').at(-1)?.[1]).toMatchObject({
        result: 'failed',
        failure_reason: 'no_space_context',
      });
      expect(wrapper.find('[data-testid="byline-nav-failed"]').exists()).toBe(true);
    });

    it('navigates when a real space key is available', async () => {
      const wrapper = await reachCreatedPanel();

      await wrapper.find('[data-testid="byline-open-editor"]').trigger('click');
      await flushPromises();

      expect(routerNavigate).toHaveBeenCalledWith('/wiki/spaces/SPACE/pages/edit-v2/page-1');
      expect(events('byline_editor_deeplinked').at(-1)?.[1]).toMatchObject({ result: 'after_create' });
    });

    it('closes the byline view from a view-mode page too', async () => {
      // "Not now" means the user is finished with the panel. The diagram is
      // saved, so the answer is to get the popup off the page — not to swap it
      // for the diagram list, which is a screen they did not ask for.
      const wrapper = await reachCreatedPanel();

      await wrapper.find('[data-testid="byline-created-done"]').trigger('click');
      await flushPromises();

      expect(viewClose).toHaveBeenCalled();
      expect(events('byline_view_close_requested')[0][1]).toMatchObject({
        result: 'closed',
        host_in_editor: false,
      });
    });

    it('falls back to the list, not a terminal state, when the close is refused', async () => {
      // The editor's fallback is a terminal panel because the list would sit
      // over the page the user must click into to paste. In view mode nothing
      // is blocked and there is nothing to paste into, so the byline's own home
      // screen is the right place to be left.
      viewClose.mockRejectedValueOnce(new Error('not supported here'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const wrapper = await reachCreatedPanel();

      await wrapper.find('[data-testid="byline-created-done"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-testid="byline-created"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="byline-finished"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="byline-list"]').exists()).toBe(true);
      expect(events('byline_view_close_requested')[0][1]).toMatchObject({ result: 'failed' });
      consoleErrorSpy.mockRestore();
    });
  });

  describe('the header', () => {
    const heading = (w: any) => w.find('[data-testid="byline-heading"]').text();

    it('names what is actually below it, in every state', async () => {
      // A pinned "Diagrams on this page" sat over "Nothing diagrammed here yet"
      // on the majority of pages — a title contradicting its own body.
      apWrapper.listPageDiagramContents.mockResolvedValue([ok()]);
      expect(heading(await mountByline())).toBe('Add a diagram to this page');

      apWrapper.listPageDiagramContents.mockResolvedValue([
        ok(child('1', 'A', DiagramType.Sequence), child('2', 'B', DiagramType.Mermaid)),
      ]);
      expect(heading(await mountByline())).toBe('2 diagrams on this page');

      apWrapper.listPageDiagramContents.mockResolvedValue([ok(child('1', 'A', DiagramType.Sequence))]);
      expect(heading(await mountByline())).toBe('1 diagram on this page');
    });

    it('names the saved diagram once there is one', async () => {
      apWrapper.listPageDiagramContents.mockResolvedValue([ok()]);
      const wrapper = await mountByline();
      await wrapper.find('[data-testid="byline-type-sequence"]').trigger('click');
      await flushPromises();
      apWrapper.listPageDiagramContents.mockResolvedValue([
        ok(child('99', 'Checkout call flow', DiagramType.Sequence)),
      ]);
      await closeEditor();

      expect(heading(wrapper)).toBe('Checkout call flow');
    });
  });

  describe('creating from the picker', () => {
    /** Mount with the listing held open, so the loading state can be asserted. */
    async function mountPending() {
      let release: (v: any) => void = () => {};
      apWrapper.listPageDiagramContents.mockReturnValue(
        new Promise(resolve => {
          release = resolve;
        }) as any,
      );
      const wrapper = mount(BylineDiagrams);
      await flushPromises();
      return { wrapper, release: async (r: any[]) => (release(r), flushPromises()) };
    }

    it('commits to neither layout while the count is unknown', async () => {
      // The empty state and the list are different LAYOUTS, not different
      // contents of one: an empty page puts the full picker in the body, a page
      // with diagrams puts the list there and demotes the picker to a strip.
      // Rendering the empty state first meant every page that HAS diagrams
      // opened on the wrong one and visibly rearranged.
      const { wrapper } = await mountPending();

      expect(wrapper.find('[data-testid="byline-loading"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="byline-empty"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="byline-list"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="byline-type-strip"]').exists()).toBe(false);
      // And no claim about the count before there is one.
      expect(wrapper.find('[data-testid="byline-heading"]').text()).toBe('Diagrams on this page');
    });

    it('promises no diagrams to a page that has none', async () => {
      // The skeleton this replaced drew four card outlines, which resolved into
      // an empty state on the majority of pages.
      const { wrapper } = await mountPending();

      expect(wrapper.find('[data-testid="byline-loading"]').text()).toBe('Reading this page…');
      expect(wrapper.findAll('[data-testid="byline-item"]')).toHaveLength(0);
    });

    it('resolves straight into the right layout', async () => {
      const empty = await mountPending();
      await empty.release([ok()]);
      expect(empty.wrapper.find('[data-testid="byline-empty"]').exists()).toBe(true);
      expect(empty.wrapper.find('[data-testid="byline-loading"]').exists()).toBe(false);

      const listed = await mountPending();
      await listed.release([ok(child('1', 'A', DiagramType.Sequence))]);
      expect(listed.wrapper.find('[data-testid="byline-list"]').exists()).toBe(true);
      expect(listed.wrapper.find('[data-testid="byline-empty"]').exists()).toBe(false);
    });

    it('leaves the empty state without a competing slash-command hint', async () => {
      // Its whole job is the first diagram; a note about /zenuml points at a
      // different way to do the same thing, right where the user is choosing.
      apWrapper.listPageDiagramContents.mockResolvedValue([ok()]);
      const wrapper = await mountByline();

      expect(wrapper.find('[data-testid="byline-empty"]').exists()).toBe(true);
      expect(wrapper.find('.byline__hint').text()).toBe('');
      // The one action there is stays.
      expect(wrapper.find('[data-testid="byline-learn-more"]').exists()).toBe(true);
    });

    it('leaves no way to create without saying which type', async () => {
      // The footer's "Add a diagram" duplicated the picker but passed no
      // macro_type, so it lost the signal the picker exists to capture AND
      // dropped the user into a sequence editor they had not asked for.
      apWrapper.listPageDiagramContents.mockResolvedValue([ok(child('1', 'A', DiagramType.Sequence))]);
      const wrapper = await mountByline();
      expect(wrapper.find('[data-testid="byline-add-diagram"]').exists()).toBe(false);

      await wrapper.find('[data-testid="byline-type-graph"]').trigger('click');
      await flushPromises();

      expect(events('byline_create_clicked')[0][1]).toMatchObject({ macro_type: 'graph' });
      const opts = vi.mocked(openModal).mock.calls.at(-1)?.[0] as any;
      expect(opts.context.diagramType).toBe('graph');
    });

    // ADR-0005 Option A put the AsyncAPI macro in Lite, and the byline is the
    // Lite-only surface. Routing is what this pins: the tile must announce
    // `asyncapi` as the modal diagramType, because that field is the ONLY
    // signal forgeIndex has here — a byline modal carries moduleKey
    // 'zenuml-byline-diagrams', so every moduleKey discriminator misses and an
    // unrecognised type falls through to the sequence editor.
    it('creates an AsyncAPI diagram from its own tile', async () => {
      apWrapper.listPageDiagramContents.mockResolvedValue([ok()]);
      const wrapper = await mountByline();

      await wrapper.find('[data-testid="byline-type-asyncapi"]').trigger('click');
      await flushPromises();

      expect(events('byline_create_clicked')[0][1]).toMatchObject({ macro_type: 'asyncapi' });
      const opts = vi.mocked(openModal).mock.calls.at(-1)?.[0] as any;
      expect(opts.context.diagramType).toBe('asyncapi');
      expect(opts.context.macroMode).toBe('editor');
    });

    it('offers a sample render for every type, not just the two that had one', async () => {
      // Graph and OpenAPI fell back to a 30px icon at 45% opacity on grey,
      // which reads as "unavailable" rather than "no preview".
      apWrapper.listPageDiagramContents.mockResolvedValue([ok()]);
      const wrapper = await mountByline();

      for (const key of ['flowchart', 'sequence', 'graph', 'openapi', 'asyncapi']) {
        const img = wrapper.find(`[data-testid="byline-type-${key}"] img`);
        expect(img.exists(), `${key} has no sample render`).toBe(true);
        expect(img.attributes('src')).toBe(`./image/byline-example-${key}.png`);
      }
    });
  });

  describe('the after-saving view', () => {
    async function reachCreatedPanel(thumb?: string) {
      // Set in BOTH directions: vi.clearAllMocks() clears calls but keeps
      // implementations, so a thumbnail stubbed by one test would otherwise
      // leak into the next one and make the fallback case unfalsifiable.
      const { indexThumbnails, fetchThumbnailDataUrl } = await import('@/utils/byline/thumbnails');
      vi.mocked(indexThumbnails).mockReturnValue(thumb ? [{ customContentId: '99', path: 'p' }] : ([] as any));
      vi.mocked(fetchThumbnailDataUrl).mockResolvedValue(thumb ?? '');
      apWrapper.listPageDiagramContents.mockResolvedValue([ok()]);
      const wrapper = await mountByline();
      await wrapper.find('[data-testid="byline-type-sequence"]').trigger('click');
      await flushPromises();
      apWrapper.listPageDiagramContents.mockResolvedValue([
        ok(child('99', 'Checkout call flow', DiagramType.Sequence)),
      ]);
      await closeEditor();
      return wrapper;
    }

    it('shows the paste instead of describing it', async () => {
      // "Paste a URL and it becomes a diagram" is the one genuinely surprising
      // step here, and a sentence asking the user to trust that is weaker than
      // two frames of before-and-after.
      const wrapper = await reachCreatedPanel();
      const text = wrapper.find('[data-testid="byline-created"]').text();

      expect(text).toContain('1 · Paste in the editor');
      expect(text).toContain('2 · It renders in place');
      // Host and route only — the full URL is a line away in the copy row.
      expect(text).toContain('confluence.zenuml.com/d/…');
      expect(text).not.toContain('/d/sequence/cloud-1/99…');
    });

    it('previews the diagram the user just saved, not a generic illustration', async () => {
      const wrapper = await reachCreatedPanel('data:image/png;base64,AAAA');
      const img = wrapper.find('[data-testid="byline-created-preview"] img');

      expect(img.attributes('src')).toBe('data:image/png;base64,AAAA');
    });

    it('falls back to the type icon before the backup PNG lands', async () => {
      // The backup is captured on save, so at this instant it usually does not
      // exist yet — the common case, not an error case.
      const wrapper = await reachCreatedPanel();
      const img = wrapper.find('[data-testid="byline-created-preview"] img');

      expect(img.attributes('src')).toBe('./image/diagram_macro_icon.png');
    });

    it('loads the preview even when the clipboard write never settles', async () => {
      // `navigator.clipboard.writeText` can HANG rather than reject when the
      // document is not focused. With the thumbnail load sequenced behind that
      // await, the step-2 frame stayed on its icon fallback forever — caught by
      // rendering the panel in a real browser, where the page has no focus.
      vi.mocked(navigator.clipboard.writeText).mockReturnValue(new Promise(() => {}));
      const wrapper = await reachCreatedPanel('data:image/png;base64,BBBB');

      expect(wrapper.find('[data-testid="byline-created-preview"] img').attributes('src')).toBe(
        'data:image/png;base64,BBBB',
      );
    });

    it('keeps the illustration out of the accessibility tree', async () => {
      // The sentence above it already carries the instruction; the frames are
      // decoration and would otherwise be read out as stray fragments.
      const wrapper = await reachCreatedPanel();

      expect(wrapper.find('.steps').attributes('aria-hidden')).toBe('true');
    });
  });

  describe('diagrams that are not on the page', () => {
    /** The banner reads by domain + page id; both sides derive it the same way. */
    const IDENTITY = { clientDomain: 'example-tenant', pageId: 'page-1' };
    const TWO = [
      ok(child('1', 'Placed', DiagramType.Sequence), child('2', 'Stray', DiagramType.Sequence)),
    ];

    it('offers a Copy URL only on the diagram no macro renders', async () => {
      // A diagram saved from the byline and never pasted exists as this page's
      // custom content — and counts against the Lite limit — but nothing shows
      // it. The link is the only way to place it.
      apWrapper.listPageDiagramContents.mockResolvedValue(TWO);
      apWrapper.referencedCustomContentIds.mockResolvedValue(['1']);
      const wrapper = await mountByline();

      const rows = wrapper.findAll('[data-testid="byline-item"]');
      expect(rows[0].find('[data-testid="byline-copy-url"]').exists()).toBe(false);
      expect(rows[1].find('[data-testid="byline-copy-url"]').exists()).toBe(true);
      expect(rows[1].text()).toContain('not on this page');
    });

    it('renders the rows in the order the page reads, strays last', async () => {
      // The API returns them grouped by custom-content type, which bears no
      // relation to what the reader sees on the page.
      apWrapper.listPageDiagramContents.mockResolvedValue([
        ok(
          { ...child('1', 'First on page', DiagramType.Sequence), createdAt: '2025-01-01T00:00:00.000Z' },
          { ...child('2', 'Stray', DiagramType.Sequence), createdAt: '2025-06-01T00:00:00.000Z' },
          { ...child('3', 'Second on page', DiagramType.Sequence), createdAt: '2025-02-01T00:00:00.000Z' },
        ),
      ]);
      apWrapper.referencedCustomContentIds.mockResolvedValue(['3', '1']);
      const wrapper = await mountByline();

      const titles = wrapper.findAll('[data-testid="byline-item"]').map(r => r.find('.row__title').text());
      expect(titles).toEqual(['Second on page', 'First on page', 'Stray']);
    });

    it('offers nothing when the page could not be scanned', async () => {
      // `undefined` is "could not read the ADF", not "no macros". Treating them
      // alike would label every diagram on the page as stray.
      apWrapper.listPageDiagramContents.mockResolvedValue(TWO);
      apWrapper.referencedCustomContentIds.mockResolvedValue(undefined);
      const wrapper = await mountByline();

      expect(wrapper.findAll('[data-testid="byline-copy-url"]')).toHaveLength(0);
      expect(wrapper.text()).not.toContain('not on this page');
      expect(events('byline_unplaced_scanned')).toHaveLength(0);
    });

    it('copies the typed deeplink for the stray diagram', async () => {
      apWrapper.listPageDiagramContents.mockResolvedValue(TWO);
      apWrapper.referencedCustomContentIds.mockResolvedValue(['1']);
      const wrapper = await mountByline();

      await wrapper.find('[data-testid="byline-copy-url"]').trigger('click');
      await flushPromises();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'https://confluence.zenuml.com/d/sequence/cloud-1/2',
      );
      expect(events('advocacy_message_copied').at(-1)?.[1]).toMatchObject({
        ui_component: 'byline_unplaced_link',
        macro_type: 'sequence',
        result: 'copied',
      });
    });

    it('reports how many were never placed', async () => {
      // unplaced_count against diagram_count is the only measure of whether the
      // create→paste handoff actually completes.
      apWrapper.listPageDiagramContents.mockResolvedValue(TWO);
      apWrapper.referencedCustomContentIds.mockResolvedValue(['1']);
      await mountByline();

      expect(events('byline_unplaced_scanned')[0][1]).toMatchObject({
        unplaced_count: 1,
        diagram_count: 2,
      });
    });

    it('leaves the verdict where the page banner can read it', async () => {
      // The banner mounts on every page load and cannot afford to work this out
      // itself (a listing per custom-content type plus a full-page ADF read), so
      // the byline hands over what it has already paid for.
      forgeGlobalMock.forgeContext = { cloudId: 'cloud-1', extension: { content: { id: 'page-1' } } };
      apWrapper.listPageDiagramContents.mockResolvedValue(TWO);
      apWrapper.referencedCustomContentIds.mockResolvedValue(['1']);
      await mountByline();

      expect(readUnplacedMarker(IDENTITY)?.entries).toEqual([
        { id: '2', title: 'Stray', diagramType: DiagramType.Sequence },
      ]);
    });

    it('writes an EMPTY marker once everything is placed, retiring the banner', async () => {
      forgeGlobalMock.forgeContext = { cloudId: 'cloud-1', extension: { content: { id: 'page-1' } } };
      apWrapper.listPageDiagramContents.mockResolvedValue(TWO);
      apWrapper.referencedCustomContentIds.mockResolvedValue(['1', '2']);
      await mountByline();

      expect(readUnplacedMarker(IDENTITY)?.entries).toEqual([]);
    });

    it('writes no marker at all when the page could not be scanned', async () => {
      // An unreadable ADF must never be written down as "everything is
      // unplaced" — the banner would then name every diagram on the page.
      forgeGlobalMock.forgeContext = { cloudId: 'cloud-1', extension: { content: { id: 'page-1' } } };
      apWrapper.listPageDiagramContents.mockResolvedValue(TWO);
      apWrapper.referencedCustomContentIds.mockResolvedValue(undefined);
      await mountByline();

      expect(readUnplacedMarker(IDENTITY)).toBeNull();
    });

    it('arms the banner for a diagram just created here', async () => {
      // The create→paste handoff's one failure mode: saved, never pasted. At
      // this instant it is unplaced by definition.
      forgeGlobalMock.forgeContext = { cloudId: 'cloud-1', extension: { content: { id: 'page-1' } } };
      apWrapper.listPageDiagramContents.mockResolvedValue([ok()]);
      apWrapper.referencedCustomContentIds.mockResolvedValue([]);
      const wrapper = await mountByline();

      apWrapper.listPageDiagramContents.mockResolvedValue([
        ok(child('9', 'Brand new', DiagramType.Mermaid)),
      ]);
      await wrapper.find('[data-testid="byline-type-flowchart"]').trigger('click');
      await flushPromises();
      await closeEditor();

      expect(readUnplacedMarker(IDENTITY)?.entries).toEqual([
        { id: '9', title: 'Brand new', diagramType: DiagramType.Mermaid },
      ]);
    });

    it('does not hand over a broken link when there is no cloudId', async () => {
      forgeGlobalMock.forgeContext = { cloudId: undefined };
      apWrapper.listPageDiagramContents.mockResolvedValue(TWO);
      apWrapper.referencedCustomContentIds.mockResolvedValue(['1']);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const wrapper = await mountByline();

      await wrapper.find('[data-testid="byline-copy-url"]').trigger('click');
      await flushPromises();

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(events('advocacy_message_copied').at(-1)?.[1]).toMatchObject({ result: 'no_cloud_id' });
      consoleErrorSpy.mockRestore();
    });
  });

  describe('keyboard reachability', () => {
    it('makes every click target a real button', async () => {
      apWrapper.listPageDiagramContents.mockResolvedValue([ok(child('1', 'Login', DiagramType.Sequence))]);
      const wrapper = await mountByline();

      // Cards and tiles were <div> with @click: no tab stop, no role, no Enter.
      expect(wrapper.find('[data-testid="byline-item"] button').exists()).toBe(true);
      expect(wrapper.find('[data-testid="byline-type-sequence"]').element.tagName).toBe('BUTTON');
    });

    it('does not nest the copy button inside the open button', async () => {
      // A <button> inside a <button> is invalid HTML, and was what shipped.
      apWrapper.listPageDiagramContents.mockResolvedValue([ok(child('1', 'Login', DiagramType.Sequence))]);
      const wrapper = await mountByline();

      const copy = wrapper.find('[data-testid="byline-copy-source"]').element;
      expect(copy.tagName).toBe('BUTTON');
      expect(copy.parentElement?.closest('button')).toBeNull();
    });
  });
});
