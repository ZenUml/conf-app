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
import { describe, expect, it, vi } from 'vitest';

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

import { ALLOWLIST, currentCloudId, decide, HIDDEN, VISIBLE } from './byline-visibility';

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
