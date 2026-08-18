import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: (...a: unknown[]) => track(...a),
}));

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@forge/bridge', () => ({
  invoke: (...a: unknown[]) => invokeMock(...a),
}));

const { openUrlMock } = vi.hoisted(() => ({ openUrlMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/model/globals/forgeGlobal', () => ({
  openUrl: (...a: unknown[]) => openUrlMock(...a),
}));

vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getBaseUrl: () => 'https://example-tenant.atlassian.net',
}));

import GetStarted from '@/components/GetStarted/GetStarted.vue';

describe('GetStarted', () => {
  beforeEach(() => {
    track.mockClear();
    invokeMock.mockReset();
    openUrlMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fires get_started_viewed exactly once on mount', () => {
    mount(GetStarted);

    const viewedCalls = track.mock.calls.filter((c) => c[0] === 'get_started_viewed');
    expect(viewedCalls).toHaveLength(1);
    expect(viewedCalls[0][1]).toMatchObject({ feature_area: 'confluence', surface: 'dashboard' });
  });

  it('calls the createDemoPage resolver once and renders the returned page link on success', async () => {
    invokeMock.mockResolvedValueOnce({ ok: true, pageId: '999', enrolled: true, spaceKey: 'TEAM' });

    const wrapper = mount(GetStarted);
    await wrapper.find('#get-started-space-key').setValue('TEAM');
    await wrapper.find('form.action-form').trigger('submit.prevent');
    await flushPromises();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('createDemoPage', { spaceKey: 'TEAM' });

    const clickedCalls = track.mock.calls.filter((c) => c[0] === 'get_started_action_clicked');
    expect(clickedCalls).toHaveLength(1);
    expect(clickedCalls[0][1]).toMatchObject({ action: 'create_examples_page' });

    const link = wrapper.find('a.resource-link[href*="viewpage.action?pageId=999"]');
    expect(link.exists()).toBe(true);
    expect(wrapper.text()).toContain('Examples page created in');
  });

  it('renders the error state when the resolver reports failure', async () => {
    invokeMock.mockResolvedValueOnce({ ok: false, error: 'space_not_eligible' });

    const wrapper = mount(GetStarted);
    await wrapper.find('#get-started-space-key').setValue('BADSPACE');
    await wrapper.find('form.action-form').trigger('submit.prevent');
    await flushPromises();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.action-result.err').exists()).toBe(true);
    expect(wrapper.text()).toContain('Could not create the examples page');
    expect(wrapper.text()).toContain('space_not_eligible');
    // No page link on failure.
    expect(wrapper.find('a.resource-link[href*="viewpage.action"]').exists()).toBe(false);
  });

  // Regression: createDemoPage.js's processDemoPageForSpace returns
  // `orphanDraftPageId` on a partial failure (draft page created, then a
  // later step — custom content or publish — failed), so an unpublished
  // draft is left behind. Before this fix the UI dropped that field and
  // showed only the generic error code, leaving the admin with no way to
  // know a page existed at all. It also carries `detail`, which is more
  // actionable than the bare `error` code (e.g. for `variant_not_configured`,
  // `detail` names the missing env var; `error` alone does not).
  it('surfaces the orphaned draft page id and the detailed reason when the resolver reports one', async () => {
    invokeMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: 'custom_content_failed',
      detail: 'macro=graph status=400 bad request',
      orphanDraftPageId: 'draft-42',
    });

    const wrapper = mount(GetStarted);
    await wrapper.find('#get-started-space-key').setValue('TEAM');
    await wrapper.find('form.action-form').trigger('submit.prevent');
    await flushPromises();

    expect(wrapper.find('.action-result.err').exists()).toBe(true);
    // The detailed reason, not just the bare error code.
    expect(wrapper.text()).toContain('macro=graph status=400 bad request');
    // Names the orphaned draft so an admin can find/delete it.
    expect(wrapper.text()).toContain('draft-42');
    expect(wrapper.text()).toContain('draft page');
  });

  it('does not mention an orphaned draft when the resolver reports none', async () => {
    invokeMock.mockResolvedValueOnce({ ok: false, status: 403, error: 'not_authorized' });

    const wrapper = mount(GetStarted);
    await wrapper.find('#get-started-space-key').setValue('TEAM');
    await wrapper.find('form.action-form').trigger('submit.prevent');
    await flushPromises();

    expect(wrapper.text()).toContain('not_authorized');
    expect(wrapper.text()).not.toContain('draft page');
  });
});
