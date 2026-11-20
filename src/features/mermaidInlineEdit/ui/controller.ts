/**
 * Interaction layer for "edit Mermaid sequence diagrams on the canvas": the
 * in-place (Figma-style) text editor.
 *
 * A transparent contenteditable layer lives in the DiagramViewport element,
 * outside the v-html SVG, so a re-render never destroys it. It copies the font
 * and position of the SVG text it covers; that text is hidden underneath.
 * While a session is open every input renders a candidate built from a fixed
 * base (baseCode + baseMap) through Mermaid.vue's renderPreview, with no store
 * write. After each swap, in the same task, the viewport is put back (zoom,
 * and the edited text's first-line centre at the same screen point) and the
 * layer is re-placed over the new text. The store is written once, on commit.
 * Esc leaves no trace.
 *
 * Text model: codec/ (decode for the prefill, encode per keystroke,
 * renderParity as the gate, isUnchanged as "no edit").
 *
 * One rule decides whether anything is editable, checked when the map
 * arrives, on double-click and on commit: the code the visible SVG was
 * rendered from, `map.code` and the current store code are the same string.
 *
 * Knows nothing about the parser or the edit functions: they arrive as `deps`
 * (wired in ../index.ts), so this file runs in tests with fakes.
 */
import './inlineEdit.css';
import { EDITABLE_KINDS, type EditRejection, type EditResult, type EditableKind, type GetSourceMap, type SequenceSourceMap } from '../types';
import type { AnalyticsEventName, InlineEditKind } from '@/utils/analytics/catalog';
import type { AnalyticsProperties } from '@/utils/analytics/types';
import { normalizeMermaidWhitespace } from '@/utils/mermaid/normalizeWhitespace';
import { REJECTION_MESSAGES } from './copy';
import { FOOTER_TAG, elementsOf, isSequenceSvg, resolveTarget, tagRenderedSequence } from './domMapping';
import {
  decodeSourceText, encodeDisplayText, isUnchanged, readMessageLines, readParticipantLines, renderParity,
} from '../codec';
import { createRenderLoop, type RenderLoop } from './renderLoop';

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
  track: (name: InlineEditEventName, properties: AnalyticsProperties) => void;
  toast: (message: string) => void;
  now?: () => number;
  /**
   * How a preview render is started when the loop is idle. Default: a
   * MessageChannel task. A Mermaid render is effectively one long task, so
   * keystrokes typed during it queue as input tasks; starting the next render
   * in a task lets them all land first, and one render covers them. Tests pass
   * a synchronous runner.
   */
  schedule?: (run: () => void) => void;
}

export interface InlineEditController {
  /** Call after every successful render, with the exact store string rendered. */
  onRendered(code: string): void;
  /** Call whenever the store code changes (before or without a render). */
  onCodeChanged(code: string | null | undefined | false): void;
  /** Export capture and similar: no affordance, no open layer. */
  setSuspended(suspended: boolean): void;
  destroy(): void;
}

/** What DiagramViewport exposes for the editor (holdView & co). */
export interface InlineEditViewport {
  $el: HTMLElement;
  holdView(held: boolean): void;
  getRealZoom(): number | null;
  setRealZoom(realZoom: number): void;
  panByScreen(dx: number, dy: number): void;
  flushView(): void;
}

/** What Mermaid.vue gives the editor. */
export interface InlineEditHost {
  /** Render a candidate source without writing the store. Resolves true when its SVG is on screen. */
  renderPreview(code: string): Promise<boolean>;
  /** Called by Mermaid.vue right after every viewport attach, in the same task as the swap. */
  setViewKeeper(fn: ((code: string) => void) | null): void;
  viewport(): InlineEditViewport | null;
}

type Target =
  | { kind: 'messageText'; key: number }
  | { kind: 'participantLabel'; baseId: string; hasAlias: boolean; copy: 'header' | 'footer' };

interface Session {
  target: Target;
  /** Element key in the SVG on screen: message index, or the participant id the picture was drawn with. */
  currentId: string;
  baseCode: string;
  baseMap: SequenceSourceMap;
  source: string;
  lineBefore: string;
  initialText: string;
  layer: HTMLDivElement;
  hint: HTMLDivElement | null;
  invalid: EditRejection | null;
  host: HTMLElement;
  viewport: InlineEditViewport;
  anchor: { x: number; y: number };
  realZoom: number;
  loop: RenderLoop;
  composing: boolean;
  lastInputAt: number;
  rendering: boolean;
  shownCode: string;
  /** Participant id each candidate code draws the edited participant with. */
  idByCode: Map<string, string>;
  svgObserver: MutationObserver | null;
  openedAt: number;
  cleanup: () => void;
}

/** After close: keep the view until the render showing `code` lands. */
interface Closing {
  code: string;
  anchor: { x: number; y: number };
  realZoom: number;
  viewport: InlineEditViewport;
  locate: (root: Element, code: string) => SVGTextElement[];
  teardown: (() => void) | null;
}

export interface InlineEditStats {
  sessions: number;
  inputs: number;
  renders: number;
  /** input event -> new SVG in DOM, viewport restored, layer re-placed (ms). */
  latencies: number[];
  /** Screen position of the edited text's first-line centre after each re-place. */
  anchorTrace: Array<{ x: number; y: number; realZoom: number | null; id?: string }>;
  invalid: number;
}

const KEY_EVENTS = ['keydown', 'keypress', 'keyup', 'copy', 'cut', 'paste'] as const;
const STOP_POINTER = ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick', 'wheel', 'contextmenu'] as const;
const ENABLED_CLASS = 'mie-enabled';
const CURSOR_CLASS = 'mie-cursor';
const HIDDEN_CLASS = 'mie-hidden';
const INVALID_CLASS = 'mie-invalid';

const KIND_PROPERTY: Record<EditableKind, InlineEditKind> = {
  participantLabel: 'participant_label',
  messageText: 'message_text',
};

// One editor session is one iframe page load (the editor modal is its own iframe).
let unavailableSentThisSession = false;
export function __resetInlineEditSessionForTests(): void {
  unavailableSentThisSession = false;
}

/**
 * The colour the glyphs of an SVG text are painted with. Read it from the
 * deepest element that paints them: the first <tspan> when there is one, else
 * the <text>. Mermaid's `.actor` rule fills the participant <text> with the box
 * colour (#eee) while its <tspan> is painted dark, so the <text> fill is wrong.
 */
export function glyphColour(text: Element, win: Window = window): string {
  const painter = text.querySelector('tspan') ?? text;
  const cs = win.getComputedStyle(painter);
  return cs.fill && cs.fill !== 'none' ? cs.fill : cs.color;
}

/** The text elements of one copy of a participant label (header: data-id; footer: our tag). */
function participantTexts(root: Element, id: string, copy: 'header' | 'footer'): SVGTextElement[] {
  const group = copy === 'header'
    ? Array.from(root.querySelectorAll('[data-et="participant"]')).find((el) => el.getAttribute('data-id') === id)
    : Array.from(root.querySelectorAll(`[${FOOTER_TAG}]`)).find((el) => el.getAttribute(FOOTER_TAG) === id);
  return group ? (Array.from(group.querySelectorAll('text')) as SVGTextElement[]) : [];
}

export function attachInlineEdit(container: HTMLElement, deps: InlineEditDeps, host: InlineEditHost): InlineEditController {
  const doc = container.ownerDocument;
  const win = doc.defaultView ?? window;
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const channel = typeof MessageChannel !== 'undefined' && !deps.schedule ? new MessageChannel() : null;
  const queued: Array<() => void> = [];
  if (channel) channel.port1.onmessage = () => queued.shift()?.();
  const schedule = deps.schedule
    ?? (channel ? (run: () => void) => { queued.push(run); channel.port2.postMessage(0); } : (run: () => void) => { win.setTimeout(run, 0); });

  let destroyed = false;
  let suspended = false;
  let generation = 0;
  let renderedCode: string | null = null;
  let map: SequenceSourceMap | null = null;
  /** The code a source map is being computed for (cursor stays on meanwhile). */
  let mapPendingFor: string | null = null;
  let session: Session | null = null;
  let closing: Closing | null = null;
  let hoverBox: HTMLDivElement | null = null;

  const stats: InlineEditStats = { sessions: 0, inputs: 0, renders: 0, latencies: [], anchorTrace: [], invalid: 0 };
  if (import.meta.env.DEV) {
    // Measurement hook for the Storybook harness; stripped from production builds.
    (win as any).__mieInlineEdit = {
      stats,
      session: () => session,
      viewport: () => host.viewport(),
      resetStats() { Object.assign(stats, { inputs: 0, renders: 0, latencies: [], anchorTrace: [], invalid: 0 }); },
      idle: () => session?.loop.idle() ?? Promise.resolve(),
      rerender: () => (session ? host.renderPreview(session.shownCode) : Promise.resolve(false)),
    };
  }

  const base = (): AnalyticsProperties => ({ feature_area: 'macro', surface: 'editor', macro_type: 'mermaid' });
  const kindProps = (t: Target): AnalyticsProperties => t.kind === 'messageText'
    ? { ...base(), inline_edit_kind: KIND_PROPERTY.messageText }
    : { ...base(), inline_edit_kind: KIND_PROPERTY.participantLabel, inline_edit_had_alias: t.hasAlias };
  const msOpen = (s: Session) => Math.round(now() - s.openedAt);
  const track = (name: InlineEditEventName, props: AnalyticsProperties = base()) => {
    try { deps.track(name, props); } catch { /* analytics never breaks editing */ }
  };
  const svg = () => container.querySelector('.diagram-viewport-content svg[aria-roledescription]')
    ?? container.querySelector('svg[aria-roledescription]');
  const sameSource = (code: string | null) =>
    !!map && code !== null && map.code === code && renderedCode === code && deps.getCode() === code;

  function setAffordance(): void {
    const live = !destroyed && !suspended;
    const editable = live && sameSource(renderedCode);
    container.classList.toggle(ENABLED_CLASS, editable && !session);
    // The arrow cursor stays on through a session, its commit render and the
    // source map that follows, so it does not flash to `grab` in between.
    const pending = mapPendingFor !== null && mapPendingFor === renderedCode && deps.getCode() === renderedCode;
    container.classList.toggle(CURSOR_CLASS, live && (editable || !!session || !!closing || pending));
  }

  function prepare(code: string, gen: number): void {
    const root = svg();
    if (!isSequenceSvg(root)) return;
    // Mermaid.vue renders normalizeMermaidWhitespace(code). An actor id holding
    // U+00A0 would render a different data-id than the map key. Read-only, no event.
    if (normalizeMermaidWhitespace(code) !== code) return;
    tagRenderedSequence(root);
    mapPendingFor = code;
    let pending: Promise<SequenceSourceMap | null>;
    try {
      pending = Promise.resolve(deps.getSourceMap(code));
    } catch (error) {
      pending = Promise.reject(error);
    }
    const settle = () => {
      if (mapPendingFor === code) mapPendingFor = null;
    };
    pending.then(
      (result) => {
        if (destroyed || gen !== generation || renderedCode !== code) return;
        settle();
        if (!result) {
          if (!unavailableSentThisSession) {
            unavailableSentThisSession = true;
            track('editor_inline_edit_unavailable');
          }
          setAffordance();
          return;
        }
        // A map for other code (or code that moved on) is never used.
        if (result.code === code && deps.getCode() === code) map = result;
        setAffordance();
      },
      () => {
        if (destroyed || gen !== generation) return;
        settle();
        setAffordance();
        if (unavailableSentThisSession) return;
        unavailableSentThisSession = true;
        track('editor_inline_edit_unavailable');
      },
    );
  }

  // ---------- geometry ----------

  function textsOf(root: Element, target: Target, id: string): SVGTextElement[] {
    return target.kind === 'messageText'
      ? (elementsOf(root, { kind: 'messageText', key: target.key }) as SVGTextElement[])
      : participantTexts(root, id, target.copy);
  }

  function firstLineCentre(texts: Element[]): { x: number; y: number } {
    const r = texts[0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /** Copy font and position from the SVG text lines onto the layer. Styles only, never text. */
  function placeLayer(s: Session, texts: SVGTextElement[]): void {
    const { layer, host: hostEl } = s;
    const first = texts[0];
    const ctm = typeof first.getScreenCTM === 'function' ? first.getScreenCTM() : null;
    const scale = ctm ? Math.hypot(ctm.a, ctm.b) || 1 : 1;
    const cs = win.getComputedStyle(first);
    const ink = glyphColour(first, win);
    const fontSize = parseFloat(cs.fontSize) || 16;
    const rects = texts.map((t) => t.getBoundingClientRect());
    // Line pitch in SVG units: from the drawn lines when there are two, else
    // the single line's box height (Mermaid's own line height is that box, rounded).
    const pitch = rects.length > 1
      ? (rects[1].top + rects[1].height / 2 - (rects[0].top + rects[0].height / 2)) / scale
      : Math.round(rects[0].height / scale) || Math.round(fontSize * 1.2);
    const hostRect = hostEl.getBoundingClientRect();
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    const cx = (left + right) / 2 - hostRect.left;
    const cy0 = rects[0].top + rects[0].height / 2 - hostRect.top;
    const st = layer.style;
    st.fontFamily = cs.fontFamily;
    st.fontWeight = cs.fontWeight;
    st.fontStyle = cs.fontStyle;
    st.letterSpacing = cs.letterSpacing;
    st.color = ink;
    st.caretColor = ink;
    st.left = `${cx}px`;
    st.fontSize = `${fontSize * scale}px`;
    st.lineHeight = `${pitch * scale}px`;
    st.top = `${cy0 - (pitch * scale) / 2}px`;
    st.transform = 'translateX(-50%)';
    calibrate(layer, rects[0]);
    placeHint(s);
  }

  /**
   * Blink lays an HTML line out with integer ascent/descent, so the glyph box
   * sits up to ~1px off the centre of a fractional line box (measured: dy
   * -0.3..-0.9px at zoom 0.875..2). Measure the first line's Range against the
   * SVG text's box and shift by the difference.
   */
  function calibrate(layer: HTMLDivElement, svgRect: DOMRect): void {
    const node = layer.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const data = (node as Text).data;
    const end = data.indexOf('\n') === -1 ? data.length : data.indexOf('\n');
    if (end === 0) return;
    const range = doc.createRange();
    if (typeof range.getBoundingClientRect !== 'function') return;
    range.setStart(node, 0);
    range.setEnd(node, end);
    const r = range.getBoundingClientRect();
    if (!(r.height > 0)) return;
    const dy = svgRect.top + svgRect.height / 2 - (r.top + r.height / 2);
    if (Math.abs(dy) > 0.01 && Math.abs(dy) < 4) layer.style.top = `${parseFloat(layer.style.top) + dy}px`;
  }

  /** The hint sits directly under the layer, centred on it. */
  function placeHint(s: Session): void {
    if (!s.hint) return;
    const l = s.layer.getBoundingClientRect();
    const h = s.host.getBoundingClientRect();
    s.hint.style.left = `${l.left + l.width / 2 - h.left}px`;
    s.hint.style.top = `${l.bottom - h.top + 4}px`;
  }

  function setInvalid(s: Session, reason: EditRejection | null): void {
    s.invalid = reason;
    s.layer.classList.toggle(INVALID_CLASS, reason !== null);
    if (reason === null) {
      s.layer.removeAttribute('aria-invalid');
      s.hint?.remove();
      s.hint = null;
      return;
    }
    s.layer.setAttribute('aria-invalid', 'true');
    if (!s.hint) {
      s.hint = doc.createElement('div');
      s.hint.className = 'mie-hint';
      s.hint.setAttribute('role', 'status');
      s.hint.setAttribute('data-testid', 'mermaid-inline-edit-hint');
      s.host.appendChild(s.hint);
    }
    s.hint.textContent = REJECTION_MESSAGES[reason];
    placeHint(s);
  }

  function readText(layer: HTMLElement): string {
    let out = '';
    const nodes = Array.from(layer.childNodes);
    nodes.forEach((node, i) => {
      if (node.nodeType === Node.TEXT_NODE) out += (node as Text).data;
      else if (node.nodeName === 'BR') {
        // A trailing <br> after a newline, or alone in an emptied layer, is
        // Chromium's placeholder for an empty line, not a line break.
        if (!(i === nodes.length - 1 && (out === '' || out.endsWith('\n')))) out += '\n';
      } else out += (node as HTMLElement).innerText ?? node.textContent ?? '';
    });
    return out;
  }

  // ---------- hover ----------

  function hideHover(): void {
    hoverBox?.remove();
    hoverBox = null;
  }

  function showHover(texts: Element[]): void {
    const vp = host.viewport();
    if (!vp || !texts.length) return hideHover();
    const hostRect = vp.$el.getBoundingClientRect();
    const rects = texts.map((t) => t.getBoundingClientRect());
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    if (!hoverBox) {
      hoverBox = doc.createElement('div');
      hoverBox.className = 'mie-hover';
      hoverBox.setAttribute('data-testid', 'mermaid-inline-edit-hover');
      vp.$el.appendChild(hoverBox);
    }
    Object.assign(hoverBox.style, {
      left: `${left - hostRect.left}px`, top: `${top - hostRect.top}px`,
      width: `${right - left}px`, height: `${bottom - top}px`,
    });
  }

  const onPointerOver = (event: Event) => {
    if (session || !container.classList.contains(ENABLED_CLASS)) return hideHover();
    const root = svg();
    const target = root ? resolveTarget(event.target, root) : null;
    if (!root || !target) return hideHover();
    const anchor: Element = target.anchor;
    // A message: all its lines. A participant: the copy under the pointer.
    showHover(target.kind === 'messageText' ? elementsOf(root, target) : Array.from(anchor.querySelectorAll('text')));
  };

  // ---------- session ----------

  /** The keeper Mermaid.vue calls after every attach, in the same task as the SVG swap. */
  function keeper(code: string): void {
    // Any re-render moves the diagram under a hover box.
    hideHover();
    const root = svg();
    if (session) {
      afterSwap(session, root, code);
    } else if (closing) {
      const c = closing;
      c.viewport.setRealZoom(c.realZoom);
      c.viewport.flushView();
      if (root && isSequenceSvg(root)) {
        tagRenderedSequence(root);
        const texts = c.locate(root, code);
        if (texts.length) {
          // A late preview of an older candidate: keep the layer the only visible text.
          if (code !== c.code && c.teardown) for (const t of texts) t.classList.add(HIDDEN_CLASS);
          const p = firstLineCentre(texts);
          c.viewport.panByScreen(c.anchor.x - p.x, c.anchor.y - p.y);
          c.viewport.flushView();
        }
      }
      if (code === c.code && c.teardown) {
        c.teardown();
        c.teardown = null;
      }
    }
  }

  function afterSwap(s: Session, root: Element | null, code: string): void {
    s.viewport.setRealZoom(s.realZoom);
    s.viewport.flushView();
    if (!root || !isSequenceSvg(root)) return;
    tagRenderedSequence(root);
    const id = s.idByCode.get(code) ?? s.currentId;
    const texts = textsOf(root, s.target, id);
    if (!texts.length) return;
    s.currentId = id;
    for (const t of texts) t.classList.add(HIDDEN_CLASS);
    const p = firstLineCentre(texts);
    s.viewport.panByScreen(s.anchor.x - p.x, s.anchor.y - p.y);
    s.viewport.flushView();
    placeLayer(s, texts);
    s.shownCode = code;
    const after = firstLineCentre(texts);
    stats.anchorTrace.push({ x: after.x, y: after.y, realZoom: s.viewport.getRealZoom(), id });
    observeSvg(s, root);
  }

  /** User pan/zoom during a session (wheel, toolbar): follow it and adopt it as the new anchor. */
  function observeSvg(s: Session, root: Element): void {
    s.svgObserver?.disconnect();
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => {
      if (session !== s || s.rendering || !root.isConnected) return;
      const texts = textsOf(root, s.target, s.currentId);
      if (!texts.length) return;
      s.realZoom = s.viewport.getRealZoom() ?? s.realZoom;
      s.anchor = firstLineCentre(texts);
      placeLayer(s, texts);
    });
    observer.observe(root, { attributes: true, subtree: true, attributeFilter: ['transform', 'style'] });
    // Our own zoom/pan above must not count as a user move.
    observer.takeRecords();
    s.svgObserver = observer;
  }

  /** The candidate for the layer's current text, or the rejection. Always from the base. */
  function evaluate(s: Session): { ok: true; code: string; id: string } | { ok: false; reason: EditRejection } {
    const text = readText(s.layer);
    const t = s.target;
    const baseId = t.kind === 'messageText' ? String(t.key) : t.baseId;
    const decodeKind = t.kind === 'messageText' ? 'messageText' : 'participantLabel';
    if (isUnchanged(s.source, text, decodeKind)) return { ok: true, code: s.baseCode, id: baseId };
    // The codec reports an empty actor id as invalid_characters; the user's problem is "empty".
    if (t.kind === 'participantLabel' && text.trim() === '') return { ok: false, reason: 'empty' };
    const enc = encodeDisplayText(text, t.kind === 'messageText' ? 'messageText' : t.hasAlias ? 'aliasText' : 'actorId', {
      original: s.source, lineBefore: s.lineBefore, allowEmpty: t.kind === 'messageText',
    });
    if (!enc.ok) return { ok: false, reason: enc.reason };
    let result: EditResult;
    try {
      result = t.kind === 'messageText'
        ? deps.editMessageText(s.baseCode, s.baseMap, t.key, enc.source)
        : deps.renameParticipant(s.baseCode, s.baseMap, t.baseId, enc.source);
    } catch {
      result = { ok: false, reason: 'position_mismatch' };
    }
    if (!result.ok) return result;
    const id = t.kind === 'participantLabel' && !t.hasAlias ? enc.source.trim() : baseId;
    return { ok: true, code: result.code, id };
  }

  function candidate(s: Session): { code: string; tag: number } | null {
    const r = evaluate(s);
    if (!r.ok) {
      stats.invalid += 1;
      setInvalid(s, r.reason);
      return null;
    }
    setInvalid(s, null);
    s.idByCode.set(r.code, r.id);
    return { code: r.code, tag: s.lastInputAt };
  }

  function rejectBeforeOpen(target: Target, reason: EditRejection): void {
    deps.toast(REJECTION_MESSAGES[reason]);
    track('editor_inline_edit_rejected', { ...kindProps(target), inline_edit_rejection: reason });
  }

  function open(target: Target, texts: SVGTextElement[], event: MouseEvent, code: string, sourceMap: SequenceSourceMap): void {
    const root = svg();
    const vp = host.viewport();
    if (!root || !vp || !texts.length) return;
    const isMessage = target.kind === 'messageText';
    const key = isMessage ? target.key : target.baseId;
    let source: string | null;
    try {
      source = deps.sourceTextOf(sourceMap, target.kind, key);
    } catch {
      source = null;
    }
    const range = isMessage
      ? sourceMap.messages.get(target.key)?.textRange
      : (() => { const loc = sourceMap.participants.get(target.baseId); return loc ? (loc.hasAlias ? loc.labelRanges[0] : loc.idRanges[0]) : undefined; })();
    if (source === null || !range) {
      rejectBeforeOpen(target, 'position_mismatch');
      return;
    }
    const decodeKind = isMessage ? 'messageText' : 'participantLabel';
    // The picture must be exactly what the source decodes to (header copy for
    // participants). Otherwise the element is inert: no layer, no event.
    const drawn = isMessage ? readMessageLines(root, target.key) : readParticipantLines(root, target.baseId);
    if (!renderParity(source, drawn, decodeKind)) return;
    const prefill = decodeSourceText(source, decodeKind);
    if (prefill === null) return;
    hideHover();

    const layer = doc.createElement('div');
    layer.className = 'mie-layer';
    try { layer.contentEditable = 'plaintext-only'; } catch { /* unsupported value */ }
    if (layer.contentEditable !== 'plaintext-only') layer.contentEditable = 'true';
    layer.setAttribute('role', 'textbox');
    layer.setAttribute('aria-multiline', String(isMessage || target.hasAlias));
    layer.setAttribute('aria-label', isMessage ? 'Edit message text' : 'Edit participant name');
    layer.setAttribute('data-testid', 'mermaid-inline-edit-layer');
    layer.spellcheck = false;
    layer.textContent = prefill;

    const lineStart = code.lastIndexOf('\n', range[0] - 1) + 1;
    const baseId = isMessage ? String(target.key) : target.baseId;
    vp.holdView(true);
    const s: Session = {
      target, currentId: baseId, baseCode: code, baseMap: sourceMap,
      source, lineBefore: code.slice(lineStart, range[0]), initialText: prefill, layer, hint: null, invalid: null,
      host: vp.$el, viewport: vp, anchor: firstLineCentre(texts), realZoom: vp.getRealZoom() ?? 1,
      loop: null as unknown as RenderLoop,
      composing: false, lastInputAt: 0, rendering: false, shownCode: code, idByCode: new Map([[code, baseId]]),
      svgObserver: null, openedAt: now(), cleanup: () => undefined,
    };
    s.loop = createRenderLoop({
      initialCode: code,
      schedule,
      next: () => candidate(s),
      render: async (next) => {
        s.rendering = true;
        try {
          return await host.renderPreview(next);
        } finally {
          s.rendering = false;
        }
      },
      onRendered: (c, ok) => {
        if (!ok || session !== s) return;
        stats.renders += 1;
        stats.latencies.push(now() - (c.tag as number));
      },
    });

    // Window capture runs before every document-level listener (GenericViewer's
    // capture Escape handler, IgnoreEsc, menus), CodeMirror and the viewport.
    // stopPropagation does not cancel typing, copy or paste themselves.
    const onKey = (e: Event) => {
      if (e.target !== layer) return;
      e.stopPropagation();
      if (e.type !== 'keydown') return;
      const k = e as KeyboardEvent;
      if (k.isComposing || k.keyCode === 229 || s.composing) return;
      if (k.key === 'Enter' && !k.shiftKey) {
        e.preventDefault();
        commit('enter');
      } else if (k.key === 'Escape') {
        e.preventDefault();
        cancel('escape');
      } else if (k.key === 'Enter' && k.shiftKey && !isMessage && !target.hasAlias) {
        // An actor id cannot hold a line break.
        e.preventDefault();
      }
    };
    const stop = (e: Event) => e.stopPropagation();
    const request = () => {
      stats.inputs += 1;
      s.lastInputAt = now();
      s.loop.request();
    };
    const onInput = (e: Event) => {
      if ((e as InputEvent).isComposing || s.composing) return;
      request();
    };
    const onCompositionStart = () => { s.composing = true; };
    const onCompositionEnd = () => {
      s.composing = false;
      request();
    };
    const onDocPointerDown = (e: Event) => {
      if (session === s && !(e.target instanceof Node && layer.contains(e.target))) commit('away');
    };
    const onBlur = () => {
      if (session === s && (typeof doc.hasFocus !== 'function' || doc.hasFocus())) commit('away');
    };

    for (const name of KEY_EVENTS) win.addEventListener(name, onKey, true);
    for (const name of STOP_POINTER) layer.addEventListener(name, stop);
    layer.addEventListener('input', onInput);
    layer.addEventListener('compositionstart', onCompositionStart);
    layer.addEventListener('compositionend', onCompositionEnd);
    layer.addEventListener('blur', onBlur);
    doc.addEventListener('pointerdown', onDocPointerDown, true);
    s.cleanup = () => {
      for (const name of KEY_EVENTS) win.removeEventListener(name, onKey, true);
      for (const name of STOP_POINTER) layer.removeEventListener(name, stop);
      layer.removeEventListener('input', onInput);
      layer.removeEventListener('compositionstart', onCompositionStart);
      layer.removeEventListener('compositionend', onCompositionEnd);
      layer.removeEventListener('blur', onBlur);
      doc.removeEventListener('pointerdown', onDocPointerDown, true);
      s.svgObserver?.disconnect();
      s.loop.dispose();
    };

    session = s;
    stats.sessions += 1;
    setAffordance();
    host.setViewKeeper(keeper);
    vp.$el.appendChild(layer);
    for (const t of texts) t.classList.add(HIDDEN_CLASS);
    placeLayer(s, texts);
    observeSvg(s, root);
    layer.focus({ preventScroll: true });
    selectWordAt(layer, event.clientX, event.clientY);
    track('editor_inline_edit_started', kindProps(target));
  }

  /** Put the caret on the word under the pointer (select it), else at the end. */
  function selectWordAt(layer: HTMLElement, x: number, y: number): void {
    const sel = win.getSelection();
    if (!sel) return;
    const anyDoc = doc as any;
    let node: Node | null = null;
    let offset = 0;
    if (typeof anyDoc.caretRangeFromPoint === 'function') {
      const r: Range | null = anyDoc.caretRangeFromPoint(x, y);
      if (r) { node = r.startContainer; offset = r.startOffset; }
    } else if (typeof anyDoc.caretPositionFromPoint === 'function') {
      const p = anyDoc.caretPositionFromPoint(x, y);
      if (p) { node = p.offsetNode; offset = p.offset; }
    }
    const range = doc.createRange();
    if (!node || !layer.contains(node) || node.nodeType !== Node.TEXT_NODE) {
      range.selectNodeContents(layer);
      range.collapse(false);
    } else {
      const text = (node as Text).data;
      let start = offset;
      let end = offset;
      const Seg = (Intl as any).Segmenter;
      if (Seg) {
        for (const seg of new Seg(undefined, { granularity: 'word' }).segment(text)) {
          const segEnd = seg.index + seg.segment.length;
          if (seg.isWordLike && seg.index <= offset && offset <= segEnd) { start = seg.index; end = segEnd; break; }
        }
      }
      range.setStart(node, start);
      range.setEnd(node, end);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /** Remove the session; the SVG text stays hidden and the layer up until `teardown` runs. */
  function endSession(s: Session): () => void {
    s.cleanup();
    session = null;
    return () => {
      s.layer.remove();
      s.hint?.remove();
      s.hint = null;
      container.querySelectorAll(`.${HIDDEN_CLASS}`).forEach((el) => el.classList.remove(HIDDEN_CLASS));
    };
  }

  function holdUntil(s: Session, code: string, teardown: (() => void) | null): void {
    closing = {
      code, anchor: s.anchor, realZoom: s.realZoom, viewport: s.viewport, teardown,
      locate: (root, rendered) => textsOf(root, s.target, s.idByCode.get(rendered) ?? s.currentId),
    };
  }

  function releaseHold(): void {
    const c = closing;
    closing = null;
    c?.teardown?.();
    c?.viewport.holdView(false);
    host.setViewKeeper(null);
    setAffordance();
  }

  /** Close and show the base picture again (the store never changed). */
  function restoreBase(s: Session): void {
    const teardown = endSession(s);
    if (s.shownCode === s.baseCode) {
      teardown();
      holdUntil(s, s.baseCode, null);
      releaseHold();
      return;
    }
    setInvalid(s, null);
    s.layer.textContent = s.initialText;
    holdUntil(s, s.baseCode, teardown);
    setAffordance();
    void host.renderPreview(s.baseCode).finally(() => {
      if (closing && closing.code === s.baseCode) releaseHold();
    });
  }

  function commit(how: 'enter' | 'away'): void {
    const s = session;
    if (!s) return;
    const code = deps.getCode();
    if (code !== s.baseCode || map !== s.baseMap || !sameSource(code)) {
      // The source moved on without a notification: never write over it.
      deps.toast(REJECTION_MESSAGES.stale_source);
      track('editor_inline_edit_rejected', { ...kindProps(s.target), inline_edit_rejection: 'stale_source', inline_edit_ms_open: msOpen(s) });
      abort();
      return;
    }
    const r = evaluate(s);
    if (!r.ok) {
      // Enter keeps editing; leaving restores the base and says why.
      if (how === 'enter') {
        setInvalid(s, r.reason);
        return;
      }
      deps.toast(REJECTION_MESSAGES[r.reason]);
      track('editor_inline_edit_rejected', { ...kindProps(s.target), inline_edit_rejection: r.reason, inline_edit_ms_open: msOpen(s) });
      restoreBase(s);
      return;
    }
    if (r.code === s.baseCode) {
      track('editor_inline_edit_cancelled', { ...kindProps(s.target), inline_edit_cancel_reason: 'unchanged', inline_edit_ms_open: msOpen(s) });
      restoreBase(s);
      return;
    }
    const teardown = endSession(s);
    s.idByCode.set(r.code, r.id);
    // If the SVG on screen already shows the final candidate, swap back now
    // (same frame: SVG text appears, layer goes). Otherwise keep the layer
    // until the commit render lands.
    if (s.shownCode === r.code) {
      teardown();
      holdUntil(s, r.code, null);
    } else {
      holdUntil(s, r.code, teardown);
    }
    track('editor_inline_edit_succeeded', { ...kindProps(s.target), inline_edit_ms_open: msOpen(s) });
    deps.writeCode(r.code);
  }

  function cancel(reason: 'escape'): void {
    const s = session;
    if (!s) return;
    track('editor_inline_edit_cancelled', { ...kindProps(s.target), inline_edit_cancel_reason: reason, inline_edit_ms_open: msOpen(s) });
    restoreBase(s);
  }

  /** Close without any write, toast or event (re-render, external change, suspend, destroy). */
  function abort(options: { restore?: boolean } = {}): void {
    const s = session;
    if (!s) return;
    if (options.restore && s.shownCode !== s.baseCode && !destroyed) {
      restoreBase(s);
      return;
    }
    endSession(s)();
    holdUntil(s, '', null);
    releaseHold();
  }

  const onDoubleClick = (event: MouseEvent) => {
    if (destroyed || suspended || session || closing) return;
    const code = renderedCode;
    if (!map || !sameSource(code)) return;
    const root = svg();
    const resolved = root ? resolveTarget(event.target, root) : null;
    if (!root || !resolved || !EDITABLE_KINDS.sequence.includes(resolved.kind)) return;
    const anchor: Element = resolved.anchor;
    let target: Target;
    if (resolved.kind === 'messageText') {
      target = { kind: 'messageText', key: resolved.key };
    } else {
      const loc = map.participants.get(resolved.key);
      if (!loc) return;
      target = {
        kind: 'participantLabel', baseId: resolved.key, hasAlias: loc.hasAlias,
        copy: anchor.hasAttribute('data-et') ? 'header' : 'footer',
      };
    }
    const id = target.kind === 'messageText' ? String(target.key) : target.baseId;
    event.preventDefault();
    open(target, textsOf(root, target, id), event, code as string, map);
  };
  container.addEventListener('dblclick', onDoubleClick);
  container.addEventListener('pointerover', onPointerOver);
  container.addEventListener('pointerleave', hideHover);
  // Wheel zoom/pan moves the diagram under a hover box: drop it.
  container.addEventListener('wheel', hideHover, { passive: true });

  return {
    onRendered(code: string) {
      if (destroyed) return;
      generation += 1;
      renderedCode = code;
      map = null;
      mapPendingFor = null;
      hideHover();
      // A real render replaced the picture under the layer: close quietly.
      if (session) abort();
      if (closing && closing.code === code) releaseHold();
      prepare(code, generation);
      setAffordance();
    },
    onCodeChanged(code) {
      if (destroyed) return;
      const next = typeof code === 'string' ? code : null;
      if (session && next !== session.baseCode) {
        // Typing in the code panel or an AI apply while editing: never write over it.
        const s = session;
        deps.toast(REJECTION_MESSAGES.stale_source);
        track('editor_inline_edit_rejected', { ...kindProps(s.target), inline_edit_rejection: 'stale_source', inline_edit_ms_open: msOpen(s) });
        abort();
      }
      setAffordance();
    },
    setSuspended(value: boolean) {
      suspended = value;
      // Export capture must see the stored diagram, not a candidate.
      if (value) abort({ restore: true });
      setAffordance();
    },
    destroy() {
      if (destroyed) return;
      abort();
      if (closing) releaseHold();
      destroyed = true;
      container.removeEventListener('dblclick', onDoubleClick);
      container.removeEventListener('pointerover', onPointerOver);
      container.removeEventListener('pointerleave', hideHover);
      container.removeEventListener('wheel', hideHover);
      hideHover();
      container.classList.remove(ENABLED_CLASS, CURSOR_CLASS);
      channel?.port1.close();
      if (import.meta.env.DEV && (win as any).__mieInlineEdit?.stats === stats) delete (win as any).__mieInlineEdit;
    },
  };
}
