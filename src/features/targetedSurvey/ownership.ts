export type SurveyTerminal = 'dismissed' | 'submitted';

export function surveyTerminalKey(cloudId: string, accountId: string, uuid: string): string {
  return `targetedSurvey:${encodeURIComponent(cloudId)}:${encodeURIComponent(accountId)}:${uuid}`;
}

export function isSurveyTerminal(key: string): boolean {
  // Storage failure is a hard suppression: we cannot remember dismissal.
  try {
    const value = localStorage.getItem(key);
    const probe = `${key}:storage-probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return value === 'dismissed' || value === 'submitted';
  } catch {
    return true;
  }
}

export function markSurveyTerminal(key: string, terminal: SurveyTerminal): boolean {
  try {
    localStorage.setItem(key, terminal);
  } catch {
    return false;
  }
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(key);
      channel.postMessage(terminal);
      channel.close();
    }
  } catch {
    // Storage events still notify the other same-origin documents.
  }
  return true;
}

/** Hold a Web Lock for the full time the banner is visible. */
export function claimSurveyBanner(
  key: string,
  onOwned: () => void,
  onLost: () => void,
  locks: LockManager | undefined = navigator.locks,
): () => void {
  if (!locks?.request || isSurveyTerminal(key)) {
    onLost();
    return () => {};
  }
  let releaseHold: (() => void) | undefined;
  let released = false;
  let notifiedLost = false;
  const lost = () => {
    if (notifiedLost || released) return;
    notifiedLost = true;
    released = true;
    releaseHold?.();
    onLost();
  };
  const release = () => {
    released = true;
    releaseHold?.();
  };
  void locks.request(key, { ifAvailable: true }, async (lock) => {
    if (!lock || released || isSurveyTerminal(key)) {
      lost();
      return;
    }
    let channel: BroadcastChannel | undefined;
    const onStorage = (event: StorageEvent) => {
      if (event.key === key && isSurveyTerminal(key)) lost();
    };
    window.addEventListener('storage', onStorage);
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        try {
          channel = new BroadcastChannel(key);
          channel.onmessage = () => { if (isSurveyTerminal(key)) lost(); };
        } catch {
          // Storage events still provide terminal-state synchronization.
        }
      }
      onOwned();
      await new Promise<void>((resolve) => { releaseHold = resolve; if (released) resolve(); });
    } finally {
      window.removeEventListener('storage', onStorage);
      channel?.close();
    }
  }).catch(lost);
  return release;
}
