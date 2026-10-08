import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import TargetedSurveyBanner from './TargetedSurveyBanner.vue';

const remote = vi.hoisted(() => vi.fn());
const close = vi.hoisted(() => vi.fn());
vi.mock('@/utils/requestUtil', () => ({ callRemote: remote }));
vi.mock('@forge/bridge', () => ({ view: { close } }));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }));

const survey = {
  uuid: '71861d63-dc0b-4a75-8a04-724711577d70', revision: 1,
  expiresAt: '2099-01-01T00:00:00.000Z', title: 'Help us improve ZenUML',
  question: 'What could we improve?', options: ['editing', 'other'],
};
const terminalKey = 'targetedSurvey:example-cloud:example-account:71861d63-dc0b-4a75-8a04-724711577d70';
const wrappers: ReturnType<typeof mount>[] = [];

async function show() {
  const wrapper = mount(TargetedSurveyBanner, { props: { survey, terminalKey }, attachTo: document.body });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

describe('targeted survey page banner', () => {
  beforeEach(() => {
    localStorage.clear();
    remote.mockReset();
    close.mockReset();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: async (_key: string, _options: unknown, callback: (lock: object) => Promise<void>) => callback({}) },
    });
  });
  afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); });

  it('dismisses immediately and does not re-prompt this recipient for the same UUID', async () => {
    const first = await show();
    expect(first.text()).toContain('Help us improve ZenUML');
    await first.get('button.quiet').trigger('click');
    expect(localStorage.getItem(terminalKey)).toBe('dismissed');
    expect(first.text()).toBe('');
    const second = await show();
    expect(second.text()).toBe('');
    expect(close).toHaveBeenCalled();
  });

  it('retains selected choices and text after failure, then retries with the same key', async () => {
    remote.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true });
    const wrapper = await show();
    await wrapper.get('button.primary').trigger('click');
    await wrapper.get('input[value="editing"]').setValue(true);
    await wrapper.get('textarea').setValue('The editor lost my position.');
    await wrapper.get('button.primary').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not send');
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('The editor lost my position.');
    await wrapper.get('button.primary').trigger('click');
    await flushPromises();
    expect(remote.mock.calls[0][2]).toEqual(remote.mock.calls[1][2]);
    expect(localStorage.getItem(terminalKey)).toBe('submitted');
    expect(wrapper.text()).toContain('Thank you');
  });

  it('does not resurrect a dismissed form when its in-flight send later succeeds', async () => {
    let resolveSend!: (result: object) => void;
    remote.mockReturnValue(new Promise((resolve) => { resolveSend = resolve; }));
    const wrapper = await show();
    await wrapper.get('button.primary').trigger('click');
    await wrapper.get('input[value="editing"]').setValue(true);
    await wrapper.get('button.primary').trigger('click');
    await wrapper.get('button.quiet').trigger('click');
    resolveSend({ ok: true });
    await flushPromises();
    expect(localStorage.getItem(terminalKey)).toBe('dismissed');
    expect(wrapper.text()).toBe('');
  });
});
