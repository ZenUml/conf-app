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
    expect(viewedCalls[0][1]).toMatchObject({ feature_area: 'confluence', surface: 'get_started' });
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

  it.each([
    [{ ok: true, pageId: '999' }, 'created'],
    [{ ok: true, pageId: '999', alreadyExists: true }, 'already_exists'],
    [{ ok: false, error: 'in_progress' }, 'in_progress'],
    [{ ok: true, enrolled: true }, 'enrolled'],
    [{ ok: false, error: 'space_not_found', detail: 'private response' }, 'failed'],
    [undefined, 'failed'],
    [{ ok: true, pageId: '0' }, 'failed'],
  ])('records the observed result without treating an unresolved request as creation: %j', async (response, outcome) => {
    invokeMock.mockResolvedValueOnce(response);
    const wrapper = mount(GetStarted);
    await wrapper.find('#get-started-space-key').setValue('TEAM');
    await wrapper.find('form.action-form').trigger('submit.prevent');
    await flushPromises();
    const results = track.mock.calls.filter(c => c[0] === 'get_started_examples_result');
    expect(results).toHaveLength(1);
    expect(results[0][1]).toMatchObject({ examples_result: outcome, duration_ms: expect.any(Number) });
    expect(results[0][1]).not.toHaveProperty('space_key');
    expect(results[0][1]).not.toHaveProperty('page_id');
    expect(JSON.stringify(results)).not.toContain('private response');
    wrapper.unmount();
  });

  it('records an invoke failure using a fixed category and allows retry', async () => {
    invokeMock.mockRejectedValueOnce(new Error('private response'));
    const wrapper = mount(GetStarted);
    await wrapper.find('#get-started-space-key').setValue('TEAM');
    await wrapper.find('form.action-form').trigger('submit.prevent');
    await flushPromises();
    expect(track).toHaveBeenCalledWith('get_started_examples_result', expect.objectContaining({
      examples_result: 'failed', failure_reason: 'invoke_failed',
    }));
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.text()).not.toContain('private response');
    wrapper.unmount();
  });

  it('renders the error state when the resolver reports failure', async () => {
    invokeMock.mockResolvedValueOnce({ ok: false, error: 'space_not_eligible' });

    const wrapper = mount(GetStarted);
    await wrapper.find('#get-started-space-key').setValue('BADSPACE');
    await wrapper.find('form.action-form').trigger('submit.prevent');
    await flushPromises();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.action-result.err').exists()).toBe(true);
    expect(wrapper.text()).toContain('Choose a current shared space');
    expect(wrapper.text()).not.toContain('space_not_eligible');
    // No page link on failure.
    expect(wrapper.find('a.resource-link[href*="viewpage.action"]').exists()).toBe(false);
  });

  it('guides recovery from a partial failure without exposing raw resolver details', async () => {
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
    expect(wrapper.text()).toContain('Confluence could not save all example diagrams. Try again shortly.');
    expect(wrapper.text()).not.toContain('permission');
    expect(wrapper.text()).toContain('An unfinished draft remains');
    expect(wrapper.text()).not.toContain('macro=graph status=400');
    expect(JSON.stringify(track.mock.calls)).not.toContain('draft-42');
    expect(JSON.stringify(track.mock.calls)).not.toContain('macro=graph status=400');
  });

  it('does not mention an orphaned draft when the resolver reports none', async () => {
    invokeMock.mockResolvedValueOnce({ ok: false, status: 403, error: 'not_authorized' });

    const wrapper = mount(GetStarted);
    await wrapper.find('#get-started-space-key').setValue('TEAM');
    await wrapper.find('form.action-form').trigger('submit.prevent');
    await flushPromises();

    expect(wrapper.text()).toContain('A Confluence site admin needs');
    expect(wrapper.text()).not.toContain('draft page');
  });

  it.each([401, 403])('gives permission guidance only for HTTP %i failures', async (status) => {
    invokeMock.mockResolvedValueOnce({
      ok: false,
      status,
      error: 'custom_content_failed',
      orphanDraftPageId: 'draft-42',
    });

    const wrapper = mount(GetStarted);
    await wrapper.find('#get-started-space-key').setValue('TEAM');
    await wrapper.find('form.action-form').trigger('submit.prevent');
    await flushPromises();

    expect(wrapper.text()).toContain('Check the app\'s permissions');
    expect(wrapper.text()).toContain('An unfinished draft remains');
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
      const results = track.mock.calls.filter(c => c[0] === 'get_started_examples_result');
      expect(results).toHaveLength(1);
      expect(results[0][1]).toMatchObject({ examples_result: 'timeout' });
    });
  });
});
