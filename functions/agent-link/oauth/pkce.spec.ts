import { describe, it, expect } from 'vitest';
import { challengeFor, isValidChallenge, isValidVerifier, verifyPkce } from './pkce';

// The RFC 7636 Appendix B vector, which pins our base64url encoding to the
// spec's rather than to whatever our own round trip happens to agree with.
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('pkce', () => {
  it('computes the RFC 7636 example challenge', async () => {
    expect(await challengeFor(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
  });

  it('accepts the verifier that produced the challenge', async () => {
    expect(await verifyPkce(RFC_VERIFIER, RFC_CHALLENGE)).toBe(true);
  });

  it('rejects any other verifier', async () => {
    expect(await verifyPkce('a'.repeat(43), RFC_CHALLENGE)).toBe(false);
  });

  it('rejects a verifier outside the 43..128 length range', async () => {
    expect(isValidVerifier('a'.repeat(42))).toBe(false);
    expect(isValidVerifier('a'.repeat(43))).toBe(true);
    expect(isValidVerifier('a'.repeat(128))).toBe(true);
    expect(isValidVerifier('a'.repeat(129))).toBe(false);
  });

  it('rejects characters outside the unreserved set', async () => {
    expect(isValidVerifier(`${'a'.repeat(42)}/`)).toBe(false);
    expect(isValidChallenge(`${'a'.repeat(42)}+`)).toBe(false);
  });

  it('never treats a malformed challenge as a match', async () => {
    expect(await verifyPkce(RFC_VERIFIER, '')).toBe(false);
    expect(await verifyPkce('', '')).toBe(false);
  });
});
