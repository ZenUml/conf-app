import { ref } from "vue";
import ApWrapper2 from "@/model/ApWrapper2";
import { getLocalState, setLocalState } from "@/utils/window";
import clone from "lodash/clone";
import { IUser } from "@/model/IUser";
import { CSAT_STATE_KEY, isCsatSuppressedForAccount } from "@/utils/csat";
export default function useCSATState() {
  const STORAGE_KEY = CSAT_STATE_KEY;
  const DEFAULT_STATE = { users: {}, lastUpdated: new Date() };
  const account = ref<IUser | null>(null);

  const ensureAccount = async (): Promise<IUser> => {
    if (!account.value) {
      account.value = await new ApWrapper2()._getCurrentUser();
    }
    return account.value;
  };

  /**
   * Delegates the actual verdict to utils/csat so the banner and the page-banner
   * priority cascade cannot disagree about who is suppressed — see
   * isCsatSuppressedForAccount. All this adds is resolving the account, which
   * also caches it for markSuppressed()/clearSuppressed() below.
   */
  const checkStateOfCSAT = async () => {
    const user = await ensureAccount();
    return isCsatSuppressedForAccount(user.atlassianAccountId);
  };

  /**
   * Persist 1-week suppression synchronously using the already-resolved
   * account. Synchronous on purpose: callers (the pageBanner) need the write
   * to land BEFORE view.close() tears down the iframe, so it can't await a
   * user lookup first. Returns false if no account is cached yet — run
   * checkStateOfCSAT() first. Caller wraps the call for storage errors.
   */
  const markSuppressed = (): boolean => {
    if (!account.value) return false;
    const localState = getLocalState(STORAGE_KEY, DEFAULT_STATE);

    const lastUpdated = new Date();
    const expiresDate = clone(lastUpdated);
    expiresDate.setDate(expiresDate.getDate() + 7);

    localState.users[account.value.atlassianAccountId] = {
      lastUpdated: lastUpdated,
      expires: expiresDate,
    };

    setLocalState(STORAGE_KEY, localState);
    return true;
  };

  /**
   * Remove this user's suppression synchronously (the inverse of
   * markSuppressed). Used by Undo so dismissing-then-undoing fully restores
   * the un-suppressed state. Returns false if no account is cached yet.
   */
  const clearSuppressed = (): boolean => {
    if (!account.value) return false;
    const localState = getLocalState(STORAGE_KEY, DEFAULT_STATE);
    if (localState.users[account.value.atlassianAccountId]) {
      delete localState.users[account.value.atlassianAccountId];
      setLocalState(STORAGE_KEY, localState);
    }
    return true;
  };

  /** Async suppression for callers without a pre-resolved account. */
  const updateStateOfCSAT = async () => {
    await ensureAccount();
    markSuppressed();
  };

  return {
    checkStateOfCSAT,
    updateStateOfCSAT,
    markSuppressed,
    clearSuppressed,
  };
}
