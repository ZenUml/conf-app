// Self-mounting "Restore unsaved changes" banner.
//
// The four editors (sequence/openapi/graph/embed) each mount their own root —
// there's no shared parent component that renders for every editor. Rather
// than asking each editor to render a banner component, this module injects a
// singleton banner into document.body when EventBus fires 'draft-available',
// and removes it when the user clicks Restore/Discard/Dismiss.
//
// The banner emits 'draft-restore' or 'draft-discard' on the same EventBus —
// each editor's mount logic listens for the matching scope and either
// dispatches the right state update (Restore) or clears localStorage
// (Discard).

import EventBus from '@/EventBus';
import { clearDraft } from '@/utils/draftStore';

interface DraftPayload {
  scope: string;
  draft: { code: string; title: string; savedAt: number };
}

let installed = false;
let currentRoot: HTMLElement | null = null;

function relativeTime(savedAt: number): string {
  const diff = Date.now() - savedAt;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}

function dismiss() {
  if (currentRoot && currentRoot.parentNode) {
    currentRoot.parentNode.removeChild(currentRoot);
  }
  currentRoot = null;
}

function show(payload: DraftPayload) {
  // Replace any existing banner — only one should be visible at a time.
  dismiss();

  const root = document.createElement('div');
  root.setAttribute('role', 'status');
  root.setAttribute('data-zenuml-draft-banner', '');
  root.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483647',
    'display:flex', 'align-items:center', 'gap:12px',
    'padding:8px 16px',
    'background:#fff8c5', 'border-bottom:1px solid #d4a72c',
    'color:#57460a', 'font-size:13px',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    'box-shadow:0 2px 4px rgba(0,0,0,.08)',
  ].join(';');

  const text = document.createElement('span');
  text.style.flex = '1';
  text.style.minWidth = '0';
  text.textContent = `Unsaved changes from ${relativeTime(payload.draft.savedAt)} — these were preserved when the modal closed.`;
  root.appendChild(text);

  const btnBase = 'background:#fff;border:1px solid #d4a72c;color:#57460a;padding:4px 12px;border-radius:4px;cursor:pointer;font:inherit;font-size:12px;font-weight:500';

  const restoreBtn = document.createElement('button');
  restoreBtn.type = 'button';
  restoreBtn.textContent = 'Restore';
  restoreBtn.style.cssText = btnBase + ';background:#57460a;color:#fff8c5;border-color:#57460a';
  restoreBtn.addEventListener('click', () => {
    EventBus.$emit('draft-restore', payload);
    dismiss();
  });
  root.appendChild(restoreBtn);

  const discardBtn = document.createElement('button');
  discardBtn.type = 'button';
  discardBtn.textContent = 'Discard';
  discardBtn.style.cssText = btnBase;
  discardBtn.addEventListener('click', async () => {
    try { await clearDraft(payload.scope); } catch { /* noop */ }
    EventBus.$emit('draft-discard', payload);
    dismiss();
  });
  root.appendChild(discardBtn);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Dismiss');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:#57460a;cursor:pointer;font-size:14px;padding:4px 8px;line-height:1';
  closeBtn.addEventListener('click', dismiss);
  root.appendChild(closeBtn);

  document.body.appendChild(root);
  currentRoot = root;
}

// Idempotent — call from each editor entry. The first call installs the
// EventBus listener; subsequent calls are no-ops.
export function installRestoreDraftBanner(): void {
  if (installed) return;
  installed = true;
  EventBus.$on('draft-available', (payload: DraftPayload) => {
    if (!payload?.draft || !payload?.scope) return;
    show(payload);
  });
}
