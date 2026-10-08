import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claimSurveyBanner, markSurveyTerminal, surveyTerminalKey } from './ownership';

const key = surveyTerminalKey('example-cloud', 'example-account', '71861d63-dc0b-4a75-8a04-724711577d70');

describe('targeted survey browser ownership', () => {
  beforeEach(() => localStorage.clear());

  it('lets one tab display the banner and keeps dismissed campaigns terminal across revisions', async () => {
    const held = new Set<string>();
    const request = vi.fn(async (name: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => {
      if (held.has(name)) return callback(null);
      held.add(name);
      try { await callback({ name }); } finally { held.delete(name); }
    });
    const locks = { request } as unknown as LockManager;
    let releaseFirst: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      releaseFirst = claimSurveyBanner(key, () => resolve(), () => { throw new Error('first lost'); }, locks);
    });
    await first;
    const secondLost = vi.fn();
    claimSurveyBanner(key, () => { throw new Error('second displayed'); }, secondLost, locks);
    await vi.waitFor(() => expect(secondLost).toHaveBeenCalled());
    expect(markSurveyTerminal(key, 'dismissed')).toBe(true);
    releaseFirst?.();
    const laterLost = vi.fn();
    claimSurveyBanner(key, () => { throw new Error('dismissed campaign displayed'); }, laterLost, locks);
    await vi.waitFor(() => expect(laterLost).toHaveBeenCalled());
  });
});
