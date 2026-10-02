import { describe, expect, it, vi } from 'vitest';
import { verifyBackend } from '../../scripts/test-selection/verify-backend.mjs';
const response = (body, type = 'application/json', ok = true) => ({ ok, headers: new Headers({ 'content-type': type }), json: async () => body });
const options = { sha: 'abc', variant: 'lite', url: 'https://example.com', delayMs: 0 };
describe('pinned backend version', () => {
  it('requires matching SHA and variant from JSON response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ sha: 'abc', variant: 'lite' }));
    expect(await verifyBackend({ ...options, fetchImpl })).toEqual({ sha: 'abc', variant: 'lite', verified: true });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://example.com/__ci-version.json');
  });
  it('rejects HTML fallback, wrong SHA, wrong variant and HTTP errors', async () => {
    for (const value of [response({ sha: 'abc', variant: 'lite' }, 'text/html'), response({ sha: 'other', variant: 'lite' }), response({ sha: 'abc', variant: 'full' }), response({ sha: 'abc', variant: 'lite' }, 'application/json', false)]) {
      await expect(verifyBackend({ ...options, attempts: 1, fetchImpl: vi.fn().mockResolvedValue(value) })).rejects.toThrow('verification failed');
    }
  });
  it('retries propagation failures with bounded attempts and safe errors', async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error('secret')).mockResolvedValueOnce(response({ sha: 'abc', variant: 'lite' }));
    const sleep = vi.fn();
    await verifyBackend({ ...options, fetchImpl, sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
    const failing = vi.fn().mockRejectedValue(new Error('secret'));
    await expect(verifyBackend({ ...options, attempts: 99, fetchImpl: failing, sleep })).rejects.not.toThrow('secret');
    expect(failing).toHaveBeenCalledTimes(6);
  });
});
