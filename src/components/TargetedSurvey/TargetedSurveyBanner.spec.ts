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
  question: 'What could we improve?', options: [
    { id: 'editing', label: 'Editing diagrams' }, { id: 'other', label: 'Something else' },
  ],
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
    remote.mockReset().mockResolvedValue({ claimed: true, claimToken: '8cf98cab-47a4-44cf-afce-b8f969a29b10' });
    close.mockReset();
    track.mockReset();
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

  it('does not display when another product already owns the server claim', async () => {
    remote.mockResolvedValueOnce({ claimed: false });
    const wrapper = await show();
    expect(wrapper.text()).toBe('');
    expect(close).toHaveBeenCalled();
    expect(track).not.toHaveBeenCalledWith('targeted_survey_shown', expect.anything());
  });

  it('retains selected choices and text after failure, then retries with the same key', async () => {
    remote.mockResolvedValueOnce({ claimed: true, claimToken: '8cf98cab-47a4-44cf-afce-b8f969a29b10' })
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true });
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
    expect(remote.mock.calls[1][2]).toEqual(remote.mock.calls[2][2]);
    expect(localStorage.getItem(terminalKey)).toBe('submitted');
    expect(wrapper.text()).toContain('Thank you');
  });

  it('does not resurrect a dismissed form when its in-flight send later succeeds', async () => {
    let resolveSend!: (result: object) => void;
    remote.mockResolvedValueOnce({ claimed: true, claimToken: '8cf98cab-47a4-44cf-afce-b8f969a29b10' })
      .mockReturnValueOnce(new Promise((resolve) => { resolveSend = resolve; }));
    const wrapper = await show();
    await wrapper.get('button.primary').trigger('click');
    await wrapper.get('input[value="editing"]').setValue(true);
    await wrapper.get('button.primary').trigger('click');
    expect(track).toHaveBeenCalledWith('targeted_survey_submit_requested', expect.objectContaining({ survey_uuid: survey.uuid }));
    expect(wrapper.text()).toContain('You can close this banner');
    expect(wrapper.get('button.quiet').text()).toBe('Close');
    await wrapper.get('button.quiet').trigger('click');
    resolveSend({ ok: true });
    await flushPromises();
    expect(localStorage.getItem(terminalKey)).toBe('dismissed');
    expect(wrapper.text()).toBe('');
    expect(track).toHaveBeenCalledWith('targeted_survey_dismissed', expect.objectContaining({ survey_phase: 'submitting' }));
    expect(track).toHaveBeenCalledWith('targeted_survey_submitted', expect.objectContaining({ survey_uuid: survey.uuid }));
  });
});
