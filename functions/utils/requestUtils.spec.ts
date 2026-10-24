import { describe, expect, it } from 'vitest';
import { getAuthorizationHeader } from './requestUtils';

function request(authorization?: string): Request {
  return new Request('https://example.test', {
    headers: authorization ? { Authorization: authorization } : undefined,
  });
}

describe('getAuthorizationHeader', () => {
  it('accepts a single Bearer credential', () => {
    expect(getAuthorizationHeader(request('Bearer signed.jwt.value'))).toBe('signed.jwt.value');
  });

  it.each([
    undefined,
    'Basic signed.jwt.value',
    'Bearer',
    'Bearer one two',
    'Bearer  two-spaces',
  ])('rejects a missing or malformed authorization header: %s', (authorization) => {
    expect(getAuthorizationHeader(request(authorization))).toBeNull();
  });
});
