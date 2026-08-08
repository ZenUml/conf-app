import { mount, enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import BylineDiagrams from '@/components/Byline/BylineDiagrams.vue';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { openModal } from '@/model/globals/forgeGlobal';
import { DiagramType } from '@/model/Diagram/Diagram';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

const apWrapper = vi.hoisted(() => ({
  _getCurrentPageId: vi.fn(async () => 'page-1'),
  listPageDiagramContents: vi.fn(async () => [] as any[]),
  getAttachmentsV2: vi.fn(async () => []),
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
    spaceKey.value = 'SPACE';
    forgeGlobalMock.forgeContext = { cloudId: 'cloud-1' };
    apWrapper._getCurrentPageId.mockResolvedValue('page-1');
    apWrapper.listPageDiagramContents.mockResolvedValue([]);
    apWrapper.getAttachmentsV2.mockResolvedValue([]);
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
      expect(wrapper.find('[data-testid="byline-created-sub-editing"]').text()).toContain('Paste it into the page');
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
    });

    it('still clears the panel when the close request cannot be honoured', async () => {
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

      expect(wrapper.find('[data-testid="byline-created"]').exists()).toBe(false);
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

    it('does not try to close the view from a view-mode page', async () => {
      // "Not now" there means "keep looking" — the user has not left the page,
      // and the diagram list is a reasonable place to land.
      const wrapper = await reachCreatedPanel();

      await wrapper.find('[data-testid="byline-created-done"]').trigger('click');
      await flushPromises();

      expect(viewClose).not.toHaveBeenCalled();
      expect(events('byline_view_close_requested')).toHaveLength(0);
      expect(wrapper.find('[data-testid="byline-created"]').exists()).toBe(false);
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
    it('renders the picker immediately rather than a skeleton', async () => {
      // Four skeleton cards resolved into an empty state on most pages: they
      // promised diagrams to a page that has none. The picker is valid in every
      // state, so it goes up first and the list fills in above it.
      let release: (v: any) => void = () => {};
      apWrapper.listPageDiagramContents.mockReturnValue(
        new Promise(resolve => {
          release = resolve;
        }) as any,
      );
      const wrapper = mount(BylineDiagrams);
      await flushPromises();

      expect(wrapper.find('[data-testid="byline-loading"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="byline-type-flowchart"]').exists()).toBe(true);

      release([ok()]);
      await flushPromises();
      expect(wrapper.find('[data-testid="byline-empty"]').exists()).toBe(true);
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

    it('offers a sample render for every type, not just the two that had one', async () => {
      // Graph and OpenAPI fell back to a 30px icon at 45% opacity on grey,
      // which reads as "unavailable" rather than "no preview".
      apWrapper.listPageDiagramContents.mockResolvedValue([ok()]);
      const wrapper = await mountByline();

      for (const key of ['flowchart', 'sequence', 'graph', 'openapi']) {
        const img = wrapper.find(`[data-testid="byline-type-${key}"] img`);
        expect(img.exists(), `${key} has no sample render`).toBe(true);
        expect(img.attributes('src')).toBe(`./image/byline-example-${key}.png`);
      }
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
