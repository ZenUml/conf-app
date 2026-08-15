/**
 * Pins the byline enrolment property key across its three definitions, which
 * live in three files with no compile-time relationship:
 *
 * - manifest.yml templates it per variant: `zenuml-byline${LITE_KEY_SUFFIX}`
 *   (the display condition — what Confluence actually evaluates);
 * - scripts/forge-wizard.mjs owns the per-variant appId and liteKeySuffix
 *   values (the deploy-time substitution source);
 * - src/byline-visibility.ts derives the same key at runtime from the appId,
 *   because there is no evidence manifest environment variables reach the
 *   Forge function runtime.
 *
 * A drift in any one of the three does not error anywhere — the writer just
 * writes a key no condition reads, and the byline silently disappears on
 * every install of the drifted variant. Hence the three-way pin.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/api', () => ({
  default: { asApp: vi.fn() },
  getAppContext: vi.fn(),
  storage: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (result, fragment, index) =>
        result + fragment + (index < values.length ? String(values[index]) : ''),
      '',
    ),
}));

import { APPS } from '../../scripts/forge-wizard.mjs';
import {
  APP_SPACE_KEY_SUFFIXES,
  SPACE_PROP_BASE,
  spacePropertyKey,
} from '../../src/byline-visibility';
import { FULL_PRESENCE_KEY } from '../../src/full-presence';

const manifest = readFileSync(resolve(__dirname, '../../manifest.yml'), 'utf8');

describe('byline enrolment key: manifest ↔ wizard ↔ code', () => {
  it('the manifest condition uses the templated key, not a hardcoded variant', () => {
    expect(manifest).toContain(`propertyKey: ${SPACE_PROP_BASE}\${LITE_KEY_SUFFIX}`);
    // The template replaced a hardcoded `zenuml-byline-lite`; a bare literal
    // reappearing in a displayConditions block would undo that.
    expect(manifest).not.toMatch(/propertyKey: zenuml-byline-lite\b/);
  });

  it('the manifest not-leg subtracts the key full-presence actually writes', () => {
    expect(manifest).toContain(`propertyKey: ${FULL_PRESENCE_KEY}`);
  });

  it('code derives, for every variant, the key the manifest template resolves to', () => {
    const apps = Object.values(APPS) as Array<{
      appKey: string;
      appId: string;
      liteKeySuffix: string;
    }>;
    expect(apps.length).toBeGreaterThanOrEqual(4);
    for (const app of apps) {
      const manifestResolution = `${SPACE_PROP_BASE}${app.liteKeySuffix}`;
      expect(spacePropertyKey(app.appId), app.appKey).toBe(manifestResolution);
    }
  });

  it('the code map names exactly the wizard appIds, no extras', () => {
    const wizardIds = (Object.values(APPS) as Array<{ appId: string }>)
      .map((a) => a.appId)
      .sort();
    expect([...APP_SPACE_KEY_SUFFIXES.keys()].sort()).toEqual(wizardIds);
  });
});
