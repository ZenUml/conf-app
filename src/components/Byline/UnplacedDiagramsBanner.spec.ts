import { mount, enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import UnplacedDiagramsBanner from '@/components/Byline/UnplacedDiagramsBanner.vue';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { DiagramType } from '@/model/Diagram/Diagram';
import {
  DISMISSAL_QUIET_MS,
  MAX_BANNER_SHOWS,
  readUnplacedBannerMarker,
  recordUnplacedBannerDismissed,
  writeUnplacedMarker,
  isUnplacedBannerCandidate,
} from '@/utils/byline/unplacedMarker';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }));

// The cross-user store. Its REST behaviour is covered in unplacedProperty.spec.ts.
const readUnplacedProperty = vi.hoisted(() => vi.fn());
const clearUnplacedProperty = vi.hoisted(() => vi.fn(async () => 'deleted'));
vi.mock('@/utils/byline/unplacedProperty', () => ({ readUnplacedProperty, clearUnplacedProperty }));

// The cross-iframe half of the banner priority order.
const higherPriorityBannerPending = vi.hoisted(() => vi.fn(() => null as string | null));
vi.mock('@/utils/banners/priority', () => ({ higherPriorityBannerPending }));

// The one-click place. Its REST behaviour is covered in addToPage.spec.ts.
const addDiagramToPage = vi.hoisted(() => vi.fn(async () => ({ result: 'added', pageMacroCount: 1 })));
const reloadHostPage = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/utils/byline/addToPage', () => ({ addDiagramToPage, reloadHostPage }));

// The hand-off to the placed macro across the reload.
const requestReveal = vi.hoisted(() => vi.fn());
const cancelReveal = vi.hoisted(() => vi.fn());
vi.mock('@/utils/byline/revealDiagram', () => ({ requestReveal, cancelReveal }));

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
const FALLBACK = { viaProperty: false };
const STRAY = { id: 'cc-2', title: 'Login flow', diagramType: DiagramType.Sequence };
const SECOND = { id: 'cc-3', title: 'Retry path', diagramType: DiagramType.Mermaid };

const events = (name: string) =>
  vi.mocked(trackAnalyticsEvent).mock.calls.filter(([n]) => n === name);

/** Default source is the localStorage fallback, matching the shared host. */
async function mountBanner(props?: { source?: 'property' | 'marker' }) {
  const wrapper = mount(UnplacedDiagramsBanner, { props });
  await flushPromises();
  return wrapper;
}

/** What the byline recorded on the page itself. */
const propertyHolding = (entries: unknown[]) => ({
  status: 'ok',
  value: { entries, updatedAt: '2026-08-30T00:00:00.000Z' },
  propertyId: '9001',
  version: 1,
});

describe('UnplacedDiagramsBanner', () => {
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    forgeGlobalMock.forgeContext = { cloudId: 'cloud-1', extension: { content: { id: 'page-1' } } };
    apWrapper.referencedCustomContentIds.mockResolvedValue([]);
    readUnplacedProperty.mockResolvedValue({ status: 'absent' });
    higherPriorityBannerPending.mockReturnValue(null);
    addDiagramToPage.mockResolvedValue({ result: 'added', pageMacroCount: 1 });
    clearUnplacedProperty.mockResolvedValue('deleted');
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => {}) },
      configurable: true,
    });
  });

  describe('verification — the marker is a candidate, never a claim', () => {
    it('says nothing when there is no record — but reports the load', async () => {
      // The host mounted us, so this IS a load past the gate, and the catalog
      // promises the evaluated event fires on every one of them.
      const wrapper = await mountBanner();

      expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
      expect(viewClose).toHaveBeenCalled();
      expect(events('unplaced_banner_evaluated')[0][1]).toMatchObject({
        result: 'record_unreadable',
      });
    });

    it('shows the diagram the live page still does not reference', async () => {
      writeUnplacedMarker(IDENTITY, [STRAY], FALLBACK);
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
      writeUnplacedMarker(IDENTITY, [STRAY], FALLBACK);
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
      writeUnplacedMarker(IDENTITY, [STRAY], FALLBACK);
      apWrapper.referencedCustomContentIds.mockResolvedValue(['cc-2']);
      await mountBanner();

      expect(readUnplacedBannerMarker(IDENTITY).resolvedFor).toBeTruthy();
      expect(isUnplacedBannerCandidate(IDENTITY)).toBe(false);
    });

    it('claims nothing when the page ADF could not be read', async () => {
      writeUnplacedMarker(IDENTITY, [STRAY], FALLBACK);
      apWrapper.referencedCustomContentIds.mockResolvedValue(undefined);
      const wrapper = await mountBanner();

      expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
      expect(viewClose).toHaveBeenCalled();
      expect(events('unplaced_banner_evaluated')[0][1]).toMatchObject({ result: 'scan_failed' });
      // A failed scan is not a resolution — the next load must try again.
      expect(readUnplacedBannerMarker(IDENTITY).resolvedFor).toBeNull();
    });

    it('closes rather than stranding an empty banner slot when the scan throws', async () => {
      writeUnplacedMarker(IDENTITY, [STRAY], FALLBACK);
      apWrapper.referencedCustomContentIds.mockRejectedValue(new Error('boom'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const wrapper = await mountBanner();

      expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
      expect(viewClose).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('shows only the entries that are still unreferenced', async () => {
      writeUnplacedMarker(IDENTITY, [STRAY, SECOND], FALLBACK);
      apWrapper.referencedCustomContentIds.mockResolvedValue(['cc-3']);
      const wrapper = await mountBanner();

      expect(wrapper.find('[data-testid="unplaced-banner-text"]').text()).toContain('Login flow');
      expect(events('unplaced_banner_shown')[0][1]).toMatchObject({ unplaced_count: 1 });
    });
  });

  describe('the cross-user source', () => {
    it('reads the page property when the gated module admitted it', async () => {
      // Confluence has already confirmed the property exists — that is what
      // booted this iframe — so there is no local gate to run.
      readUnplacedProperty.mockResolvedValue(propertyHolding([STRAY]));
      apWrapper.referencedCustomContentIds.mockResolvedValue([]);
      const wrapper = await mountBanner({ source: 'property' });

      expect(readUnplacedProperty).toHaveBeenCalledWith('page-1');
      expect(wrapper.find('[data-testid="unplaced-banner-text"]').text()).toContain('Login flow');
      expect(events('unplaced_banner_shown')[0][1]).toMatchObject({ unplaced_source: 'property' });
    });

    it('shows the fallback when no property covers the page', async () => {
      writeUnplacedMarker(IDENTITY, [STRAY], FALLBACK);
      readUnplacedProperty.mockResolvedValue({ status: 'absent' });
      await mountBanner({ source: 'marker' });

      expect(events('unplaced_banner_shown')[0][1]).toMatchObject({ unplaced_source: 'marker' });
    });

    it('says nothing about a diagram that belongs to another page', async () => {
      // The ADF scan cannot catch this: another page's diagram is genuinely not
      // rendered here, so it "verifies" and comes out as "saved on this page".
      window.localStorage.setItem(
        `bylineUnplaced:example-tenant:page-1`,
        JSON.stringify({
          entries: [STRAY],
          updatedAt: '2026-08-30T00:00:00.000Z',
          pageId: 'page-somewhere-else',
        }),
      );
      const wrapper = await mountBanner({ source: 'marker' });

      expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
      expect(viewClose).toHaveBeenCalled();
      expect(events('unplaced_banner_evaluated').at(-1)?.[1]).toMatchObject({
        result: 'page_mismatch',
      });
    });

    it('stands the fallback down when a property exists after all', async () => {
      // Two authors: A's write landed (so the gated module is already showing
      // this page's notice) and B's was denied. `viaProperty` cannot catch it —
      // it records only what THIS browser managed to write — so without this
      // check B gets two banners saying the same thing.
      writeUnplacedMarker(IDENTITY, [STRAY], FALLBACK);
      readUnplacedProperty.mockResolvedValue(propertyHolding([STRAY]));
      const wrapper = await mountBanner({ source: 'marker' });

      expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
      expect(viewClose).toHaveBeenCalled();
    });

    it.each([['forbidden'], ['error']])(
      'stands the fallback down when the property read comes back %s',
      async status => {
        // Fail closed. A read that cannot answer "does a property cover this
        // page?" is not evidence that none does — and the gated module paints
        // off the property, not off this read. Showing anyway is how one page
        // ends up carrying the same notice twice.
        writeUnplacedMarker(IDENTITY, [STRAY], FALLBACK);
        readUnplacedProperty.mockResolvedValue({ status });
        const wrapper = await mountBanner({ source: 'marker' });

        expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
        expect(viewClose).toHaveBeenCalled();
      },
    );

    it('DELETES the property once the diagrams are placed, taking the page off the gate', async () => {
      // Stamping a localStorage resolution would only silence this browser —
      // every other reader would keep booting the iframe forever.
      readUnplacedProperty.mockResolvedValue(propertyHolding([STRAY]));
      apWrapper.referencedCustomContentIds.mockResolvedValue(['cc-2']);
      const wrapper = await mountBanner({ source: 'property' });

      expect(clearUnplacedProperty).toHaveBeenCalledWith('page-1');
      expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
      expect(viewClose).toHaveBeenCalled();
    });

    it('does not delete the property when the scan failed', async () => {
      readUnplacedProperty.mockResolvedValue(propertyHolding([STRAY]));
      apWrapper.referencedCustomContentIds.mockResolvedValue(undefined);
      await mountBanner({ source: 'property' });

      expect(clearUnplacedProperty).not.toHaveBeenCalled();
    });

    it('says nothing when the property cannot be read despite the gate', async () => {
      readUnplacedProperty.mockResolvedValue({ status: 'error' });
      const wrapper = await mountBanner({ source: 'property' });

      expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
      expect(viewClose).toHaveBeenCalled();
      expect(events('unplaced_banner_evaluated')[0][1]).toMatchObject({
        result: 'record_unreadable',
        unplaced_source: 'property',
      });
    });

    it('reports whether it could retire a record it proved stale', async () => {
      // A reader without delete permission leaves the record standing and every
      // later reader keeps paying the ADF read. Silent, that is invisible.
      readUnplacedProperty.mockResolvedValue(propertyHolding([STRAY]));
      apWrapper.referencedCustomContentIds.mockResolvedValue(['cc-2']);
      clearUnplacedProperty.mockResolvedValue('forbidden');
      await mountBanner({ source: 'property' });

      expect(events('unplaced_property_write')[0][1]).toMatchObject({
        result: 'forbidden',
        unplaced_source: 'property',
      });
    });

    it('honours a dismissal even with no synchronous gate ahead of it', async () => {
      // The shared host checks dismissal before mounting; the property path has
      // no such gate, so it must check here — and before the ADF read, so a
      // dismissed banner costs nothing more.
      readUnplacedProperty.mockResolvedValue(propertyHolding([STRAY]));
      const wrapper = await mountBanner({ source: 'property' });
      await wrapper.find('[data-testid="unplaced-banner-dismiss"]').trigger('click');
      await flushPromises();

      vi.clearAllMocks();
      readUnplacedProperty.mockResolvedValue(propertyHolding([STRAY]));
      const second = await mountBanner({ source: 'property' });

      expect(second.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
      expect(apWrapper.referencedCustomContentIds).not.toHaveBeenCalled();
    });
  });

  describe('one page, one banner', () => {
    it('stands down for a banner that outranks it', async () => {
      // Two Confluence modules means two iframes: the host's priority cascade
      // cannot reach this one, so it asks the same question itself. Observed
      // stacked above the CSAT survey on a real page before this existed.
      higherPriorityBannerPending.mockReturnValue('csat');
      readUnplacedProperty.mockResolvedValue(propertyHolding([STRAY]));
      const wrapper = await mountBanner({ source: 'property' });

      expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
      expect(viewClose).toHaveBeenCalled();
      expect(events('unplaced_banner_evaluated')[0][1]).toMatchObject({
        result: 'yielded',
        suppressed_by: 'csat',
      });
    });

    it('yields BEFORE reading the record, so it costs nothing', async () => {
      higherPriorityBannerPending.mockReturnValue('paywall');
      readUnplacedProperty.mockResolvedValue(propertyHolding([STRAY]));
      await mountBanner({ source: 'property' });

      expect(readUnplacedProperty).not.toHaveBeenCalled();
      expect(apWrapper.referencedCustomContentIds).not.toHaveBeenCalled();
    });

    it('does not consume an impression or a dismissal when it yields', async () => {
      // Yielding is not being seen. Counting it would burn the show cap on
      // loads the user never had the chance to act on.
      higherPriorityBannerPending.mockReturnValue('csat');
      await mountBanner({ source: 'property' });

      expect(readUnplacedBannerMarker(IDENTITY).showCount).toBe(0);
      expect(readUnplacedBannerMarker(IDENTITY).dismissedFor).toBeNull();
    });
  });

  describe('bounds on the cost of a page nobody fixes', () => {
    it('stops paying for a record older than the TTL', async () => {
      readUnplacedProperty.mockResolvedValue({
        status: 'ok',
        value: { entries: [STRAY], updatedAt: '2025-01-01T00:00:00.000Z' },
        propertyId: '9001',
        version: 1,
      });
      const wrapper = await mountBanner({ source: 'property' });

      expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
      expect(apWrapper.referencedCustomContentIds).not.toHaveBeenCalled();
      expect(events('unplaced_banner_evaluated')[0][1]).toMatchObject({ result: 'expired' });
    });

    it('stops asking after the show cap for the same record', async () => {
      readUnplacedProperty.mockResolvedValue(propertyHolding([STRAY]));
      for (let i = 0; i < MAX_BANNER_SHOWS; i++) {
        vi.mocked(trackAnalyticsEvent).mockClear();
        const w = await mountBanner({ source: 'property' });
        expect(w.find('[data-testid="unplaced-banner"]').exists()).toBe(true);
      }
      vi.mocked(trackAnalyticsEvent).mockClear();
      const capped = await mountBanner({ source: 'property' });

      expect(capped.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
      expect(events('unplaced_banner_evaluated')[0][1]).toMatchObject({
        result: 'shows_exhausted',
      });
    });

    it('a dismissed page costs no request at all on the next load', async () => {
      // Confluence gates on page state and cannot know this user said no, so
      // without the quiet window a dismissing user buys a property GET on every
      // load of the page, forever.
      readUnplacedProperty.mockResolvedValue(propertyHolding([STRAY]));
      const first = await mountBanner({ source: 'property' });
      await first.find('[data-testid="unplaced-banner-dismiss"]').trigger('click');
      await flushPromises();

      readUnplacedProperty.mockClear();
      apWrapper.referencedCustomContentIds.mockClear();
      const second = await mountBanner({ source: 'property' });

      expect(second.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
      expect(readUnplacedProperty).not.toHaveBeenCalled();
      expect(apWrapper.referencedCustomContentIds).not.toHaveBeenCalled();
      // Silent here is what makes "the gate never fired" look identical to
      // "everyone already said no" — the exact question a missing banner asks.
      expect(events('unplaced_banner_evaluated').at(-1)?.[1]).toMatchObject({
        result: 'dismissed_quiet',
      });
    });

    it('reports a dismissal of this record version once the quiet window lapses', async () => {
      // Past the quiet window the record IS read, and the version-scoped
      // dismissal is what stands the banner down — a different verdict from
      // the quiet one, and worth telling apart in the readout.
      readUnplacedProperty.mockResolvedValue(propertyHolding([STRAY]));
      recordUnplacedBannerDismissed(
        IDENTITY,
        '2026-08-30T00:00:00.000Z',
        Date.now() - DISMISSAL_QUIET_MS - 1000,
      );
      const wrapper = await mountBanner({ source: 'property' });

      expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
      expect(events('unplaced_banner_evaluated').at(-1)?.[1]).toMatchObject({
        result: 'dismissed_version',
        unplaced_count: 1,
      });
    });
  });

  describe('placing the diagram', () => {
    it('copies the same typed deeplink the byline hands over', async () => {
      writeUnplacedMarker(IDENTITY, [STRAY], FALLBACK);
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
      writeUnplacedMarker(IDENTITY, [STRAY], FALLBACK);
      const wrapper = await mountBanner();
      expect(wrapper.find('[data-testid="unplaced-banner-hint"]').exists()).toBe(false);

      await wrapper.find('[data-testid="unplaced-banner-copy"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-testid="unplaced-banner-hint"]').text()).toContain('paste the link');
    });

    it('puts nothing on the clipboard when no link can be built', async () => {
      forgeGlobalMock.forgeContext = { extension: { content: { id: 'page-1' } } };
      writeUnplacedMarker(IDENTITY, [STRAY], FALLBACK);
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
      writeUnplacedMarker(IDENTITY, [STRAY, SECOND], FALLBACK);
      const wrapper = await mountBanner();

      expect(wrapper.findAll('[data-testid="unplaced-banner-row"]')).toHaveLength(0);
      expect(wrapper.find('[data-testid="unplaced-banner-text"]').text()).toContain('2 diagrams');

      await wrapper.find('[data-testid="unplaced-banner-toggle"]').trigger('click');

      const rows = wrapper.findAll('[data-testid="unplaced-banner-row"]');
      expect(rows).toHaveLength(2);
      expect(rows[1].text()).toContain('Retry path');
    });
  });

  describe('one-click place', () => {
    it('places the diagram and closes, retiring the record immediately', async () => {
      // The page just changed. A banner that keeps naming a diagram the user
      // watched appear is the exact wrong answer, so the record goes now rather
      // than waiting for the next load's verification.
      readUnplacedProperty.mockResolvedValue(propertyHolding([STRAY]));
      const wrapper = await mountBanner({ source: 'property' });

      await wrapper.find('[data-testid="unplaced-banner-add"]').trigger('click');
      await flushPromises();

      expect(addDiagramToPage).toHaveBeenCalledWith('page-1', expect.objectContaining({ id: 'cc-2' }));
      expect(clearUnplacedProperty).toHaveBeenCalledWith('page-1');
      expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
      expect(viewClose).toHaveBeenCalled();
      expect(events('diagram_added_to_page')[0][1]).toMatchObject({
        result: 'added',
        surface: 'page_banner',
        page_macro_count: 1,
      });
      // The write changed the STORED page; the rendered page in front of the
      // user did not change with it, so without this the successful case looks
      // like nothing happened.
      expect(reloadHostPage).toHaveBeenCalled();
      // And before the close, because closing the iframe aborts in-flight work.
      expect(reloadHostPage.mock.invocationCallOrder[0]).toBeLessThan(
        viewClose.mock.invocationCallOrder[0],
      );
      // The macro is appended to the END of the page, so the reloaded page
      // opens above it. This note is how it pulls the page down to itself.
      expect(requestReveal).toHaveBeenCalledWith('page-1', 'cc-2');
      expect(requestReveal.mock.invocationCallOrder[0]).toBeLessThan(
        reloadHostPage.mock.invocationCallOrder[0],
      );
    });

    it('drops the reveal note when the reload never happened', async () => {
      // A note nobody can claim would scroll the NEXT page load instead.
      reloadHostPage.mockResolvedValue(false);
      readUnplacedProperty.mockResolvedValue(propertyHolding([STRAY]));
      const wrapper = await mountBanner({ source: 'property' });

      await wrapper.find('[data-testid="unplaced-banner-add"]').trigger('click');
      await flushPromises();

      expect(cancelReveal).toHaveBeenCalled();
    });

    it('keeps the banner up for the diagrams still unplaced', async () => {
      readUnplacedProperty.mockResolvedValue(propertyHolding([STRAY, SECOND]));
      const wrapper = await mountBanner({ source: 'property' });
      await wrapper.find('[data-testid="unplaced-banner-toggle"]').trigger('click');

      await wrapper.findAll('[data-testid="unplaced-banner-add"]')[0].trigger('click');
      await flushPromises();

      // Two became one, so the list collapses back to the single-diagram form
      // that names it outright — the same shape it would have had all along.
      expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="unplaced-banner-text"]').text()).toContain('Retry path');
      expect(clearUnplacedProperty).not.toHaveBeenCalled();
      // A full Confluence page load between the two clicks would cost the user
      // the second one — the reload waits for the last diagram, and so does the
      // note that says which one to scroll to.
      expect(reloadHostPage).not.toHaveBeenCalled();
      expect(requestReveal).not.toHaveBeenCalled();
    });

    it('does not reload for a diagram the page already carried', async () => {
      // Nothing was written, so there is nothing new to render.
      addDiagramToPage.mockResolvedValue({ result: 'already_present', pageMacroCount: 1 });
      readUnplacedProperty.mockResolvedValue(propertyHolding([STRAY]));
      const wrapper = await mountBanner({ source: 'property' });

      await wrapper.find('[data-testid="unplaced-banner-add"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
      expect(reloadHostPage).not.toHaveBeenCalled();
    });

    it('offers the link instead when the reader cannot edit the page', async () => {
      addDiagramToPage.mockResolvedValue({ result: 'forbidden' });
      readUnplacedProperty.mockResolvedValue(propertyHolding([STRAY]));
      const wrapper = await mountBanner({ source: 'property' });

      await wrapper.find('[data-testid="unplaced-banner-add"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-testid="unplaced-banner-add"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="unplaced-banner-copy"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="unplaced-banner-add-failed"]').text()).toContain('permission');
      expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(true);
    });

    it('says so and stays put when the page changed underneath', async () => {
      addDiagramToPage.mockResolvedValue({ result: 'conflict' });
      readUnplacedProperty.mockResolvedValue(propertyHolding([STRAY]));
      const wrapper = await mountBanner({ source: 'property' });

      await wrapper.find('[data-testid="unplaced-banner-add"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-testid="unplaced-banner-add-failed"]').text()).toContain('Reload');
      // Still offered — a conflict is worth retrying, unlike a refusal.
      expect(wrapper.find('[data-testid="unplaced-banner-add"]').exists()).toBe(true);
    });

    it('keeps Copy link available even when the button works', async () => {
      // Placing it HERE is not the only reason to want the link.
      readUnplacedProperty.mockResolvedValue(propertyHolding([STRAY]));
      const wrapper = await mountBanner({ source: 'property' });

      expect(wrapper.find('[data-testid="unplaced-banner-add"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="unplaced-banner-copy"]').exists()).toBe(true);
    });
  });

  describe('dismissal', () => {
    it('silences this marker version and closes', async () => {
      writeUnplacedMarker(IDENTITY, [STRAY], FALLBACK);
      const wrapper = await mountBanner();

      await wrapper.find('[data-testid="unplaced-banner-dismiss"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-testid="unplaced-banner"]').exists()).toBe(false);
      expect(viewClose).toHaveBeenCalled();
      expect(isUnplacedBannerCandidate(IDENTITY)).toBe(false);
      expect(events('unplaced_banner_dismissed')[0][1]).toMatchObject({ unplaced_count: 1 });
    });

    it('is "not now", not "never" — a newly stranded diagram re-arms it', async () => {
      writeUnplacedMarker(IDENTITY, [STRAY], FALLBACK);
      const wrapper = await mountBanner();
      await wrapper.find('[data-testid="unplaced-banner-dismiss"]').trigger('click');
      await flushPromises();

      writeUnplacedMarker(IDENTITY, [STRAY, SECOND], FALLBACK);

      expect(isUnplacedBannerCandidate(IDENTITY)).toBe(true);
    });
  });
});
