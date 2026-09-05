import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CSAT_STATE_KEY, isCsatSuppressed, isCsatSuppressedForAccount } from './csat';
import { getLocalState } from '@/utils/window';
import forgeGlobal from '@/model/globals/forgeGlobal';

vi.mock('@/utils/window', () => ({
  getLocalStorageKey: (key: string) => `${key}-example-tenant`,
  getLocalState: vi.fn(),
}));

const localState = vi.mocked(getLocalState);
const ACCOUNT = 'acc-1';

/** The record exactly as useCSATState.markSuppressed writes it. */
function suppressedUntil(date: Date, accountId = ACCOUNT) {
  return { users: { [accountId]: { lastUpdated: new Date(), expires: date } }, lastUpdated: new Date() };
}

describe('isCsatSuppressedForAccount — the single suppression verdict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localState.mockReturnValue({ users: {}, lastUpdated: new Date() });
  });

  it('reads the tenant-scoped csat_state record', () => {
    isCsatSuppressedForAccount(ACCOUNT);
    expect(localState).toHaveBeenCalledWith(CSAT_STATE_KEY, expect.objectContaining({ users: {} }));
  });

  it('is false for an account with no record — nothing was ever dismissed', () => {
    expect(isCsatSuppressedForAccount(ACCOUNT)).toBe(false);
  });

  it('is true while the 7-day dismissal is still in force', () => {
    const now = Date.parse('2026-09-05T00:00:00Z');
    localState.mockReturnValue(suppressedUntil(new Date(now + 3 * 86400_000)));
    expect(isCsatSuppressedForAccount(ACCOUNT, now)).toBe(true);
  });

  it('is false once the dismissal has expired', () => {
    const now = Date.parse('2026-09-05T00:00:00Z');
    localState.mockReturnValue(suppressedUntil(new Date(now - 1000)));
    expect(isCsatSuppressedForAccount(ACCOUNT, now)).toBe(false);
  });

  it('honours a legacy record with no expiry as suppressed forever', () => {
    localState.mockReturnValue({ users: { [ACCOUNT]: { lastUpdated: new Date() } }, lastUpdated: new Date() });
    expect(isCsatSuppressedForAccount(ACCOUNT)).toBe(true);
  });

  it('is per account — one user dismissing does not suppress another', () => {
    const now = Date.parse('2026-09-05T00:00:00Z');
    localState.mockReturnValue(suppressedUntil(new Date(now + 86400_000), 'someone-else'));
    expect(isCsatSuppressedForAccount(ACCOUNT, now)).toBe(false);
  });

  it('reads as not suppressed when the account id is unresolved', () => {
    // Must match what useCSATState would conclude from the same record, so the
    // cascade and the banner cannot disagree.
    expect(isCsatSuppressedForAccount(undefined)).toBe(false);
  });

  it('degrades to not-suppressed if the record is unreadable', () => {
    localState.mockImplementation(() => {
      throw new Error('storage blocked');
    });
    expect(isCsatSuppressedForAccount(ACCOUNT)).toBe(false);
  });

  it('survives a malformed record', () => {
    localState.mockReturnValue({} as never);
    expect(isCsatSuppressedForAccount(ACCOUNT)).toBe(false);
  });
});

describe('isCsatSuppressed — same verdict, account taken from the Forge context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    forgeGlobal.forgeContext = { accountId: ACCOUNT };
  });

  it('uses the context account id', () => {
    const now = Date.parse('2026-09-05T00:00:00Z');
    localState.mockReturnValue(suppressedUntil(new Date(now + 86400_000)));
    expect(isCsatSuppressed(now)).toBe(true);

    forgeGlobal.forgeContext = { accountId: 'someone-else' };
    expect(isCsatSuppressed(now)).toBe(false);
  });

  it('is false when no context has been resolved', () => {
    forgeGlobal.forgeContext = undefined;
    localState.mockReturnValue({ users: {}, lastUpdated: new Date() });
    expect(isCsatSuppressed()).toBe(false);
  });
});
