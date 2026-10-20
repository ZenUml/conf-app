import { mount, enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AsyncApiDashboard from '@/components/AsyncApiDashboard/AsyncApiDashboard.vue';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { openModal } from '@/model/globals/forgeGlobal';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }));

const apWrapper = vi.hoisted(() => ({
  initializeContext: vi.fn(async () => {}),
  searchCustomContent: vi.fn(async () => [] as any[]),
}));
vi.mock('@/model/globals', () => ({ default: { apWrapper } }));

vi.mock('@/model/globals/forgeGlobal', () => ({
  default: { forgeContext: { cloudId: 'cloud-1' } },
  openModal: vi.fn(async () => {}),
  openUrl: vi.fn(async () => {}),
}));

enableAutoUnmount(afterEach);

describe('AsyncApiDashboard create', () => {
  beforeEach(() => {
    vi.mocked(trackAnalyticsEvent).mockClear();
    vi.mocked(openModal).mockClear();
  });

  // #614: the opener mints creation_flow_id so the dashboard click joins the
  // editor's macro_create_* events; click event and modal context must agree.
  it.each(['asyncapi', 'openapi'] as const)(
    'stamps dashboard_create_selected and the %s modal context with the same creation_flow_id',
    async (format) => {
      const wrapper = mount(AsyncApiDashboard);
      await flushPromises();

      await wrapper.find('.create-split-main').trigger('click');
      const item = wrapper.findAll('.create-menu-item')[format === 'asyncapi' ? 0 : 1];
      await item.trigger('click');
      await flushPromises();

      const call = vi.mocked(trackAnalyticsEvent).mock.calls.find(([n]) => n === 'dashboard_create_selected');
      const clickId = (call?.[1] as any)?.creation_flow_id;
      expect(clickId).toMatch(/^[0-9a-f-]{36}$/);
      const opts = vi.mocked(openModal).mock.calls.at(-1)?.[0] as any;
      expect(opts.context.creationOrigin).toBe('dashboard');
      expect(opts.context.creationFlowId).toBe(clickId);
    },
  );
});
