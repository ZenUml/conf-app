import { mount, enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import UnplacedDiagramsBanner from '@/components/Byline/UnplacedDiagramsBanner.vue';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { DiagramType } from '@/model/Diagram/Diagram';
import {
  readUnplacedBannerMarker,
  writeUnplacedMarker,
  isUnplacedBannerCandidate,
} from '@/utils/byline/unplacedMarker';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }));

const apWrapper = vi.hoisted(() => ({
  referencedCustomContentIds: vi.fn(async () => [] as string[] | undefined),
}));
vi.mock('@/model/globals', () => ({ default: { apWrapper } }));

const viewClose = vi.hoisted(() => vi.fn(async () => {}));
const forgeGlobalMock = vi.hoisted(() => ({ forgeContext: {} as any }));
vi.mock('@/model/globals/forgeGlobal', () => ({
  default: forgeGlobalMock,
  getView: vi.fn(async () => ({ close: viewClose })),
}));

vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  NO_SPACE_CONTEXT: 'no_space_context',
  getSpaceKey: () => 'SPACE',
  getClientDomain: () => 'example-tenant',
}));

const IDENTITY = { clientDomain: 'example-tenant', pageId: 'page-1' };
const STRAY = { id: 'cc-2', title: 'Login flow', diagramType: DiagramType.Sequence };
const SECOND = { id: 'cc-3', title: 'Retry path', diagramType: DiagramType.Mermaid };

const events = (name: string) =>
  vi.mocked(trackAnalyticsEvent).mock.calls.filter(([n]) => n === name);

async function mountBanner() {
  const wrapper = mount(UnplacedDiagramsBanner);
  await flushPromises();
  return wrapper;
}

describe('UnplacedDiagramsBanner', () => {
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    forgeGlobalMock.forgeContext = { cloudId: 'cloud-1', extension: { content: { id: 'page-1' } } };
    apWrapper.referencedCustomContentIds.mockResolvedValue([]);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => {}) },
      configurable: true,
    });
  });

  describe('verification — the marker is a candidate, never a claim', () => {
    it('says nothing at all when there is no marker', async () => {
      const wrapper = await mountBanner();

      expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
      expect(viewClose).toHaveBeenCalled();
      expect(events('unplaced_banner_evaluated')).toHaveLength(0);
    });

    it('shows the diagram the live page still does not reference', async () => {
      writeUnplacedMarker(IDENTITY, [STRAY]);
      apWrapper.referencedCustomContentIds.mockResolvedValue(['cc-1']);
      const wrapper = await mountBanner();

      expect(wrapper.find('[data-testid="unplaced-banner-text"]').text()).toContain('Login flow');
      expect(wrapper.find('[data-testid="unplaced-banner-text"]').text()).toContain(
        "saved on this page but isn't placed on it",
      );
      expect(viewClose).not.toHaveBeenCalled();
      expect(events('unplaced_banner_shown')[0][1]).toMatchObject({
        surface: 'page_banner',
        unplaced_count: 1,
      });
    });

    it('stays quiet when the user has since pasted the link', async () => {
      // The marker records what the byline saw; the user may have fixed the page
      // a second later. Insisting otherwise would be worse than no banner.
      writeUnplacedMarker(IDENTITY, [STRAY]);
      apWrapper.referencedCustomContentIds.mockResolvedValue(['cc-2']);
      const wrapper = await mountBanner();

      expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
      expect(viewClose).toHaveBeenCalled();
      expect(events('unplaced_banner_evaluated')[0][1]).toMatchObject({
        result: 'all_placed',
        unplaced_count: 0,
      });
    });

    it('records the resolution so the next load exits at the synchronous gate', async () => {
      // Otherwise a stale marker buys a full-page ADF read on every single load
      // of this page for the next 30 days.
      writeUnplacedMarker(IDENTITY, [STRAY]);
      apWrapper.referencedCustomContentIds.mockResolvedValue(['cc-2']);
      await mountBanner();

      expect(readUnplacedBannerMarker(IDENTITY).resolvedFor).toBeTruthy();
      expect(isUnplacedBannerCandidate(IDENTITY)).toBe(false);
    });

    it('claims nothing when the page ADF could not be read', async () => {
      writeUnplacedMarker(IDENTITY, [STRAY]);
      apWrapper.referencedCustomContentIds.mockResolvedValue(undefined);
      const wrapper = await mountBanner();

      expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
      expect(viewClose).toHaveBeenCalled();
      expect(events('unplaced_banner_evaluated')[0][1]).toMatchObject({ result: 'scan_failed' });
      // A failed scan is not a resolution — the next load must try again.
      expect(readUnplacedBannerMarker(IDENTITY).resolvedFor).toBeNull();
    });

    it('closes rather than stranding an empty banner slot when the scan throws', async () => {
      writeUnplacedMarker(IDENTITY, [STRAY]);
      apWrapper.referencedCustomContentIds.mockRejectedValue(new Error('boom'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const wrapper = await mountBanner();

      expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
      expect(viewClose).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('shows only the entries that are still unreferenced', async () => {
      writeUnplacedMarker(IDENTITY, [STRAY, SECOND]);
      apWrapper.referencedCustomContentIds.mockResolvedValue(['cc-3']);
      const wrapper = await mountBanner();

      expect(wrapper.find('[data-testid="unplaced-banner-text"]').text()).toContain('Login flow');
      expect(events('unplaced_banner_shown')[0][1]).toMatchObject({ unplaced_count: 1 });
    });
  });

  describe('placing the diagram', () => {
    it('copies the same typed deeplink the byline hands over', async () => {
      writeUnplacedMarker(IDENTITY, [STRAY]);
      apWrapper.referencedCustomContentIds.mockResolvedValue([]);
      const wrapper = await mountBanner();

      await wrapper.find('[data-testid="unplaced-banner-copy"]').trigger('click');
      await flushPromises();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'https://confluence.zenuml.com/d/sequence/cloud-1/cc-2',
      );
      expect(events('advocacy_message_copied').at(-1)?.[1]).toMatchObject({
        ui_component: 'page_banner_unplaced_link',
        macro_type: 'sequence',
        result: 'copied',
      });
    });

    it('says what to do with the link once it is copied', async () => {
      // A link on the clipboard is half the job; that pasting a URL into the
      // editor is enough is the genuinely surprising step.
      writeUnplacedMarker(IDENTITY, [STRAY]);
      const wrapper = await mountBanner();
      expect(wrapper.find('[data-testid="unplaced-banner-hint"]').exists()).toBe(false);

      await wrapper.find('[data-testid="unplaced-banner-copy"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-testid="unplaced-banner-hint"]').text()).toContain('paste the link');
    });

    it('puts nothing on the clipboard when no link can be built', async () => {
      forgeGlobalMock.forgeContext = { extension: { content: { id: 'page-1' } } };
      writeUnplacedMarker(IDENTITY, [STRAY]);
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const wrapper = await mountBanner();

      await wrapper.find('[data-testid="unplaced-banner-copy"]').trigger('click');
      await flushPromises();

      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(events('advocacy_message_copied').at(-1)?.[1]).toMatchObject({ result: 'no_cloud_id' });
      error.mockRestore();
    });

    it('names each diagram behind a toggle when there is more than one', async () => {
      // The summary alone cannot say WHICH, and this banner sits above every
      // load of the page — it must not own the fold to say so.
      writeUnplacedMarker(IDENTITY, [STRAY, SECOND]);
      const wrapper = await mountBanner();

      expect(wrapper.findAll('[data-testid="unplaced-banner-row"]')).toHaveLength(0);
      expect(wrapper.find('[data-testid="unplaced-banner-text"]').text()).toContain('2 diagrams');

      await wrapper.find('[data-testid="unplaced-banner-toggle"]').trigger('click');

      const rows = wrapper.findAll('[data-testid="unplaced-banner-row"]');
      expect(rows).toHaveLength(2);
      expect(rows[1].text()).toContain('Retry path');
    });
  });

  describe('dismissal', () => {
    it('silences this marker version and closes', async () => {
      writeUnplacedMarker(IDENTITY, [STRAY]);
      const wrapper = await mountBanner();

      await wrapper.find('[data-testid="unplaced-banner-dismiss"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
      expect(viewClose).toHaveBeenCalled();
      expect(isUnplacedBannerCandidate(IDENTITY)).toBe(false);
      expect(events('unplaced_banner_dismissed')[0][1]).toMatchObject({ unplaced_count: 1 });
    });

    it('is "not now", not "never" — a newly stranded diagram re-arms it', async () => {
      writeUnplacedMarker(IDENTITY, [STRAY]);
      const wrapper = await mountBanner();
      await wrapper.find('[data-testid="unplaced-banner-dismiss"]').trigger('click');
      await flushPromises();

      writeUnplacedMarker(IDENTITY, [STRAY, SECOND]);

      expect(isUnplacedBannerCandidate(IDENTITY)).toBe(true);
    });
  });
});
