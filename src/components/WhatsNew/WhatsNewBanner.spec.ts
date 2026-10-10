import { mount, enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WhatsNewBanner from '@/components/WhatsNew/WhatsNewBanner.vue';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { readBannerRecord } from '@/utils/whatsNew/state';
import { currentRelease, type WhatsNewRelease } from '@/utils/whatsNew/releases';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }));

// The unplaced module's store. Its REST behaviour is covered in unplacedProperty.spec.ts.
const readUnplacedProperty = vi.hoisted(() => vi.fn());
vi.mock('@/utils/byline/unplacedProperty', () => ({ readUnplacedProperty }));

const viewClose = vi.hoisted(() => vi.fn(async () => {}));
const openUrl = vi.hoisted(() => vi.fn(async () => {}));
const forgeGlobalMock = vi.hoisted(() => ({ forgeContext: {} as any }));
vi.mock('@/model/globals/forgeGlobal', () => ({
  default: forgeGlobalMock,
  getView: vi.fn(async () => ({ close: viewClose })),
  openUrl,
}));

vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: () => 'example-tenant',
}));

const RELEASE: WhatsNewRelease = {
  id: '2026-10',
  publishedAt: '2026-10-01',
  headline: 'Two new things',
  items: [
    { id: 'a', title: 'Item A', body: 'Body A', url: 'https://zenuml.com/a' },
    { id: 'b', title: 'Item B', body: 'Body B' },
  ],
};

const events = (name: string) =>
  vi.mocked(trackAnalyticsEvent).mock.calls.filter(([n]) => n === name);

async function mountBanner(release: WhatsNewRelease = RELEASE) {
  const wrapper = mount(WhatsNewBanner, { props: { release } });
  await flushPromises();
  return wrapper;
}

enableAutoUnmount(afterEach);

describe('WhatsNewBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    forgeGlobalMock.forgeContext = { extension: { content: { id: 'page-1' } } };
    readUnplacedProperty.mockResolvedValue({ status: 'absent' });
  });

  it('shows the collapsed strip and counts the impression', async () => {
    const wrapper = await mountBanner();
    expect(wrapper.find('[data-testid="whats-new-banner"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Two new things');
    expect(wrapper.findAll('[data-testid="whats-new-item"]')).toHaveLength(0);
    expect(readBannerRecord('2026-10').shows).toBe(1);
    expect(events('whats_new_banner_evaluated')[0][1]).toMatchObject({ result: 'shown', whats_new_release_id: '2026-10' });
    expect(events('whats_new_banner_shown')[0][1]).toMatchObject({
      feature_area: 'whats_new',
      surface: 'page_banner',
      whats_new_show_count: 1,
    });
    expect(viewClose).not.toHaveBeenCalled();
  });

  it('expands inline and collapses again', async () => {
    const wrapper = await mountBanner();
    await wrapper.find('[data-testid="whats-new-toggle"]').trigger('click');
    expect(wrapper.findAll('[data-testid="whats-new-item"]')).toHaveLength(2);
    expect(wrapper.find('[data-testid="whats-new-toggle"]').attributes('aria-expanded')).toBe('true');
    expect(events('whats_new_banner_expanded')).toHaveLength(1);
    await wrapper.find('[data-testid="whats-new-toggle"]').trigger('click');
    expect(wrapper.findAll('[data-testid="whats-new-item"]')).toHaveLength(0);
    // Collapsing is not a second expand.
    expect(events('whats_new_banner_expanded')).toHaveLength(1);
  });

  it('offers "Learn more" only on items with a link, and opens it through the router', async () => {
    const wrapper = await mountBanner();
    await wrapper.find('[data-testid="whats-new-toggle"]').trigger('click');
    const links = wrapper.findAll('[data-testid="whats-new-link"]');
    expect(links).toHaveLength(1);
    await links[0].trigger('click');
    await flushPromises();
    expect(openUrl).toHaveBeenCalledWith('https://zenuml.com/a');
    expect(events('whats_new_link_clicked')[0][1]).toMatchObject({ whats_new_item_id: 'a' });
  });

  it('expands the live anonymous-viewing release and tracks its release and item keys', async () => {
    const release = currentRelease('lite', Date.parse('2026-10-06T12:00:00Z'));
    expect(release).not.toBeNull();
    if (!release) throw new Error('Expected the anonymous-viewing release to be live');

    const wrapper = await mountBanner(release);
    await wrapper.find('[data-testid="whats-new-toggle"]').trigger('click');
    expect(wrapper.text()).toContain('View diagrams without signing in');

    await wrapper.find('[data-testid="whats-new-link"]').trigger('click');
    await flushPromises();
    expect(openUrl).toHaveBeenCalledWith('https://zenuml.com/docs/anonymous-viewing/');
    expect(events('whats_new_link_clicked')[0][1]).toMatchObject({
      whats_new_release_id: '2026-10-anonymous-viewing',
      whats_new_item_id: 'anonymous-viewing',
    });
  });

  it('retires the release on dismiss and closes the frame', async () => {
    const wrapper = await mountBanner();
    await wrapper.find('[data-testid="whats-new-toggle"]').trigger('click');
    await wrapper.find('[data-testid="whats-new-dismiss"]').trigger('click');
    await flushPromises();
    expect(readBannerRecord('2026-10').dismissed).toBe(true);
    expect(events('whats_new_banner_dismissed')[0][1]).toMatchObject({ whats_new_expanded: true });
    expect(viewClose).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-testid="whats-new-banner"]').exists()).toBe(false);
  });

  it.each(['ok', 'forbidden', 'error'])(
    'yields to the unplaced module when the property read is %s (fail closed)',
    async (status) => {
      readUnplacedProperty.mockResolvedValue({ status });
      const wrapper = await mountBanner();
      expect(wrapper.find('[data-testid="whats-new-banner"]').exists()).toBe(false);
      expect(viewClose).toHaveBeenCalledOnce();
      expect(readBannerRecord('2026-10').shows).toBe(0);
      expect(events('whats_new_banner_evaluated')[0][1]).toMatchObject({ result: 'yielded_unplaced' });
      expect(events('whats_new_banner_shown')).toHaveLength(0);
    },
  );

  it('skips the property read where there is no page to carry one', async () => {
    forgeGlobalMock.forgeContext = { extension: {} };
    const wrapper = await mountBanner();
    expect(readUnplacedProperty).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="whats-new-banner"]').exists()).toBe(true);
  });

  it('closes rather than strand an empty frame when mount throws', async () => {
    readUnplacedProperty.mockRejectedValue(new Error('boom'));
    const wrapper = await mountBanner();
    expect(wrapper.find('[data-testid="whats-new-banner"]').exists()).toBe(false);
    expect(viewClose).toHaveBeenCalledOnce();
    expect(events('whats_new_banner_evaluated')[0][1]).toMatchObject({ result: 'failed' });
  });
});
