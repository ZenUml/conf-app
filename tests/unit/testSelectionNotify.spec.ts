import { describe, expect, it, vi } from 'vitest';
import { notifyRegression } from '../../scripts/test-selection/notify.mjs';

const results = (status = 'success') => ({ run_id: '42', attempt: 1, sha: 'abc123', url: 'https://github.com/ZenUml/conf-app/actions/runs/42', variants: [{ variant: 'lite', deployment: 'success', version: 'success', tests: status, failures: status === 'failure' ? [{ name: 'renders Mermaid', url: 'https://example.com/report' }] : [] }] });
const slack = () => vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, ts: '123.456', channel: 'C123' }) });
const options = (fetchImpl = slack()) => ({ token: 'secret', channel: 'C123', fetchImpl });

describe('nightly Slack notifier', () => {
  it('aggregates failed and interrupted variants into one alert', async () => {
    const fetchImpl = slack();
    const input = results('failure');
    input.variants.push({ variant: 'full', deployment: 'cancelled', version: 'skipped', tests: 'skipped', failures: [] });
    const metadata = await notifyRegression(input, options(fetchImpl));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toContain('chat.postMessage');
    const body = JSON.parse(request.body);
    expect(body.text).toContain('renders Mermaid');
    expect(body.text).toContain('full: deployment cancelled');
    expect(body.text).toContain(input.url);
    expect(metadata.ts).toBe('123.456');
    expect(metadata.status).toBe('failure');
  });
  it('is silent on routine success without requiring Slack credentials', async () => {
    const fetchImpl = slack();
    expect((await notifyRegression(results(), { fetchImpl })).status).toBe('silent');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('updates the original alert on recovery and remaining failure', async () => {
    for (const status of ['success', 'failure']) {
      const fetchImpl = slack();
      const metadata = await notifyRegression(results(status), { ...options(fetchImpl), previous: { run_id: '42', ts: '123.456', channel: 'C123' } });
      expect(fetchImpl.mock.calls[0][0]).toContain('chat.update');
      expect(JSON.parse(fetchImpl.mock.calls[0][1].body).ts).toBe('123.456');
      expect(metadata.status).toBe(status === 'success' ? 'recovered' : 'failure');
    }
  });
  it('surfaces HTTP and Slack API rejection without response or token leakage', async () => {
    for (const response of [{ ok: false, status: 429 }, { ok: true, json: async () => ({ ok: false, error: 'secret' }) }]) {
      const fetchImpl = vi.fn().mockResolvedValue(response);
      await expect(notifyRegression(results('failure'), options(fetchImpl))).rejects.toThrow(/Slack/);
      await expect(notifyRegression(results('failure'), options(fetchImpl))).rejects.not.toThrow('secret');
    }
  });
  it('rejects missing configuration, malformed results and unrelated previous messages', async () => {
    await expect(notifyRegression(results('failure'), {})).rejects.toThrow('SLACK_BOT_TOKEN');
    await expect(notifyRegression(results('failure'), { token: 'secret' })).rejects.toThrow('SLACK_CHANNEL_ID');
    await expect(notifyRegression({ ...results(), variants: [] }, options())).rejects.toThrow('variants');
    await expect(notifyRegression(results(), { ...options(), previous: { run_id: '41', ts: '123' } })).rejects.toThrow('run');
  });
  it('bounds requests and sanitizes thrown transport errors', async () => {
    const fetchImpl = vi.fn().mockImplementation(async (_url, request) => {
      expect(request.signal).toBeInstanceOf(AbortSignal);
      throw new Error('secret');
    });
    await expect(notifyRegression(results('failure'), options(fetchImpl))).rejects.toThrow('Slack request failed');
  });
});
