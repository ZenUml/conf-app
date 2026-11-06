/**
 * The space-property helpers both visibility sweeps stand on.
 *
 * The fixture (space-properties.fixtures.ts) enforces the two documented
 * contracts — POST-create vs versioned PUT-update, 409 on a wrong version —
 * so these tests pin that the helpers speak them, not merely that they make
 * requests.
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

import {
  ensureSpaceProperty,
  getSpaceProperty,
  listSpaceIds,
  removeSpaceProperty,
} from './space-properties';
import { fakeConfluence, makeSite, propOn, setProp, type FakeSite } from './space-properties.fixtures';

const KEY = 'zenuml-byline-lite';

describe('space property helpers', () => {
  let site: FakeSite;

  function arrange(spaces: string[], opts: { pageSize?: number } = {}) {
    site = makeSite(spaces);
    forgeMocks.requestConfluence.mockImplementation(fakeConfluence(site, opts));
  }

  beforeEach(() => {
    forgeMocks.requestConfluence.mockReset();
  });

  it('lists every space across cursor pages, in order', async () => {
    arrange(['1', '2', '3', '4', '5'], { pageSize: 2 });

    const ids = await listSpaceIds();

    expect(ids).toEqual(['1', '2', '3', '4', '5']);
    const listCalls = site.calls.filter((c) => c.url.startsWith('/wiki/api/v2/spaces?'));
    expect(listCalls.length).toBe(3);
  });

  it('throws on a failed listing page instead of returning a partial list', async () => {
    arrange(['1', '2']);
    forgeMocks.requestConfluence.mockImplementation(async () => ({
      ok: false,
      status: 500,
      text: async () => '',
    }));

    await expect(listSpaceIds()).rejects.toThrow('HTTP 500');
  });

  it('creates via POST when the property is absent', async () => {
    arrange(['11']);

    expect(await ensureSpaceProperty('11', KEY, { enabled: 'true' })).toBe('created');
    expect(propOn(site, '11', KEY)?.value).toEqual({ enabled: 'true' });
    expect(propOn(site, '11', KEY)?.version).toBe(1);
  });

  it('reports unchanged without writing when the value already matches', async () => {
    arrange(['11']);
    setProp(site, '11', KEY, { enabled: 'true' }, 4);

    expect(await ensureSpaceProperty('11', KEY, { enabled: 'true' })).toBe('unchanged');
    expect(site.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    expect(propOn(site, '11', KEY)?.version).toBe(4);
  });

  // The fixture answers 409 to any version other than current+1, so this test
  // fails if the helper stops sending the documented next-in-sequence number.
  it('updates a differing value with the next version number', async () => {
    arrange(['11']);
    setProp(site, '11', KEY, { enabled: 'false' }, 7);

    expect(await ensureSpaceProperty('11', KEY, { enabled: 'true' })).toBe('updated');
    expect(propOn(site, '11', KEY)?.value).toEqual({ enabled: 'true' });
    expect(propOn(site, '11', KEY)?.version).toBe(8);
  });

  it('reads back what it wrote', async () => {
    arrange(['11']);
    await ensureSpaceProperty('11', KEY, { enabled: 'true' });

    const state = await getSpaceProperty('11', KEY);
    expect(state.found).toBe(true);
    expect(state.value).toEqual({ enabled: 'true' });
    expect(state.versionNumber).toBe(1);
  });

  it('removes an existing property and treats absence as done', async () => {
    arrange(['11']);
    setProp(site, '11', KEY, { enabled: 'true' });

    expect(await removeSpaceProperty('11', KEY)).toBe('deleted');
    expect(propOn(site, '11', KEY)).toBeUndefined();
    expect(await removeSpaceProperty('11', KEY)).toBe('absent');
  });
});
