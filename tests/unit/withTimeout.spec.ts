import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withDeadline, withTimeout } from '@/lib/withTimeout.js';

describe('withTimeout / withDeadline', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  describe('withTimeout', () => {
    it('resolves and clears its timer when work settles first', async () => {
      await expect(withTimeout(Promise.resolve('ok'), 1000, () => new Error('t'))).resolves.toBe('ok');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('propagates a work rejection before the timeout and clears the timer', async () => {
      const boom = new Error('boom');
      await expect(withTimeout(Promise.reject(boom), 1000, () => new Error('t'))).rejects.toBe(boom);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects with onTimeout() when ms elapses first', async () => {
      const timeoutError = new Error('timed out');
      const result = withTimeout(new Promise(() => {}), 1000, () => timeoutError);
      const assertion = expect(result).rejects.toBe(timeoutError);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      expect(vi.getTimerCount()).toBe(0);
    });

    it('does not call onTimeout when work settles first', async () => {
      const onTimeout = vi.fn(() => new Error('t'));
      await withTimeout(Promise.resolve(1), 1000, onTimeout);
      await vi.advanceTimersByTimeAsync(5000);
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it('does not raise an unhandled rejection when work rejects after the timeout', async () => {
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        let rejectWork!: (e: Error) => void;
        const work = new Promise<never>((_, reject) => { rejectWork = reject; });
        const result = withTimeout(work, 1000, () => new Error('timed out'));
        const assertion = expect(result).rejects.toThrow('timed out');
        await vi.advanceTimersByTimeAsync(1000);
        await assertion;
        rejectWork(new Error('late'));
        await vi.advanceTimersByTimeAsync(0);
        await new Promise<void>((r) => { vi.useRealTimers(); setTimeout(r, 0); });
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });
  });

  describe('withDeadline', () => {
    it('resolves work value and clears its timer when work settles first', async () => {
      await expect(withDeadline(Promise.resolve('ok'), 1000, 'fallback')).resolves.toBe('ok');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('propagates a work rejection before the deadline and clears the timer', async () => {
      const boom = new Error('boom');
      await expect(withDeadline(Promise.reject(boom), 1000, 'fallback')).rejects.toBe(boom);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('resolves the fallback when ms elapses first', async () => {
      const result = withDeadline(new Promise(() => {}), 1000, 'fallback');
      await vi.advanceTimersByTimeAsync(1000);
      await expect(result).resolves.toBe('fallback');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('does not raise an unhandled rejection when work rejects after the deadline', async () => {
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        let rejectWork!: (e: Error) => void;
        const work = new Promise<never>((_, reject) => { rejectWork = reject; });
        const result = withDeadline(work, 1000, undefined);
        await vi.advanceTimersByTimeAsync(1000);
        await expect(result).resolves.toBeUndefined();
        rejectWork(new Error('late'));
        await new Promise<void>((r) => { vi.useRealTimers(); setTimeout(r, 0); });
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });
  });
});
