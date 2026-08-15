/**
 * The allowlist that decides whether the Lite byline exists at all.
 *
 * Worth pinning at this level because the gate it feeds is fail-CLOSED and
 * therefore silent in both directions. A decision that wrongly returns HIDDEN
 * does not throw, log an error, or fail a build — the byline simply never
 * appears, on every install, and the only symptom is E2E specs failing to find
 * a button. A decision that wrongly returns VISIBLE exposes the surface on
 * tenants that were never enrolled. Neither shows up anywhere else in the
 * suite, so the mapping is asserted here directly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const forgeMocks = vi.hoisted(() => ({
  requestConfluence: vi.fn(),
  getAppContext: vi.fn(),
}));

vi.mock('@forge/api', () => ({
  default: {
    asApp: vi.fn(() => ({ requestConfluence: forgeMocks.requestConfluence })),
  },
  getAppContext: forgeMocks.getAppContext,
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (result, fragment, index) =>
        result + fragment + (index < values.length ? encodeURIComponent(String(values[index])) : ''),
      '',
    ),
}));

import {
  ALLOWLIST,
  currentCloudId,
  decide,
  HIDDEN,
  scheduledHandler,
  VISIBLE,
} from './byline-visibility';

/** Minimal stand-in for the Response `requestConfluence` resolves to. */
function res(status: number, body: unknown = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

/** The GET envelope: the stored value sits under `value`. */
const stored = (value: unknown) => res(200, { key: 'byline-enabled', value });

const LITE_STG = 'c78e721e-957f-402c-9b70-1df2227c2739';
const WHIMET4 = '866c3a03-ec62-4717-91c4-1ad078bfcc60';

describe('decide', () => {
  it('enrols the Lite E2E site', () => {
    const d = decide(LITE_STG);
    expect(d.value).toBe(VISIBLE);
    expect(d.decision).toBe('visible');
    expect(d.reason).toBe('enrolled');
    expect(d.site).toBe('lite-stg.atlassian.net');
  });

  it('enrols the developer site', () => {
    expect(decide(WHIMET4).value).toBe(VISIBLE);
  });

  it('suppresses an installation that is not on the allowlist', () => {
    const d = decide('00000000-0000-0000-0000-000000000000');
    expect(d.value).toBe(HIDDEN);
    expect(d.decision).toBe('suppressed');
    expect(d.reason).toBe('not_enrolled');
  });

  // The uncertainty case is the one that matters: an unresolvable cloudId must
  // land on the same side as an unenrolled one. Returning VISIBLE here would
  // turn every installation the runtime could not identify into a rollout.
  it('suppresses rather than enrols when the cloudId cannot be resolved', () => {
    const d = decide(undefined);
    expect(d.value).toBe(HIDDEN);
    expect(d.decision).toBe('suppressed');
    expect(d.reason).toBe('no_signal');
  });

  // Guards the manifest contract, not the code: `forge lint` rejects a boolean
  // in displayConditions.value, so a boolean here could never match the
  // condition this property exists to satisfy.
  it('produces string values, never booleans', () => {
    expect(typeof decide(LITE_STG).value).toBe('string');
    expect(typeof decide(undefined).value).toBe('string');
  });

  it('keeps the allowlist to our own sites', () => {
    expect([...ALLOWLIST.values()].sort()).toEqual([
      'lite-stg.atlassian.net',
      'whimet4.atlassian.net',
    ]);
  });
});

describe('currentCloudId', () => {
  it('reads the cloudId out of the installation contexts', () => {
    expect(currentCloudId({ installation: { contexts: [{ cloudId: LITE_STG }] } })).toBe(LITE_STG);
  });

  // Every entry's cloudId is optional in the SDK types, so indexing [0] would
  // return undefined for a context list whose first entry simply lacks one —
  // and undefined means suppressed, i.e. the byline silently disappears.
  it('skips context entries that carry no cloudId', () => {
    expect(currentCloudId({ installation: { contexts: [{}, { cloudId: WHIMET4 }] } })).toBe(WHIMET4);
  });

  it('returns undefined when there is no installation or no contexts', () => {
    expect(currentCloudId({})).toBeUndefined();
    expect(currentCloudId({ installation: {} })).toBeUndefined();
    expect(currentCloudId({ installation: { contexts: [] } })).toBeUndefined();
  });
});

/**
 * The stored SHAPE, which is where this feature has failed twice.
 *
 * Both failures answered a 2xx and left the byline hidden, so neither showed up
 * as an error anywhere — the only symptom was a display condition that silently
 * never matched. First the writer PUT `{key, value}` and the endpoint stored
 * that envelope AS the value, nesting it. Then it PUT the bare string "true",
 * which the endpoint rejects with 400 on create because it types the body as an
 * object — invisible in a spike against a site whose property already existed,
 * since that only ever exercised an update.
 *
 * So the body must be an object and the condition must address a field inside
 * it via `objectName`. These tests pin the exact bytes, because "it wrote
 * something and got a 200" is precisely the assertion that passed twice while
 * the feature was broken.
 */
describe('scheduledHandler', () => {
  beforeEach(() => {
    forgeMocks.requestConfluence.mockReset();
    forgeMocks.getAppContext.mockReset();
    forgeMocks.getAppContext.mockReturnValue({
      installation: { contexts: [{ cloudId: LITE_STG }] },
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('creates the property as an OBJECT when none exists', async () => {
    forgeMocks.requestConfluence
      .mockResolvedValueOnce(res(404))
      .mockResolvedValueOnce(res(200))
      .mockResolvedValueOnce(stored({ enabled: 'true' }));

    await scheduledHandler();

    const [, options] = forgeMocks.requestConfluence.mock.calls[1];
    expect(options.method).toBe('PUT');
    // Not `"true"` (400 on create) and not `{"key":…,"value":…}` (stored
    // verbatim and nested). The object carrying the flag, and nothing else.
    expect(options.body).toBe(JSON.stringify({ enabled: 'true' }));
    expect(JSON.parse(options.body)).toEqual({ enabled: 'true' });
  });

  it('writes HIDDEN for an installation that is not allowlisted', async () => {
    forgeMocks.getAppContext.mockReturnValue({
      installation: { contexts: [{ cloudId: '00000000-0000-0000-0000-000000000000' }] },
    });
    forgeMocks.requestConfluence
      .mockResolvedValueOnce(res(404))
      .mockResolvedValueOnce(res(200))
      .mockResolvedValueOnce(stored({ enabled: 'false' }));

    await scheduledHandler();

    expect(JSON.parse(forgeMocks.requestConfluence.mock.calls[1][1].body)).toEqual({
      enabled: HIDDEN,
    });
  });

  it('rewrites over the legacy double-wrapped value instead of reading it as settled', async () => {
    forgeMocks.requestConfluence
      .mockResolvedValueOnce(stored({ key: 'byline-enabled', value: 'true' }))
      .mockResolvedValueOnce(res(200))
      .mockResolvedValueOnce(stored({ enabled: 'true' }));

    await scheduledHandler();

    expect(forgeMocks.requestConfluence).toHaveBeenCalledTimes(3);
    expect(forgeMocks.requestConfluence.mock.calls[1][1].method).toBe('PUT');
  });

  it('rewrites over a legacy bare-string value', async () => {
    forgeMocks.requestConfluence
      .mockResolvedValueOnce(stored('true'))
      .mockResolvedValueOnce(res(200))
      .mockResolvedValueOnce(stored({ enabled: 'true' }));

    await scheduledHandler();

    expect(forgeMocks.requestConfluence.mock.calls[1][1].method).toBe('PUT');
  });

  // Idempotence: the steady state must cost one GET, or every install pays a
  // write every hour and 'unchanged' stops being observable.
  it('does not write when the stored field already matches', async () => {
    forgeMocks.requestConfluence.mockResolvedValueOnce(stored({ enabled: 'true' }));

    await scheduledHandler();

    expect(forgeMocks.requestConfluence).toHaveBeenCalledTimes(1);
  });
});
