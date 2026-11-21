import { describe, expect, it } from 'vitest';
import { DEV_CONNECT_KEYS, devConnectKeyFor, devConnectKeysForApp, type DevConnectKey } from './devConnectKeys';
import { VARIANTS, customContentTypesFor, customContentTypesForEnvironment } from '../agent-link/macroIdentity';

const LITE = '8ad26115-211f-4216-971b-0540f606303d';
const table: DevConnectKey[] = [
  { appId: LITE, environmentId: '11111111-2222-4333-8444-555555555555', connectKey: 'com.zenuml.confluence-addon-lite-a' },
  { appId: LITE, environmentId: '66666666-7777-4888-8999-000000000000', connectKey: 'com.zenuml.confluence-addon-lite-b' },
];

describe('DEV_CONNECT_KEYS table', () => {
  const fixedKeys = VARIANTS.map((v) => v.connectKey);

  it.each(DEV_CONNECT_KEYS.map((e) => [e.connectKey, e]))('%s is a well-formed development entry', (_key, entry) => {
    expect(VARIANTS.map((v) => v.appId)).toContain(entry.appId);
    expect(entry.environmentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // Same rule vite.config.mjs applies to CONNECT_KEY_OVERRIDE at build time.
    expect(entry.connectKey).toMatch(/^[a-z0-9][a-z0-9.-]{2,62}$/);
    // A fixed key here would let a development FIT write into a shipped variant's types.
    expect(fixedKeys).not.toContain(entry.connectKey);
  });

  it('gives each environment and each key one entry', () => {
    expect(new Set(DEV_CONNECT_KEYS.map((e) => e.environmentId)).size).toBe(DEV_CONNECT_KEYS.length);
    expect(new Set(DEV_CONNECT_KEYS.map((e) => e.connectKey)).size).toBe(DEV_CONNECT_KEYS.length);
  });
});

describe('lookups', () => {
  it('lists every key registered for an app, and none for another', () => {
    expect(devConnectKeysForApp(LITE, table)).toEqual(['com.zenuml.confluence-addon-lite-a', 'com.zenuml.confluence-addon-lite-b']);
    expect(devConnectKeysForApp('d9e4002b-120b-426b-834b-402a4a5adce7', table)).toEqual([]);
  });

  it('finds one environment by bare UUID or by the FIT environment ARI', () => {
    expect(devConnectKeyFor(LITE, '66666666-7777-4888-8999-000000000000', table)).toBe('com.zenuml.confluence-addon-lite-b');
    expect(devConnectKeyFor(LITE, `ari:cloud:ecosystem::environment/${LITE}/11111111-2222-4333-8444-555555555555`, table))
      .toBe('com.zenuml.confluence-addon-lite-a');
  });

  it('refuses an environment registered under a different app', () => {
    expect(devConnectKeyFor('d9e4002b-120b-426b-834b-402a4a5adce7', '11111111-2222-4333-8444-555555555555', table)).toBeUndefined();
    expect(devConnectKeyFor(LITE, '99999999-2222-4333-8444-555555555555', table)).toBeUndefined();
  });
});

describe('agent-link content types with a development key', () => {
  const lite = VARIANTS.find((v) => v.variant === 'lite')!;
  const alt = DEV_CONNECT_KEYS.find((e) => e.appId === LITE)!;

  it('discovers the fixed key first, then the registered development keys', () => {
    const types = customContentTypesFor(lite);
    expect(types.slice(0, 2)).toEqual([
      'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence',
      'ac:com.zenuml.confluence-addon-lite:zenuml-content-graph',
    ]);
    expect(types).toContain(`ac:${alt.connectKey}:zenuml-content-sequence`);
  });

  it('writes under the resolved environment key only', () => {
    expect(customContentTypesForEnvironment(lite, alt.environmentId)).toEqual([
      `ac:${alt.connectKey}:zenuml-content-sequence`,
      `ac:${alt.connectKey}:zenuml-content-graph`,
    ]);
    expect(customContentTypesForEnvironment(lite, '99999999-2222-4333-8444-555555555555')).toEqual([
      'ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence',
      'ac:com.zenuml.confluence-addon-lite:zenuml-content-graph',
    ]);
  });

  it('leaves variants without a development key unchanged', () => {
    const full = VARIANTS.find((v) => v.variant === 'full')!;
    expect(customContentTypesFor(full)).toEqual([
      'ac:com.zenuml.confluence-addon:zenuml-content-sequence',
      'ac:com.zenuml.confluence-addon:zenuml-content-graph',
    ]);
  });
});
