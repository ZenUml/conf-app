/**
 * The Full app's presence marker sweep.
 *
 * Its failure modes are asymmetric — a missed write shows the Lite byline
 * beside Full (annoying), while a marker that lingers after uninstall hides
 * the Lite byline forever (silent) — so what matters here is that the sweep
 * reaches every space and never churns settled ones.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const forgeMocks = vi.hoisted(() => ({
  requestConfluence: vi.fn(),
}));

vi.mock('@forge/api', () => ({
  default: {
    asApp: vi.fn(() => ({ requestConfluence: forgeMocks.requestConfluence })),
  },
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (result, fragment, index) =>
        result + fragment + (index < values.length ? encodeURIComponent(String(values[index])) : ''),
      '',
    ),
}));

import { FULL_PRESENCE_KEY, scheduledHandler } from './full-presence';
import { fakeConfluence, makeSite, propOn, type FakeSite } from './space-properties.fixtures';

describe('full-presence scheduledHandler', () => {
  let site: FakeSite;

  beforeEach(() => {
    forgeMocks.requestConfluence.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('marks every space on the site', async () => {
    site = makeSite(['1', '2', '3']);
    forgeMocks.requestConfluence.mockImplementation(fakeConfluence(site));

    await scheduledHandler();

    for (const spaceId of site.spaces) {
      expect(propOn(site, spaceId, FULL_PRESENCE_KEY)?.value, `space ${spaceId}`).toEqual({
        active: 'true',
      });
    }
  });

  it('does not rewrite settled spaces on later ticks', async () => {
    site = makeSite(['1', '2']);
    forgeMocks.requestConfluence.mockImplementation(fakeConfluence(site));
    await scheduledHandler();
    site.calls.length = 0;

    await scheduledHandler();

    expect(site.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('survives a failed listing without throwing', async () => {
    forgeMocks.requestConfluence.mockImplementation(async () => ({
      ok: false,
      status: 500,
      text: async () => '',
    }));

    await expect(scheduledHandler()).resolves.toBeUndefined();
  });
});
