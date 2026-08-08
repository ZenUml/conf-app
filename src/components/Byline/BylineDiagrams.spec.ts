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
vi.mock('@forge/bridge', () => ({ router: { navigate: routerNavigate, open: vi.fn() } }));

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
  });
});
