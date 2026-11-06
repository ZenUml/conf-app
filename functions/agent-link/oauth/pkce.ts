// PKCE (RFC 7636), S256 only.
//
// What it defends against here: our authorization code travels back through
// the MCP client's registered redirect_uri, which for a CLI agent is usually
// http://127.0.0.1 on a port any other local process could have raced for. A
// code intercepted there is worthless without the verifier, which never leaves
// the client that generated it.
//
// `plain` is not implemented. It is in the RFC, OAuth 2.1 removes it, and it
// reduces the challenge to the secret itself — an interceptor who has the code
// has the challenge too. asMetadata.ts advertises only S256 so a conforming
// client never asks for it.

const BASE64URL = /^[A-Za-z0-9\-._~]+$/;
/** RFC 7636 §4.1: 43–128 characters. */
const MIN_VERIFIER = 43;
const MAX_VERIFIER = 128;

export function isValidChallenge(challenge: unknown): challenge is string {
  return typeof challenge === 'string' && challenge.length >= 43 && challenge.length <= 128 && BASE64URL.test(challenge);
}

export function isValidVerifier(verifier: unknown): verifier is string {
  return (
    typeof verifier === 'string' &&
    verifier.length >= MIN_VERIFIER &&
    verifier.length <= MAX_VERIFIER &&
    BASE64URL.test(verifier)
  );
}

function base64Url(bytes: ArrayBuffer): string {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** BASE64URL(SHA256(verifier)), the value a client sends as `code_challenge`. */
export async function challengeFor(verifier: string): Promise<string> {
  return base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

/**
 * Does `verifier` match the challenge recorded at /authorize?
 *
 * Constant-time-ish by construction: both sides are fixed-length base64url of
 * a SHA-256 digest, and the comparison folds every character rather than
 * returning at the first difference.
 */
export async function verifyPkce(verifier: string, challenge: string): Promise<boolean> {
  if (!isValidVerifier(verifier) || !isValidChallenge(challenge)) return false;
  const computed = await challengeFor(verifier);
  if (computed.length !== challenge.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i += 1) diff |= computed.charCodeAt(i) ^ challenge.charCodeAt(i);
  return diff === 0;
}
