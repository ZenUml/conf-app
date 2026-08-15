/**
 * The allowlist that decides whether the Lite byline exists at all, and the
 * space sweep that materialises it.
 *
 * Worth pinning at this level because the gate it feeds is fail-CLOSED and
 * therefore silent in both directions. A decision that wrongly returns HIDDEN
 * does not throw, log an error, or fail a build — the byline simply never
 * appears, on every install, and the only symptom is E2E specs failing to find
 * a button. A decision that wrongly returns VISIBLE exposes the surface on
 * tenants that were never enrolled. Neither shows up anywhere else in the
 * suite, so the mapping is asserted here directly.
 *
 * The sweep tests run against src/space-properties.fixtures.ts, which models
 * the API contracts rather than replaying canned responses — the PUT version
 * sequence and the app-property body-is-value trap are enforced there, so a
 * regression in either fails these tests instead of the next deployment.
 *
 * Key derivation (appId → property key) is additionally pinned against the
 * manifest template and scripts/forge-wizard.mjs in
 * tests/unit/bylineKeyConsistency.spec.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const forgeMocks = vi.hoisted(() => ({
  requestConfluence: vi.fn(),
  getAppContext: vi.fn(),
  storage: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@forge/api', () => ({
  default: {
    asApp: vi.fn(() => ({ requestConfluence: forgeMocks.requestConfluence })),
  },
  getAppContext: forgeMocks.getAppContext,
  storage: forgeMocks.storage,
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
  spacePropertyKey,
  VISIBLE,
} from './byline-visibility';
import {
  fakeConfluence,
  fakeStorage,
  makeSite,
  propOn,
  setProp,
  type FakeSite,
} from './space-properties.fixtures';

const LITE_STG = 'c78e721e-957f-402c-9b70-1df2227c2739';
const WHIMET4 = '866c3a03-ec62-4717-91c4-1ad078bfcc60';
const NOBODY = '00000000-0000-0000-0000-000000000000';

const LITE_APP = '8ad26115-211f-4216-971b-0540f606303d';
const FULL_APP = 'd9e4002b-120b-426b-834b-402a4a5adce7';

const KEY = 'zenuml-byline-lite';
const STATE = 'byline-visibility-state';

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
    const d = decide(NOBODY);
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

describe('spacePropertyKey', () => {
  // These resolutions must equal the manifest template
  // `zenuml-byline${LITE_KEY_SUFFIX}` for each variant — pinned three-way
  // (code, wizard, manifest) in tests/unit/bylineKeyConsistency.spec.ts.
  it('resolves the Lite key with the -lite suffix', () => {
    expect(spacePropertyKey(LITE_APP)).toBe('zenuml-byline-lite');
  });

  it('resolves the Full key with no suffix', () => {
    expect(spacePropertyKey(FULL_APP)).toBe('zenuml-byline');
  });

  it('returns undefined for an unknown or missing appId', () => {
    expect(spacePropertyKey('not-an-app')).toBeUndefined();
    expect(spacePropertyKey(undefined)).toBeUndefined();
  });
});

describe('scheduledHandler', () => {
  let site: FakeSite;

  function arrange(cloudId: string, opts: { spaces?: string[]; appId?: string } = {}) {
    site = makeSite(opts.spaces ?? ['11', '22', '33']);
    forgeMocks.requestConfluence.mockImplementation(fakeConfluence(site));
    const store = fakeStorage(site);
    forgeMocks.storage.get.mockImplementation(store.get);
    forgeMocks.storage.set.mockImplementation(store.set);
    forgeMocks.storage.delete.mockImplementation(store.delete);
    forgeMocks.getAppContext.mockReturnValue({
      installation: { contexts: [{ cloudId }] },
      appAri: { appId: opts.appId ?? LITE_APP },
    });
  }

  beforeEach(() => {
    forgeMocks.requestConfluence.mockReset();
    forgeMocks.getAppContext.mockReset();
    forgeMocks.storage.get.mockReset();
    forgeMocks.storage.set.mockReset();
    forgeMocks.storage.delete.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('enrolment writes the space property to EVERY space and marks the state', async () => {
    arrange(LITE_STG);

    await scheduledHandler();

    for (const spaceId of site.spaces) {
      expect(propOn(site, spaceId, KEY)?.value, `space ${spaceId}`).toEqual({ enabled: 'true' });
    }
    expect(site.storage.get(STATE)).toBe('enrolled');
  });

  it('deletes the vestigial byline-enabled app property on the enrolment transition', async () => {
    arrange(LITE_STG);
    site.appProps.set('byline-enabled', { enabled: 'true' });

    await scheduledHandler();

    expect(site.appProps.has('byline-enabled')).toBe(false);
  });

  it('a settled enrolled site does not write on later ticks', async () => {
    arrange(LITE_STG);
    await scheduledHandler();
    site.calls.length = 0;
    forgeMocks.storage.set.mockClear();

    await scheduledHandler();

    expect(site.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    expect(forgeMocks.storage.set).not.toHaveBeenCalled();
  });

  // The update path must follow the documented version sequence — the fixture
  // answers 409 to anything but current+1, so a wrong bump shows up here as a
  // failed sweep rather than on staging.
  it('corrects a wrong stored value via a versioned update', async () => {
    arrange(LITE_STG, { spaces: ['11'] });
    setProp(site, '11', KEY, { enabled: 'false' }, 3);

    await scheduledHandler();

    const prop = propOn(site, '11', KEY);
    expect(prop?.value).toEqual({ enabled: 'true' });
    expect(prop?.version).toBe(4);
  });

  // Absence is the hidden state: a suppressed installation KNOWN to be clean
  // must cost one storage read per tick and touch Confluence not at all.
  it('a suppressed site in the clean state makes zero Confluence requests', async () => {
    arrange(NOBODY);
    site.storage.set(STATE, 'clean');

    await scheduledHandler();

    expect(site.calls).toEqual([]);
  });

  it('un-enrolment sweeps the properties away, marks clean, and drops the legacy property', async () => {
    arrange(NOBODY);
    for (const spaceId of site.spaces) setProp(site, spaceId, KEY, { enabled: 'true' });
    site.storage.set(STATE, 'enrolled');
    site.appProps.set('byline-enabled', { enabled: 'true' });

    await scheduledHandler();

    for (const spaceId of site.spaces) {
      expect(propOn(site, spaceId, KEY)).toBeUndefined();
    }
    expect(site.storage.get(STATE)).toBe('clean');
    expect(site.appProps.has('byline-enabled')).toBe(false);
  });

  // First tick after this code deploys: no storage state exists anywhere, so a
  // suppressed installation converges with ONE sweep (which also clears any
  // stale properties from earlier revisions) and is clean thereafter.
  it('a suppressed site with unknown state converges to clean via one sweep', async () => {
    arrange(NOBODY);

    await scheduledHandler();
    expect(site.storage.get(STATE)).toBe('clean');
    site.calls.length = 0;

    await scheduledHandler();
    expect(site.calls).toEqual([]);
  });

  // The marker asserts "the spaces are settled", so it must survive a tick
  // that could not finish — otherwise a partial clear never retries and stale
  // `enabled:"true"` properties strand on the skipped spaces forever.
  it('keeps the state when the un-enrolment sweep cannot complete', async () => {
    arrange(NOBODY, { spaces: ['11', '22'] });
    for (const spaceId of site.spaces) setProp(site, spaceId, KEY, { enabled: 'true' });
    site.storage.set(STATE, 'enrolled');
    const inner = fakeConfluence(site);
    forgeMocks.requestConfluence.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === 'DELETE' && url.includes('/spaces/22/')) {
        return { ok: false, status: 500, text: async () => '' };
      }
      return inner(url, init);
    });

    await scheduledHandler();

    expect(site.storage.get(STATE)).toBe('enrolled');
    expect(propOn(site, '22', KEY)).toBeDefined();
  });

  it('does not claim enrolment when the space listing itself fails', async () => {
    arrange(LITE_STG);
    forgeMocks.requestConfluence.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url.startsWith('/wiki/api/v2/spaces?')) {
        return { ok: false, status: 500, text: async () => '' };
      }
      return fakeConfluence(site)(url, init);
    });

    await scheduledHandler();

    expect(site.storage.get(STATE)).toBeUndefined();
  });

  // An app outside the suffix map has no key that any display condition reads.
  // Writing under a guessed key would litter every space with junk that
  // satisfies nothing — the handler must write NOTHING, not guess.
  it('writes nothing when the appId has no property key mapping', async () => {
    arrange(LITE_STG, { appId: 'not-an-app' });

    await scheduledHandler();

    expect(site.calls).toEqual([]);
    expect(site.storage.size).toBe(0);
  });
});
