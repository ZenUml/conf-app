import { describe, it, expect, vi, beforeEach } from 'vitest';

// Resolve a stable test user; the hook does `new ApWrapper2()._getCurrentUser()`.
const getCurrentUser = vi.fn(async () => ({ atlassianAccountId: 'acc-test-1' }));
vi.mock('@/model/ApWrapper2', () => ({
  default: class {
    _getCurrentUser = getCurrentUser;
  },
}));

import useCSATState from '@/hooks/useCSATState';

describe('useCSATState.markSuppressed', () => {
  beforeEach(() => {
    localStorage.clear();
    getCurrentUser.mockClear();
  });

  it('returns false (and writes nothing) before an account is resolved', () => {
    const { markSuppressed } = useCSATState();
    expect(markSuppressed()).toBe(false);
  });

  it('writes suppression synchronously once the account is resolved', async () => {
    const { checkStateOfCSAT, markSuppressed } = useCSATState();

    // Mount-time gate resolves + caches the account.
    expect(await checkStateOfCSAT()).toBeFalsy();

    // Synchronous: the write must land in this same tick, before any
    // view.close() the caller fires immediately after.
    expect(markSuppressed()).toBe(true);

    // Round-trip through a fresh hook instance: the user now reads as suppressed.
    const fresh = useCSATState();
    expect(await fresh.checkStateOfCSAT()).toBeTruthy();
  });

  it('reuses the account from checkStateOfCSAT instead of re-fetching', async () => {
    const { checkStateOfCSAT, markSuppressed } = useCSATState();
    await checkStateOfCSAT();
    markSuppressed();
    // One lookup total — markSuppressed must not trigger a second _getCurrentUser.
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('clearSuppressed reverses a suppression synchronously (Undo path)', async () => {
    const { checkStateOfCSAT, markSuppressed, clearSuppressed } = useCSATState();
    await checkStateOfCSAT();

    expect(markSuppressed()).toBe(true);
    expect(await useCSATState().checkStateOfCSAT()).toBeTruthy(); // suppressed

    expect(clearSuppressed()).toBe(true);
    expect(await useCSATState().checkStateOfCSAT()).toBeFalsy(); // restored
  });

  it('clearSuppressed returns false before an account is resolved', () => {
    const { clearSuppressed } = useCSATState();
    expect(clearSuppressed()).toBe(false);
  });
});
