import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CSAT_PENDING_KEY,
  CSAT_PENDING_MAX_AGE_MS,
  markCsatPending,
  isCsatPendingFresh,
  clearCsatPending,
} from '@/utils/csat';
import { getLocalStorageKey } from '@/utils/window';

// The stored key is tenant-scoped (csatPending-<clientDomain>), so tests that
// poke storage directly must go through getLocalStorageKey — the same key the
// helpers use — rather than the raw base key.
const scopedKey = () => getLocalStorageKey(CSAT_PENDING_KEY);

// These helpers guard the survey trigger: a localStorage failure (quota,
// disabled storage, partitioned cross-origin iframe) must never propagate
// into the save path or strand the pageBanner. Each test that forces a throw
// also asserts the swallow does not rethrow.
describe('csat pending helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('markCsatPending', () => {
    it('writes a fresh timestamp under the tenant-scoped key, not the raw key', () => {
      const before = Date.now();
      markCsatPending();
      // Tenant-scoped, not raw — guards against the cross-tenant leak (#4).
      expect(localStorage.getItem(CSAT_PENDING_KEY)).toBeNull();
      const stored = Number(localStorage.getItem(scopedKey()));
      expect(stored).toBeGreaterThanOrEqual(before);
    });

    it('swallows a setItem failure instead of throwing into the save path', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota exceeded');
      });
      expect(() => markCsatPending()).not.toThrow();
    });
  });

  describe('isCsatPendingFresh', () => {
    it('is true for a timestamp inside the freshness window', () => {
      const now = 1_000_000_000_000;
      localStorage.setItem(scopedKey(), String(now - 1000));
      expect(isCsatPendingFresh(now)).toBe(true);
    });

    it('is false for a timestamp past the freshness window', () => {
      const now = 1_000_000_000_000;
      localStorage.setItem(scopedKey(), String(now - CSAT_PENDING_MAX_AGE_MS - 1));
      expect(isCsatPendingFresh(now)).toBe(false);
    });

    it('is false when nothing is stored', () => {
      expect(isCsatPendingFresh()).toBe(false);
    });

    it('round-trips with markCsatPending', () => {
      markCsatPending();
      expect(isCsatPendingFresh()).toBe(true);
    });

    it('is false (not a throw) when getItem fails', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage disabled');
      });
      let result: boolean | undefined;
      expect(() => {
        result = isCsatPendingFresh();
      }).not.toThrow();
      expect(result).toBe(false);
    });
  });

  describe('clearCsatPending', () => {
    it('removes the tenant-scoped pending key so the trigger fires once', () => {
      markCsatPending();
      clearCsatPending();
      expect(localStorage.getItem(scopedKey())).toBeNull();
      expect(isCsatPendingFresh()).toBe(false);
    });

    it('swallows a removeItem failure', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('storage disabled');
      });
      expect(() => clearCsatPending()).not.toThrow();
    });
  });
});
