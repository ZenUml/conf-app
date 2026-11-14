import { describe, it, expect } from 'vitest';
import { describeThrownFetchError } from './fetchErrorDiagnostics';

describe('describeThrownFetchError', () => {
  it('keeps the name and message of a Safari network failure', () => {
    expect(describeThrownFetchError(new TypeError('Load failed'))).toEqual({
      name: 'TypeError',
      message: 'Load failed',
    });
  });

  it('keeps the name and message of a Chrome network failure', () => {
    expect(describeThrownFetchError(new TypeError('Failed to fetch'))).toEqual({
      name: 'TypeError',
      message: 'Failed to fetch',
    });
  });

  it('uses a custom error name such as BridgeAPIError', () => {
    class BridgeAPIError extends Error {}
    const e = new BridgeAPIError('Unable to establish a connection with the Custom UI bridge.');
    e.name = 'BridgeAPIError';
    expect(describeThrownFetchError(e).name).toBe('BridgeAPIError');
  });

  it('replaces long digit runs, emails and URL query strings so no ids or addresses leave the browser', () => {
    const { message } = describeThrownFetchError(
      new Error('GET /wiki/api/v2/custom-content/4773806111?body-format=raw failed for jane.doe@example.com'),
    );
    expect(message).toBe('GET /wiki/api/v2/custom-content/{n} failed for {email}');
  });

  it('collapses whitespace and truncates to 100 characters', () => {
    const { message } = describeThrownFetchError(new Error(`a\n\n  b ${'x'.repeat(200)}`));
    expect(message.startsWith('a b x')).toBe(true);
    expect(message.length).toBe(100);
  });

  it('describes a non-Error rejection by its type', () => {
    expect(describeThrownFetchError('timeout')).toEqual({ name: 'string', message: 'timeout' });
    expect(describeThrownFetchError(undefined)).toEqual({ name: 'undefined', message: '' });
    expect(describeThrownFetchError({ message: 'bridge closed' })).toEqual({ name: 'object', message: 'bridge closed' });
  });
});
