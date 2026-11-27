import { describe, expect, it } from 'vitest';
import {
  forgeMacroNode,
  legacyMacroNode,
  selectForgeIdentity,
  type ForgeExtensionRow,
} from '../e2e-tests/utils/forge-extension';

// lite-dev on 2026-11-23: the PR slot environment `pr` and a PR dev environment
// `pr-1284` of the same Lite app both expose `zenuml-sequence-macro-lite`. A
// bare-key ADF node resolved to `pr-1284`, so the agent-link E2E on PR #1297
// tested the wrong build.
const LITE = '8ad26115-211f-4216-971b-0540f606303d';
const PR_ENV = '89cd3bf7-c5bb-48c9-8461-937b2c2f66b0';
const PR_1284_ENV = '338ff9cd-27a2-489a-9d5f-ea6366ada37f';
const row = (environmentKey: string, environmentId: string, key: string, appId = LITE): ForgeExtensionRow => ({
  appId,
  environmentId,
  environmentKey,
  key,
});
const liteDev: ForgeExtensionRow[] = [
  row('pr-1284', PR_1284_ENV, 'zenuml-sequence-macro-lite'),
  row('pr', PR_ENV, 'zenuml-sequence-macro-lite'),
  row('pr', PR_ENV, 'zenuml-graph-macro-lite'),
  row('production', 'bb47be6b-c735-4b9d-95da-925a54bb07ef', 'aws-widget-macro', 'bd4e3a18-0000-0000-0000-000000000000'),
];

describe('selectForgeIdentity', () => {
  it('picks the named environment when two environments of the app share the macro', () => {
    expect(selectForgeIdentity(liteDev, { appId: LITE, moduleKey: 'zenuml-sequence-macro-lite', environmentKey: 'pr' }))
      .toEqual({ appId: LITE, environmentId: PR_ENV, environmentKey: 'pr', environmentCount: 2 });
  });

  it('refuses to guess between two environments when none is named', () => {
    expect(() => selectForgeIdentity(liteDev, { appId: LITE, moduleKey: 'zenuml-sequence-macro-lite' }))
      .toThrow(/2 environments .*pr-1284, pr/);
  });

  it('uses the only environment when none is named', () => {
    const single = liteDev.filter((r) => r.environmentKey !== 'pr-1284');
    expect(selectForgeIdentity(single, { appId: LITE, moduleKey: 'zenuml-sequence-macro-lite' }))
      .toMatchObject({ environmentId: PR_ENV, environmentCount: 1 });
  });

  it('fails with the installed environments when the named one is missing', () => {
    expect(() => selectForgeIdentity(liteDev, { appId: LITE, moduleKey: 'zenuml-sequence-macro-lite', environmentKey: 'staging' }))
      .toThrow(/staging.*pr-1284, pr/);
  });

  it('ignores another app that exposes the same module key', () => {
    const rows = [...liteDev.filter((r) => r.environmentKey === 'pr'), row('production', 'x', 'zenuml-sequence-macro-lite', 'other-app')];
    expect(selectForgeIdentity(rows, { appId: LITE, moduleKey: 'zenuml-sequence-macro-lite' }))
      .toMatchObject({ environmentId: PR_ENV });
  });
});

describe('forgeMacroNode', () => {
  it('writes the full Forge key of the environment under test and the config the macro reads', () => {
    const node = forgeMacroNode({ appId: LITE, environmentId: PR_ENV }, 'zenuml-sequence-macro-lite', {
      uuid: 'u1',
      customContentId: '$$_SEQUENCE_CONTENT_ID',
      updatedAt: '2022-08-14T12:00:03Z',
    }, 'local-1');
    expect(node).toEqual({
      type: 'extension',
      attrs: {
        layout: 'default',
        extensionType: 'com.atlassian.ecosystem',
        extensionKey: `${LITE}/${PR_ENV}/static/zenuml-sequence-macro-lite`,
        parameters: {
          layout: 'extension',
          extensionId: `ari:cloud:ecosystem::extension/${LITE}/${PR_ENV}/static/zenuml-sequence-macro-lite`,
          guestParams: { uuid: 'u1', customContentId: '$$_SEQUENCE_CONTENT_ID', updatedAt: '2022-08-14T12:00:03Z' },
        },
        localId: 'local-1',
      },
    });
  });
});

describe('legacyMacroNode', () => {
  it('keeps the bare module key that migrated Connect pages carry', () => {
    const node = legacyMacroNode('zenuml-sequence-macro-lite', 'ZenUML Diagram', { uuid: { value: 'u1' } });
    expect(node.attrs.extensionType).toBe('com.atlassian.confluence.macro.core');
    expect(node.attrs.extensionKey).toBe('zenuml-sequence-macro-lite');
    expect(node.attrs.parameters.macroParams).toEqual({ uuid: { value: 'u1' } });
    expect(node.attrs.parameters.macroMetadata.title).toBe('ZenUML Diagram');
  });
});
