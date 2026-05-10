// Draft persistence for the editor — survives accidental close (Atlassian
// header X), tab close, refresh, crashes. The Forge bridge gives us no way to
// intercept the modal X click (research: there is no preventClose API as of
// @forge/bridge 5.16, and the browser will not surface beforeunload's confirm
// dialog when the parent JS-destroys the iframe — see closeGuard.ts).
//
// So instead of warning, we PREVENT data loss: save draft on every keystroke,
// flush again on view.onClose, and offer "Restore" on next open if a newer
// draft exists than the persisted diagram.
//
// Storage: localStorage on the iframe origin, namespaced by cloudId so drafts
// from one Confluence site don't leak into another (the iframe origin is
// shared at *.cdn.prod.atlassian-dev.net/<app-id>/ across tenants).

import { view } from '@forge/bridge';

export interface Draft {
  code: string;
  title: string;
  savedAt: number;
}

let _cloudId: string | null = null;

async function getCloudId(): Promise<string> {
  if (_cloudId) return _cloudId;
  try {
    const ctx = await view.getContext();
    _cloudId = (ctx as any)?.cloudId || 'unknown-cloud';
  } catch {
    _cloudId = 'unknown-cloud';
  }
  return _cloudId!;
}

function keyFor(scope: string, cloudId: string): string {
  return `zenuml.draft.${cloudId}.${scope}`;
}

export async function saveDraft(scope: string, draft: Omit<Draft, 'savedAt'>): Promise<void> {
  const cloudId = await getCloudId();
  const payload: Draft = { ...draft, savedAt: Date.now() };
  try {
    localStorage.setItem(keyFor(scope, cloudId), JSON.stringify(payload));
  } catch {
    // localStorage full / disabled — silently skip
  }
}

export async function loadDraft(scope: string): Promise<Draft | null> {
  const cloudId = await getCloudId();
  try {
    const raw = localStorage.getItem(keyFor(scope, cloudId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft;
    if (typeof parsed?.savedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearDraft(scope: string): Promise<void> {
  const cloudId = await getCloudId();
  try {
    localStorage.removeItem(keyFor(scope, cloudId));
  } catch {
    // noop
  }
}

// Synchronous variant used inside view.onClose where awaits are risky
// (the iframe may be destroyed before async work finishes — see ashraf.teleb85
// timing report on the Forge EAP thread). The onClose handler MUST have
// pre-resolved cloudId so this can run synchronously.
export function saveDraftSync(scope: string, cloudId: string, draft: Omit<Draft, 'savedAt'>): void {
  const payload: Draft = { ...draft, savedAt: Date.now() };
  try {
    localStorage.setItem(keyFor(scope, cloudId), JSON.stringify(payload));
  } catch {
    // noop
  }
}

// Pre-warm the cloudId cache so saveDraftSync has it available.
export async function primeCloudId(): Promise<string> {
  return getCloudId();
}

// Cached for callers that need the synchronous path.
export function getCachedCloudId(): string | null {
  return _cloudId;
}

// Simple per-key debounce for live save-on-keystroke. Returns a saver fn.
// Cancel pending writes via the returned `flush()` (writes immediately) or
// `cancel()` (drops pending).
export function makeDebouncedDraftSaver(scope: string, delayMs = 500) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Omit<Draft, 'savedAt'> | null = null;

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (pending) {
      saveDraft(scope, pending);
      pending = null;
    }
  };
  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    pending = null;
  };
  const save = (draft: Omit<Draft, 'savedAt'>) => {
    pending = draft;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (pending) {
        saveDraft(scope, pending);
        pending = null;
      }
    }, delayMs);
  };

  return { save, flush, cancel };
}
