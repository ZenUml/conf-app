import { describe, expect, it } from 'vitest';
import { isFullscreenRecoveryEligible } from './fullscreenRecoveryEligibility';
const base = { isLite: true, count: 100, countSource: 'kv', paidKnown: true, paid: false, policySource: 'default_on', spaceKey: 'SPACE' };
describe('Fullscreen over-limit eligibility', () => {
  it('requires 100 confirmed diagrams in this space', () => {
    expect(isFullscreenRecoveryEligible({ ...base, count: 99 })).toBe(false);
    expect(isFullscreenRecoveryEligible(base)).toBe(true);
  });
  it.each([{ paid: true }, { paidKnown: false }, { countSource: 'undefined' }, { countSource: 'zero' },
    { policySource: 'fail_open' }, { spaceKey: undefined }, { isLite: false }, { count: NaN }])('keeps ordinary access when eligibility is not confirmed: %j', change => {
    expect(isFullscreenRecoveryEligible({ ...base, ...change })).toBe(false);
  });
});
