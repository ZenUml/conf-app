import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PendingOps } from './pendingOps';

describe('PendingOps', () => {
  it('register resolves with the matching result when resolve(id, ...) is called', async () => {
    const ops = new PendingOps();
    const promise = ops.register('req-1', 20_000);

    expect(ops.resolve('req-1', { ok: true, payload: { hello: 'world' } })).toBe(true);

    await expect(promise).resolves.toEqual({ ok: true, payload: { hello: 'world' } });
  });

  it('resolve returns false for an unknown id and does not throw', () => {
    const ops = new PendingOps();
    expect(ops.resolve('never-registered', { ok: true, payload: {} })).toBe(false);
  });

  it('resolve returns false once the same id has already been resolved (settles once)', () => {
    const ops = new PendingOps();
    ops.register('req-1', 20_000);

    expect(ops.resolve('req-1', { ok: true, payload: 1 })).toBe(true);
    expect(ops.resolve('req-1', { ok: true, payload: 2 })).toBe(false);
  });

  it('tracks distinct in-flight ops independently via size', () => {
    const ops = new PendingOps();
    ops.register('a', 20_000);
    ops.register('b', 20_000);
    expect(ops.size).toBe(2);

    ops.resolve('a', { ok: true, payload: {} });
    expect(ops.size).toBe(1);

    ops.resolve('b', { ok: false, payload: { message: 'boom' } });
    expect(ops.size).toBe(0);
  });

  describe('timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('settles with { timedOut: true } after timeoutMs with no resolve() call', async () => {
      const ops = new PendingOps();
      const promise = ops.register('req-1', 20_000);

      await vi.advanceTimersByTimeAsync(20_000);

      await expect(promise).resolves.toEqual({ timedOut: true });
      expect(ops.size).toBe(0);
    });

    it('does not time out if resolve() arrives before the deadline', async () => {
      const ops = new PendingOps();
      const promise = ops.register('req-1', 20_000);

      await vi.advanceTimersByTimeAsync(19_000);
      ops.resolve('req-1', { ok: true, payload: 'in time' });
      await vi.advanceTimersByTimeAsync(2_000); // past the original deadline

      await expect(promise).resolves.toEqual({ ok: true, payload: 'in time' });
    });

    it('a late resolve() after timeout is a no-op (returns false, does not re-settle)', async () => {
      const ops = new PendingOps();
      const promise = ops.register('req-1', 20_000);

      await vi.advanceTimersByTimeAsync(20_000);
      expect(ops.resolve('req-1', { ok: true, payload: 'too late' })).toBe(false);

      await expect(promise).resolves.toEqual({ timedOut: true });
    });
  });

  describe('cancel', () => {
    it('removes a pending registration without settling its promise or leaking the timer', () => {
      vi.useFakeTimers();
      const ops = new PendingOps();
      ops.register('req-1', 20_000);
      expect(ops.size).toBe(1);

      ops.cancel('req-1');
      expect(ops.size).toBe(0);
      // Resolving after cancel is a no-op — the registration is gone.
      expect(ops.resolve('req-1', { ok: true, payload: {} })).toBe(false);

      vi.useRealTimers();
    });

    it('is a safe no-op for an unknown id', () => {
      const ops = new PendingOps();
      expect(() => ops.cancel('never-registered')).not.toThrow();
    });
  });
});
