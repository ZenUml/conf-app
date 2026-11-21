// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('bundle checkout routing', () => {
  it('routes both handoff paths to Functions, not the static SPA fallback', () => {
    const routes = JSON.parse(readFileSync(new URL('../../public/_routes.json', import.meta.url), 'utf8'));
    expect(routes.include).toContain('/bundle-checkout');
    expect(routes.include).toContain('/bundle-checkout/*');
  });
});
