import { ref } from "vue";
import ApWrapper2 from "@/model/ApWrapper2";
import { getLocalState, setLocalState } from "@/utils/window";
import clone from "lodash/clone";
import { IUser } from "@/model/IUser";
export default function useCSATState() {
  const STORAGE_KEY = "csat_state";
  const DEFAULT_STATE = { users: {}, lastUpdated: new Date() };
  const account = ref<IUser | null>(null);

  const ensureAccount = async (): Promise<IUser> => {
    if (!account.value) {
      account.value = await new ApWrapper2()._getCurrentUser();
    }
    return account.value;
  };

  const checkStateOfCSAT = async () => {
    const user = await ensureAccount();
    const localState = getLocalState(STORAGE_KEY, DEFAULT_STATE);
    const userState = localState.users[user.atlassianAccountId];
    return (
      userState &&
      (!userState.expires || new Date() < new Date(userState.expires))
    );
  };

  /**
   * Persist 3-month suppression synchronously using the already-resolved
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
    expiresDate.setMonth(expiresDate.getMonth() + 3);

    localState.users[account.value.atlassianAccountId] = {
      lastUpdated: lastUpdated,
      expires: expiresDate,
    };

    setLocalState(STORAGE_KEY, localState);
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
  };
}
