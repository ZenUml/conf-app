/**
 * Pins the Lite byline's display condition (manifest.yml,
 * zenuml-byline-diagrams) to the one writer it depends on.
 *
 * The condition is a single `not entityPropertyExists zenuml-full-active` leg,
 * and src/full-presence.ts writes that key from the Full app. A rename on
 * either side errors nowhere — the Lite byline would just stop hiding beside
 * Full — hence the pin.
 *
 * It also pins the ABSENCE of an opt-in enrolment leg. Until 2026-10 the
 * condition ANDed a fail-closed `zenuml-byline${LITE_KEY_SUFFIX}` property
 * that only an hourly sweep of every space could satisfy, and that sweep was
 * the largest Forge Functions cost. Re-adding an opt-in leg without a writer
 * hides the byline everywhere, so it must be a deliberate edit to this test.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/api', () => ({
  default: { asApp: vi.fn() },
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (result, fragment, index) =>
        result + fragment + (index < values.length ? String(values[index]) : ''),
      '',
    ),
}));

import { FULL_PRESENCE_KEY } from '../../src/full-presence';

const manifest = load(readFileSync(resolve(__dirname, '../../manifest.yml'), 'utf8')) as {
  modules: Record<string, Array<{ key: string; displayConditions?: unknown }>>;
};

describe('Lite byline display condition', () => {
  it('hides only where the Full presence marker exists', () => {
    const byline = manifest.modules['confluence:contentBylineItem'].find(
      (m) => m.key === 'zenuml-byline-diagrams',
    );
    expect(byline?.displayConditions).toEqual({
      not: { entityPropertyExists: { entity: 'space', propertyKey: FULL_PRESENCE_KEY } },
    });
  });

  it('leaves no enrolment sweep behind', () => {
    const fns = manifest.modules.function.map((m) => m.key);
    const triggers = manifest.modules.scheduledTrigger.map((m) => m.key);
    expect(fns).not.toContain('bylineVisibilityFn');
    expect(triggers).not.toContain('byline-visibility-hourly');
  });
});
