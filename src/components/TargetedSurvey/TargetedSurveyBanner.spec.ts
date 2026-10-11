import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import TargetedSurveyBanner from './TargetedSurveyBanner.vue';

const remote = vi.hoisted(() => vi.fn());
const close = vi.hoisted(() => vi.fn());
const track = vi.hoisted(() => vi.fn());
vi.mock('@/utils/requestUtil', () => ({ callRemote: remote }));
vi.mock('@forge/bridge', () => ({ view: { close } }));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: track }));

const survey = {
  uuid: '71861d63-dc0b-4a75-8a04-724711577d70', revision: 1,
  expiresAt: '2099-01-01T00:00:00.000Z', title: 'Help us improve ZenUML',
  question: 'What could we improve?', options: [{ id: 'editing', label: 'Editing diagrams' }],
};
const terminalKey = 'targetedSurvey:example-cloud:example-account:71861d63-dc0b-4a75-8a04-724711577d70:1';
const wrappers: ReturnType<typeof mount>[] = [];
const tick = async () => { await new Promise((resolve) => setTimeout(resolve, 15)); await flushPromises(); };

function show() {
  const wrapper = mount(TargetedSurveyBanner, { props: { survey, terminalKey }, attachTo: document.body });
  wrappers.push(wrapper);
  return wrapper;
}

describe('targeted survey page banner', () => {
  beforeEach(() => {
    localStorage.clear();
    remote.mockReset().mockImplementation(async (_path, method) => method === 'PUT'
      ? { claimed: true, claimToken: '8cf98cab-47a4-44cf-afce-b8f969a29b10', leaseMs: 15000 }
      : { ok: true });
    close.mockReset(); track.mockReset();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: async (_key: string, _options: unknown, callback: (lock: object) => Promise<void>) => callback({}),
    } });
  });
  afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); vi.unstubAllGlobals(); vi.useRealTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); });

  it('renders pending invitation before confirming display, then enables dismissal', async () => {
    let confirm!: (value: object) => void;
    remote.mockImplementation((_path, method) => method === 'PUT'
      ? Promise.resolve({ claimed: true, claimToken: '8cf98cab-47a4-44cf-afce-b8f969a29b10', leaseMs: 15000 })
      : method === 'PATCH' ? new Promise((resolve) => { confirm = resolve; }) : Promise.resolve({ ok: true }));
    const wrapper = show();
    await tick();
    expect(wrapper.text()).toContain('Help us improve ZenUML');
    expect((wrapper.get('button.primary').element as HTMLButtonElement).disabled).toBe(true);
    expect(remote).toHaveBeenCalledWith('/api/targeted-survey', 'PATCH', expect.objectContaining({ action: 'shown' }));
    confirm({ ok: true }); await flushPromises();
    expect((wrapper.get('button.primary').element as HTMLButtonElement).disabled).toBe(false);
    await wrapper.get('button.quiet').trigger('click');
    await flushPromises();
    expect(localStorage.getItem(terminalKey)).toBe('dismissed');
    expect(remote).toHaveBeenCalledWith('/api/targeted-survey', 'PATCH', expect.objectContaining({ action: 'dismiss' }));
    expect(wrapper.text()).toBe('');
  });

  it('hides when display confirmation is rejected and ignores a late success after unmount', async () => {
    let confirm!: (value: object) => void;
    remote.mockImplementation((_path, method) => method === 'PUT'
      ? Promise.resolve({ claimed: true, claimToken: '8cf98cab-47a4-44cf-afce-b8f969a29b10', leaseMs: 15000 })
      : new Promise((resolve) => { confirm = resolve; }));
    const wrapper = show(); await tick();
    wrapper.unmount(); confirm({ ok: true }); await flushPromises();
    expect(track).not.toHaveBeenCalledWith('targeted_survey_shown', expect.anything());
  });

  it('does not confirm a hidden tab and self-hides before an unconfirmed lease expires', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const hidden = show(); await tick();
    expect(hidden.text()).toBe('');
    expect(remote.mock.calls.filter((call) => call[1] === 'PATCH')).toHaveLength(0);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    remote.mockImplementation((_path, method) => method === 'PUT'
      ? Promise.resolve({ claimed: true, claimToken: '8cf98cab-47a4-44cf-afce-b8f969a29b10', leaseMs: 1030 })
      : new Promise(() => {}));
    const pending = show(); await tick();
    expect(pending.text()).toContain('Help us improve ZenUML');
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(pending.text()).toBe('');
    expect(track).not.toHaveBeenCalledWith('targeted_survey_shown', expect.anything());
  });

  it('keeps the form and submission key across failed sends, then submits', async () => {
    let attempts = 0;
    remote.mockImplementation(async (_path, method) => {
      if (method === 'PUT') return { claimed: true, claimToken: '8cf98cab-47a4-44cf-afce-b8f969a29b10', leaseMs: 15000 };
      if (method === 'PATCH') return { ok: true };
      if (++attempts === 1) throw new Error('offline');
      return { ok: true };
    });
    const wrapper = show(); await tick();
    await wrapper.get('button.primary').trigger('click');
    await wrapper.get('input[value="editing"]').setValue(true);
    await wrapper.get('textarea').setValue('The editor lost my position.');
    await wrapper.get('button.primary').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not send');
    await wrapper.get('button.primary').trigger('click'); await flushPromises();
    const posts = remote.mock.calls.filter((call) => call[1] === 'POST');
    expect(posts[0][2]).toEqual(posts[1][2]);
    expect(localStorage.getItem(terminalKey)).toBe('submitted');
  });
});
