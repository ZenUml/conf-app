/**
 * Interaction layer for "edit Mermaid sequence diagrams on the canvas".
 *
 * Owns: tagging the rendered DOM, the hover affordance, the text box, the
 * commit/cancel rules, the toasts and the analytics. Knows nothing about the
 * parser or the edit functions: they arrive as `deps` (wired in ../index.ts),
 * so this file runs in tests with fakes.
 *
 * One rule decides whether anything is editable, checked when the map arrives,
 * on double-click and on commit: the code the visible SVG was rendered from,
 * `map.code` and the current store code are the same string.
 */
import './inlineEdit.css';
import { EDITABLE_KINDS, type EditRejection, type EditResult, type EditableKind, type GetSourceMap, type SequenceSourceMap } from '../types';
import type { AnalyticsEventName, InlineEditKind } from '@/utils/analytics/catalog';
import type { AnalyticsProperties } from '@/utils/analytics/types';
import { normalizeMermaidWhitespace } from '@/utils/mermaid/normalizeWhitespace';
import { INPUT_LABELS, REJECTION_MESSAGES } from './copy';
import { elementsOf, isSequenceSvg, resolveTarget, tagRenderedSequence, type InlineEditTarget } from './domMapping';

export type InlineEditEventName = Extract<AnalyticsEventName, `editor_inline_edit_${string}`>;

export interface InlineEditDeps {
  getSourceMap: GetSourceMap;
  renameParticipant: (code: string, map: SequenceSourceMap, actorId: string, newName: string) => EditResult;
  editMessageText: (code: string, map: SequenceSourceMap, messageIndex: number, newText: string) => EditResult;
  sourceTextOf: (map: SequenceSourceMap, kind: EditableKind, key: string | number) => string | null;
  /** The store's current Mermaid source (`store.state.diagram.mermaidCode`). */
  getCode: () => string;
  /** The one correct write: clears the error and dispatches the store update. */
  writeCode: (code: string) => void;
  /** Feature flag; a rejection counts as off. */
  isEnabled: () => Promise<boolean>;
  track: (name: InlineEditEventName, properties: AnalyticsProperties) => void;
  toast: (message: string) => void;
  now?: () => number;
}

export interface InlineEditController {
  /** Call after every successful render, with the exact store string rendered. */
  onRendered(code: string): void;
  /** Call whenever the store code changes (before or without a render). */
  onCodeChanged(code: string | null | undefined | false): void;
  /** Export capture and similar: no affordance, no open box. */
  setSuspended(suspended: boolean): void;
  destroy(): void;
}

const FLASH_MS = 1000;
const FLASH_CLASS = 'mie-flash';
const ENABLED_CLASS = 'mie-enabled';
const HOVER_CLASS = 'mie-hover';
const KEY_EVENTS = ['keydown', 'keypress', 'keyup', 'copy', 'cut', 'paste'] as const;
const POINTER_EVENTS = ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick', 'wheel', 'contextmenu'] as const;

const KIND_PROPERTY: Record<EditableKind, InlineEditKind> = {
  participantLabel: 'participant_label',
  messageText: 'message_text',
};

// One editor session is one iframe page load (the editor modal is its own iframe).
let unavailableSentThisSession = false;
export function __resetInlineEditSessionForTests(): void {
  unavailableSentThisSession = false;
}

interface OpenEdit {
  state: 'open' | 'closing';
  target: InlineEditTarget;
  anchor: Element;
  code: string;
  map: SequenceSourceMap;
  prefill: string;
  hadAlias?: boolean;
  openedAt: number;
  input: HTMLInputElement;
  cleanup: () => void;
}

export function attachInlineEdit(container: HTMLElement, deps: InlineEditDeps): InlineEditController {
  const doc = container.ownerDocument;
  const win = doc.defaultView ?? window;
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));

  let enabled: boolean | null = null;
  let destroyed = false;
  let suspended = false;
  let generation = 0;
  let renderedCode: string | null = null;
  let map: SequenceSourceMap | null = null;
  let flash: { target: InlineEditTarget; alternates: string[]; code: string } | null = null;
  let edit: OpenEdit | null = null;
  const flashTimers = new Set<ReturnType<typeof setTimeout>>();

  const raf = (cb: () => void): number =>
    typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame(cb) : (win.setTimeout(cb, 16) as unknown as number);
  const caf = (id: number) =>
    typeof win.cancelAnimationFrame === 'function' ? win.cancelAnimationFrame(id) : win.clearTimeout(id);
  const base = (): AnalyticsProperties => ({ feature_area: 'macro', surface: 'editor', macro_type: 'mermaid' });
  const svg = () => container.querySelector('svg[aria-roledescription]');
  const sameSource = (code: string | null) =>
    !!map && code !== null && map.code === code && renderedCode === code && deps.getCode() === code;

  function setAffordance(): void {
    container.classList.toggle(ENABLED_CLASS, !destroyed && !suspended && enabled === true && sameSource(renderedCode));
  }

  function track(name: InlineEditEventName, props: AnalyticsProperties = base()): void {
    try { deps.track(name, props); } catch { /* analytics never breaks editing */ }
  }

  function kindProps(target: InlineEditTarget, hadAlias?: boolean): AnalyticsProperties {
    return {
      ...base(),
      inline_edit_kind: KIND_PROPERTY[target.kind],
      ...(target.kind === 'participantLabel' && hadAlias !== undefined ? { inline_edit_had_alias: hadAlias } : {}),
    };
  }

  function reject(target: InlineEditTarget, reason: EditRejection, hadAlias?: boolean, openedAt?: number): void {
    deps.toast(REJECTION_MESSAGES[reason]);
    track('editor_inline_edit_rejected', {
      ...kindProps(target, hadAlias),
      inline_edit_rejection: reason,
      ...(openedAt !== undefined ? { inline_edit_ms_open: Math.round(now() - openedAt) } : {}),
    });
  }

  /** Remove the box without any write, toast or event. */
  function closeQuietly(): void {
    if (!edit) return;
    const current = edit;
    current.state = 'closing';
    edit = null;
    current.cleanup();
  }

  function prepare(code: string, gen: number): void {
    const root = svg();
    if (!isSequenceSvg(root)) return;
    // Mermaid.vue renders normalizeMermaidWhitespace(code). It only swaps
    // U+00A0 for a space (same length), but an actor id holding U+00A0 would
    // render a different data-id than the map key. Read-only, no event.
    if (normalizeMermaidWhitespace(code) !== code) return;
    tagRenderedSequence(root);
    if (flash) {
      if (flash.code === code) applyFlash(root, flash);
      flash = null;
    }
    let pending: Promise<SequenceSourceMap | null>;
    try {
      pending = Promise.resolve(deps.getSourceMap(code));
    } catch (error) {
      pending = Promise.reject(error);
    }
    pending.then(
      (result) => {
        if (destroyed || gen !== generation || renderedCode !== code) return;
        if (!result) {
          if (!unavailableSentThisSession) {
            unavailableSentThisSession = true;
            track('editor_inline_edit_unavailable');
          }
          return;
        }
        // A map for other code (or code that moved on) is never used.
        if (result.code !== code || deps.getCode() !== code) return;
        map = result;
        setAffordance();
      },
      () => {
        if (destroyed || gen !== generation || unavailableSentThisSession) return;
        unavailableSentThisSession = true;
        track('editor_inline_edit_unavailable');
      },
    );
  }

  function applyFlash(root: Element, pending: NonNullable<typeof flash>): void {
    let elements: Element[] = [];
    if (pending.target.kind === 'messageText') {
      elements = elementsOf(root, pending.target);
    } else {
      for (const id of pending.alternates) {
        elements = elementsOf(root, { kind: 'participantLabel', key: id });
        if (elements.length) break;
      }
    }
    for (const el of elements) {
      el.classList.add(FLASH_CLASS);
      const timer = setTimeout(() => {
        flashTimers.delete(timer);
        el.classList.remove(FLASH_CLASS);
      }, FLASH_MS);
      flashTimers.add(timer);
    }
  }

  function onRendered(code: string): void {
    if (destroyed) return;
    generation += 1;
    renderedCode = code;
    map = null;
    // A new render replaced the element under the box. When the code changed,
    // onCodeChanged already closed it with the stale toast; same code (a
    // re-render) closes it without a write.
    closeQuietly();
    setAffordance();
    if (enabled === true) prepare(code, generation);
    else flash = null;
  }

  function onCodeChanged(code: string | null | undefined | false): void {
    if (destroyed) return;
    const next = typeof code === 'string' ? code : null;
    if (edit && edit.state === 'open' && next !== edit.code) {
      const current = edit;
      closeQuietly();
      reject(current.target, 'stale_source', current.hadAlias, current.openedAt);
    }
    setAffordance();
  }

  function place(current: OpenEdit): void {
    const root = svg();
    const targets = current.target.kind === 'messageText' && root ? elementsOf(root, current.target) : [current.anchor];
    const live = targets.filter((el) => el.isConnected);
    if (!live.length) {
      closeQuietly();
      return;
    }
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const el of live) {
      const r = el.getBoundingClientRect();
      left = Math.min(left, r.left); top = Math.min(top, r.top);
      right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
    }
    // Wide enough for the element and for the source text (which can be
    // longer than the rendered lines, e.g. `Hello<br/>two lines`). 14px text
    // averages under 8px a character.
    const textWidth = current.input.value.length * 8;
    const width = Math.round(Math.min(420, Math.max(96, right - left + 24, textWidth + 24)));
    const height = 28;
    current.input.style.width = `${width}px`;
    current.input.style.left = `${Math.round((left + right) / 2 - width / 2)}px`;
    current.input.style.top = `${Math.round((top + bottom) / 2 - height / 2)}px`;
  }

  function finish(kind: 'enter' | 'blur' | 'escape'): void {
    const current = edit;
    if (!current || current.state !== 'open') return;
    const value = current.input.value;
    closeQuietly();
    const msOpen = Math.round(now() - current.openedAt);
    if (kind === 'escape' || value === current.prefill) {
      track('editor_inline_edit_cancelled', {
        ...kindProps(current.target, current.hadAlias),
        inline_edit_cancel_reason: kind === 'escape' ? 'escape' : 'unchanged',
        inline_edit_ms_open: msOpen,
      });
      return;
    }
    const code = deps.getCode();
    if (code !== current.code || !sameSource(code) || map !== current.map) {
      reject(current.target, 'stale_source', current.hadAlias, current.openedAt);
      return;
    }
    let result: EditResult;
    try {
      result = current.target.kind === 'participantLabel'
        ? deps.renameParticipant(code, current.map, current.target.key, value)
        : deps.editMessageText(code, current.map, current.target.key, value);
    } catch {
      result = { ok: false, reason: 'position_mismatch' };
    }
    if (!result.ok) {
      reject(current.target, result.reason, current.hadAlias, current.openedAt);
      return;
    }
    if (result.code === code) {
      // The edit functions trim, so `Alice ` over `Alice` changes nothing:
      // no write, no re-render to wait for, and not a success.
      track('editor_inline_edit_cancelled', {
        ...kindProps(current.target, current.hadAlias),
        inline_edit_cancel_reason: 'unchanged',
        inline_edit_ms_open: msOpen,
      });
      return;
    }
    flash = {
      target: current.target,
      // A participant without alias is renamed by its id, so it comes back
      // under the new id; with an alias the id stays.
      alternates: current.target.kind === 'participantLabel' && !current.hadAlias
        ? Array.from(new Set([value, value.trim()]))
        : [String(current.target.key)],
      code: result.code,
    };
    deps.writeCode(result.code);
    track('editor_inline_edit_succeeded', { ...kindProps(current.target, current.hadAlias), inline_edit_ms_open: msOpen });
  }

  function open(target: InlineEditTarget, anchor: Element, code: string, sourceMap: SequenceSourceMap): void {
    const hadAlias = target.kind === 'participantLabel' ? sourceMap.participants.get(target.key)?.hasAlias : undefined;
    let prefill: string | null;
    try {
      prefill = deps.sourceTextOf(sourceMap, target.kind, target.key);
    } catch {
      prefill = null;
    }
    if (prefill === null) {
      reject(target, 'position_mismatch', hadAlias);
      return;
    }

    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'mie-input';
    input.value = prefill;
    input.setAttribute('aria-label', INPUT_LABELS[target.kind]);
    input.setAttribute('data-testid', 'mermaid-inline-edit-input');
    input.setAttribute('autocomplete', 'off');
    input.spellcheck = false;

    // Window capture runs before every document-level listener (GenericViewer's
    // capture Escape handler, IgnoreEsc, menus), CodeMirror and the viewport.
    // stopPropagation does not cancel typing, copy or paste themselves.
    const onKey = (event: Event) => {
      if (event.target !== input) return;
      event.stopPropagation();
      if (event.type !== 'keydown') return;
      const key = (event as KeyboardEvent).key;
      if ((event as KeyboardEvent).isComposing) return;
      if (key === 'Enter') {
        event.preventDefault();
        finish('enter');
      } else if (key === 'Escape') {
        event.preventDefault();
        finish('escape');
      }
    };
    const stop = (event: Event) => event.stopPropagation();
    const onBlur = () => finish('blur');
    const onInput = () => { if (edit && edit.input === input) place(edit); };
    let frame = 0;
    const reposition = () => {
      if (frame) return;
      frame = raf(() => {
        frame = 0;
        if (edit && edit.input === input) place(edit);
      });
    };
    const root = svg();
    const observer = typeof MutationObserver !== 'undefined' && root
      ? new MutationObserver(reposition)
      : null;
    observer?.observe(root as Element, { attributes: true, subtree: true, attributeFilter: ['transform', 'style'] });
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(reposition) : null;
    resizeObserver?.observe(container);

    for (const name of KEY_EVENTS) win.addEventListener(name, onKey, true);
    for (const name of POINTER_EVENTS) input.addEventListener(name, stop);
    input.addEventListener('blur', onBlur);
    input.addEventListener('input', onInput);
    win.addEventListener('resize', reposition);
    container.addEventListener('wheel', reposition, { passive: true });

    const current: OpenEdit = {
      state: 'open', target, anchor, code, map: sourceMap, prefill, hadAlias,
      openedAt: now(), input,
      cleanup: () => {
        for (const name of KEY_EVENTS) win.removeEventListener(name, onKey, true);
        input.removeEventListener('blur', onBlur);
        input.removeEventListener('input', onInput);
        win.removeEventListener('resize', reposition);
        container.removeEventListener('wheel', reposition);
        observer?.disconnect();
        resizeObserver?.disconnect();
        if (frame) caf(frame);
        input.remove();
      },
    };
    edit = current;
    doc.body.appendChild(input);
    place(current);
    if (edit !== current) return;
    track('editor_inline_edit_started', kindProps(target, hadAlias));
    input.focus();
    input.select();
  }

  const onDoubleClick = (event: MouseEvent) => {
    if (destroyed || suspended || enabled !== true || edit) return;
    const code = renderedCode;
    if (!map || !sameSource(code)) return;
    const root = svg();
    if (!root) return;
    const target = resolveTarget(event.target, root);
    if (!target || !EDITABLE_KINDS.sequence.includes(target.kind)) return;
    event.preventDefault();
    open(target, target.anchor, code as string, map);
  };
  container.addEventListener('dblclick', onDoubleClick);

  // Hover marks every element of the target (all lines of a message, both
  // copies of a participant), not just the one under the pointer.
  let hovered: Element[] = [];
  const clearHover = () => {
    for (const el of hovered) el.classList.remove(HOVER_CLASS);
    hovered = [];
  };
  const onPointerOver = (event: Event) => {
    clearHover();
    if (!container.classList.contains(ENABLED_CLASS)) return;
    const root = svg();
    const target = root ? resolveTarget(event.target, root) : null;
    if (!root || !target) return;
    hovered = elementsOf(root, target);
    for (const el of hovered) el.classList.add(HOVER_CLASS);
  };
  container.addEventListener('pointerover', onPointerOver);
  container.addEventListener('pointerleave', clearHover);

  deps.isEnabled().then(
    (value) => value === true,
    () => false,
  ).then((value) => {
    if (destroyed) return;
    enabled = value;
    if (value && renderedCode !== null) prepare(renderedCode, generation);
    setAffordance();
  });

  return {
    onRendered,
    onCodeChanged,
    setSuspended(value: boolean) {
      suspended = value;
      if (value) closeQuietly();
      setAffordance();
    },
    destroy() {
      if (destroyed) return;
      closeQuietly();
      destroyed = true;
      container.removeEventListener('dblclick', onDoubleClick);
      container.removeEventListener('pointerover', onPointerOver);
      container.removeEventListener('pointerleave', clearHover);
      clearHover();
      container.classList.remove(ENABLED_CLASS);
      for (const timer of flashTimers) clearTimeout(timer);
      flashTimers.clear();
    },
  };
}
