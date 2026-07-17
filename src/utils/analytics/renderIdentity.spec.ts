import { describe, expect, it } from 'vitest';
import { getRenderIdentity } from './renderIdentity';

describe('getRenderIdentity', () => {
  it('returns an iframe-scoped nonce and time origin', () => {
    const identity = getRenderIdentity();

    expect(identity.instance_nonce).toMatch(/[0-9a-f-]{36}/);
    expect(identity.time_origin).toBeTypeOf('number');
  });

  it('returns the same identity across repeated calls', () => {
    expect(getRenderIdentity()).toEqual(getRenderIdentity());
  });
});
