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

  // Round 3 adversarial finding: the success/timeout messages interpolated
  // the LIVE `spaceKey` model, which the input re-enables as soon as `busy`
  // clears (on success, or on timeout). An admin who then edits the field
  // reactively rewrites an already-rendered "created in TEAM" into "created
  // in OTHER" (or a timeout warning telling them to check OTHER) even though
  // the request that actually ran was for TEAM. The submitted key must be
  // captured in request-scoped state and rendered from that, not the live
  // input model.
  it('keeps the success message naming the space that was submitted after the input is edited post-completion', async () => {
    invokeMock.mockResolvedValueOnce({ ok: true, pageId: '999', spaceKey: 'TEAM' });

    const wrapper = mount(GetStarted);
    await wrapper.find('#get-started-space-key').setValue('TEAM');
    await wrapper.find('form.action-form').trigger('submit.prevent');
    await flushPromises();

    expect(wrapper.text()).toContain('Examples page created in');
    expect(wrapper.text()).toContain('TEAM');

    // Input is re-enabled now that busy has cleared; admin edits it.
    await wrapper.find('#get-started-space-key').setValue('OTHER');

    expect(wrapper.text()).toContain('Examples page created in');
    expect(wrapper.text()).toContain('TEAM');
    expect(wrapper.text()).not.toContain('created in OTHER');
  });

  it('keeps the timeout warning naming the space that was submitted after the input is edited post-timeout', async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockReturnValueOnce(new Promise(() => {}));

      const wrapper = mount(GetStarted);
      await wrapper.find('#get-started-space-key').setValue('TEAM');
      await wrapper.find('form.action-form').trigger('submit.prevent');
      await flushPromises();

      await vi.advanceTimersByTimeAsync(20000);
      await flushPromises();

      expect(wrapper.text()).toContain('has not returned');
      expect(wrapper.text()).toContain('TEAM');

      // Input is re-enabled now that busy has cleared on timeout; admin edits it.
      await wrapper.find('#get-started-space-key').setValue('OTHER');

      expect(wrapper.text()).toContain('has not returned');
      expect(wrapper.text()).toContain('TEAM');
      expect(wrapper.text()).not.toContain('check <code>OTHER</code>');
      expect(wrapper.find('.action-result.err').text()).not.toContain('OTHER');
    } finally {
      vi.useRealTimers();
    }
  });

  // Round 2 adversarial finding: a stalled invoke() never resolves and never
  // rejects, so pre-fix `busy` stays true forever — the button stays
  // disabled showing "Creating…" with no way out except a page reload.
  describe('bounded deadline on a stalled invocation', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('leaves the busy state and shows a warning once the deadline elapses, re-enabling the control', async () => {
      // Never settles within this test.
      invokeMock.mockReturnValueOnce(new Promise(() => {}));

      const wrapper = mount(GetStarted);
      await wrapper.find('#get-started-space-key').setValue('TEAM');
      await wrapper.find('form.action-form').trigger('submit.prevent');
      await flushPromises();

      // Still pending, well before the deadline.
      expect(wrapper.find('button.btn-primary').attributes('disabled')).toBeDefined();
      expect(wrapper.text()).toContain('Creating…');

      // Cross the deadline.
      await vi.advanceTimersByTimeAsync(20000);
      await flushPromises();

      // Busy cleared — the control is usable again.
      expect(wrapper.find('button.btn-primary').attributes('disabled')).toBeUndefined();
      expect(wrapper.text()).not.toContain('Creating…');

      // Explicit warning: request not returned, may still complete server-side,
      // reload-and-check before retrying (never silently swallowed).
      const warning = wrapper.find('.action-result.err');
      expect(warning.exists()).toBe(true);
      expect(wrapper.text()).toContain('has not returned');
      expect(wrapper.text()).toContain('may still');
      expect(wrapper.text()).toContain('complete in the background');
      expect(wrapper.text()).toContain('Reload this page');
      expect(wrapper.text()).toContain('TEAM');
    });

    it('does not let a resolution arriving after the deadline overwrite the warning with a stale success', async () => {
      let resolveInvoke: (value: unknown) => void = () => {};
      invokeMock.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveInvoke = resolve;
        })
      );

      const wrapper = mount(GetStarted);
      await wrapper.find('#get-started-space-key').setValue('TEAM');
      await wrapper.find('form.action-form').trigger('submit.prevent');
      await flushPromises();

      await vi.advanceTimersByTimeAsync(20000);
      await flushPromises();

      // Warning is up.
      expect(wrapper.text()).toContain('has not returned');

      // The stalled call finally resolves, long after the deadline.
      resolveInvoke({ ok: true, pageId: '999', spaceKey: 'TEAM' });
      await flushPromises();

      // The warning must still be showing — a late success must not replace it.
      expect(wrapper.text()).toContain('has not returned');
      expect(wrapper.text()).not.toContain('Examples page created in');
      expect(wrapper.find('a.resource-link[href*="viewpage.action?pageId=999"]').exists()).toBe(false);
    });
  });
});
