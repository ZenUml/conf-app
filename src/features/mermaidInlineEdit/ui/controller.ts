/**
 * Interaction layer for "edit Mermaid diagrams on the canvas": the in-place
 * (Figma-style) text editor, for sequence diagrams and flowcharts.
 *
 * A transparent contenteditable layer lives in the DiagramViewport element,
 * outside the v-html SVG, so a re-render never destroys it. It copies the font
 * and position of the label it covers; that label is hidden underneath.
 * While a session is open every input renders a candidate built from a fixed
 * base (baseCode + baseMap) through Mermaid.vue's renderPreview, with no store
 * write. After each swap, in the same task, the viewport is put back (zoom,
 * and the edited label's anchor at the same screen point) and the layer is
 * re-placed over the new label, found again by its key. The store is written
 * once, on commit. Esc leaves no trace.
 *
 * Everything that depends on the diagram type is in an adapter (adapter.ts).
 * A commit may be async (an adapter's gate re-parses the result); while it
 * runs the layer stays and takes no input.
 *
 * One rule decides whether anything is editable, checked when the map
 * arrives, on double-click and on commit: the code the visible SVG was
 * rendered from, `map.code` and the current store code are the same string.
 *
 * Knows nothing about the parser or the edit functions: they arrive as `deps`
 * (wired in ../index.ts), so this file runs in tests with fakes.
 */
import './inlineEdit.css';
import type { EditRejection, EditResult, SourceMap } from '../types';
import type { AnalyticsEventName, InlineEditUnavailableReason } from '@/utils/analytics/catalog';
import type { AnalyticsProperties } from '@/utils/analytics/types';
import { normalizeMermaidWhitespace } from '@/utils/mermaid/normalizeWhitespace';
import { baseProps, unionRect, type EditHandle, type InlineEditAdapter, type Point } from './adapter';
import { createSequenceAdapter, glyphColour, type SequenceAdapterDeps } from './sequenceAdapter';
import { createFlowchartAdapter, type FlowchartInlineEditDeps } from './flowchartAdapter';
import { createRenderLoop, type RenderLoop } from './renderLoop';

export { glyphColour };
export type { FlowchartInlineEditDeps };

export type InlineEditEventName = Extract<AnalyticsEventName, `editor_inline_edit_${string}`>;

export interface InlineEditDeps extends SequenceAdapterDeps {
  /** Flowchart editing. Absent: flowcharts stay inert (no map request, no cursor). */
  flowchart?: FlowchartInlineEditDeps;
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
  /** Timers for the slow-render debounce. Default: the window's. */
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
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

interface Session {
  adapter: InlineEditAdapter;
  handle: EditHandle;
  /** The target's element key in the SVG on screen. */
  currentKey: string;
  baseCode: string;
  baseMap: SourceMap;
  initialText: string;
  layer: HTMLDivElement;
  hint: HTMLDivElement | null;
  invalid: EditRejection | null;
  host: HTMLElement;
  viewport: InlineEditViewport;
  anchor: Point;
  realZoom: number;
  loop: RenderLoop;
  composing: boolean;
  lastInputAt: number;
  rendering: boolean;
  /** Duration of the last preview render (ms); drives the slow-render debounce. */
  lastRenderMs: number;
  /** An async commit is being checked: the layer stays and takes no input. */
  committing: boolean;
  shownCode: string;
  /** Element key each candidate code draws the target with. */
  keyByCode: Map<string, string>;
  svgObserver: MutationObserver | null;
  openedAt: number;
  cleanup: () => void;
}

/** After close: keep the view until the render showing `code` lands. */
interface Closing {
  code: string;
  anchor: Point;
  realZoom: number;
  viewport: InlineEditViewport;
  adapter: InlineEditAdapter;
  locate: (root: Element, code: string) => Element[];
  teardown: (() => void) | null;
}

export interface InlineEditStats {
  sessions: number;
  inputs: number;
  renders: number;
  /** input event -> new SVG in DOM, viewport restored, layer re-placed (ms). */
  latencies: number[];
  /** renderPreview start -> resolved (ms), per preview render. */
  renderMs: number[];
  /** Screen position of the edited label's anchor after each re-place. */
  anchorTrace: Array<{ x: number; y: number; realZoom: number | null; id?: string }>;
  invalid: number;
}

const KEY_EVENTS = ['keydown', 'keypress', 'keyup', 'copy', 'cut', 'paste'] as const;
const STOP_POINTER = ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick', 'wheel', 'contextmenu'] as const;
const ENABLED_CLASS = 'mie-enabled';
const CURSOR_CLASS = 'mie-cursor';
const HIDDEN_CLASS = 'mie-hidden';
const INVALID_CLASS = 'mie-invalid';
/** Wait after the last keystroke before a preview render, once renders are slow (adapter.slowRenderMs). */
export const SLOW_RENDER_DEBOUNCE_MS = 250;
/** Commit rejections that keep the layer open: the user can fix the text. */
const KEEP_OPEN: ReadonlySet<EditRejection> = new Set(['empty', 'invalid_characters']);

// One editor session is one iframe page load (the editor modal is its own iframe).
// Key `${diagram}:${reason}`. Sequence only ever sends `no_map`, so for it this
// is the shipped "at most once per editor session".
const unavailableSent = new Set<string>();
export function __resetInlineEditSessionForTests(): void {
  unavailableSent.clear();
}

const isThenable = (value: unknown): value is Promise<EditResult> =>
  !!value && typeof (value as { then?: unknown }).then === 'function';

export function attachInlineEdit(container: HTMLElement, deps: InlineEditDeps, host: InlineEditHost): InlineEditController {
  const doc = container.ownerDocument;
  const win = doc.defaultView ?? window;
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const channel = typeof MessageChannel !== 'undefined' && !deps.schedule ? new MessageChannel() : null;
  const queued: Array<() => void> = [];
  if (channel) channel.port1.onmessage = () => queued.shift()?.();
  const schedule = deps.schedule
    ?? (channel ? (run: () => void) => { queued.push(run); channel.port2.postMessage(0); } : (run: () => void) => { win.setTimeout(run, 0); });
  const setTimer = deps.setTimer ?? ((run: () => void, ms: number) => win.setTimeout(run, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => win.clearTimeout(handle as number));

  const adapters: InlineEditAdapter[] = [createSequenceAdapter(deps, win) as unknown as InlineEditAdapter];
  if (deps.flowchart) adapters.push(createFlowchartAdapter(deps.flowchart, win) as unknown as InlineEditAdapter);
  const adapterFor = (root: Element | null) => adapters.find((a) => a.accepts(root)) ?? null;

  let destroyed = false;
  let suspended = false;
  let generation = 0;
  let renderedCode: string | null = null;
  let map: SourceMap | null = null;
  /** The adapter the map came from. */
  let mapAdapter: InlineEditAdapter | null = null;
  /** The code a source map is being computed for (cursor stays on meanwhile). */
  let mapPendingFor: string | null = null;
  /** The code whose source map came back null or failed: that diagram is read-only. */
  let mapUnavailableFor: string | null = null;
  let session: Session | null = null;
  let closing: Closing | null = null;
  let hoverBox: HTMLDivElement | null = null;

  const stats: InlineEditStats = { sessions: 0, inputs: 0, renders: 0, latencies: [], renderMs: [], anchorTrace: [], invalid: 0 };
  if (import.meta.env.DEV) {
    // Measurement hook for the Storybook harness; stripped from production builds.
    (win as any).__mieInlineEdit = {
      stats,
      session: () => session,
      viewport: () => host.viewport(),
      resetStats() { Object.assign(stats, { inputs: 0, renders: 0, latencies: [], renderMs: [], anchorTrace: [], invalid: 0 }); },
      idle: () => session?.loop.idle() ?? Promise.resolve(),
      rerender: () => (session ? host.renderPreview(session.shownCode) : Promise.resolve(false)),
    };
  }

  const msOpen = (s: Session) => Math.round(now() - s.openedAt);
  const track = (name: InlineEditEventName, props: AnalyticsProperties) => {
    try { deps.track(name, props); } catch { /* analytics never breaks editing */ }
  };
  const reportUnavailable = (adapter: InlineEditAdapter, reason: InlineEditUnavailableReason) => {
    const key = `${adapter.diagram}:${reason}`;
    if (unavailableSent.has(key)) return;
    unavailableSent.add(key);
    track('editor_inline_edit_unavailable', { ...baseProps(adapter.diagram), inline_edit_unavailable_reason: reason });
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
    const adapter = adapterFor(root);
    if (!root || !adapter) return;
    // Mermaid.vue renders normalizeMermaidWhitespace(code). An id holding
    // U+00A0 would render a different key than the map key. Read-only, no event.
    if (normalizeMermaidWhitespace(code) !== code) return;
    adapter.prepareSvg(root);
    mapPendingFor = code;
    let pending: Promise<SourceMap | null>;
    try {
      pending = Promise.resolve(adapter.getSourceMap(code));
    } catch (error) {
      pending = Promise.reject(error);
    }
    const settle = () => {
      if (mapPendingFor === code) mapPendingFor = null;
    };
    const unavailable = () => {
      mapUnavailableFor = code;
      if (adapter.unavailableOn === 'render') reportUnavailable(adapter, 'no_map');
    };
    pending.then(
      (result) => {
        if (destroyed || gen !== generation || renderedCode !== code) return;
        settle();
        if (!result) {
          unavailable();
          setAffordance();
          return;
        }
        // A map for other code (or code that moved on) is never used.
        if (result.code === code && deps.getCode() === code) {
          map = result;
          mapAdapter = adapter;
        }
        setAffordance();
      },
      () => {
        if (destroyed || gen !== generation) return;
        settle();
        setAffordance();
        unavailable();
      },
    );
  }

  // ---------- layer ----------

  function placeLayer(s: Session, elements: Element[]): void {
    s.adapter.place(s.layer, elements, s.host);
    placeHint(s);
  }

  /** The hint sits directly under the layer, centred on it. */
  function placeHint(s: Session): void {
    if (!s.hint) return;
    const l = s.layer.getBoundingClientRect();
    const h = s.host.getBoundingClientRect();
    // Centred (CSS translateX(-50%)), but kept inside the host so a label
    // near the pane edge does not get its hint clipped.
    const half = s.hint.offsetWidth / 2;
    const centre = l.left + l.width / 2 - h.left;
    const max = h.width - half - 4;
    const min = half + 4;
    s.hint.style.left = `${max < min ? centre : Math.min(Math.max(centre, min), max)}px`;
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
    s.hint.textContent = s.adapter.messages[reason];
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

  function showHover(elements: Element[]): void {
    const vp = host.viewport();
    if (!vp || !elements.length) return hideHover();
    const hostRect = vp.$el.getBoundingClientRect();
    const { left, top, right, bottom } = unionRect(elements);
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
    if (session || !container.classList.contains(ENABLED_CLASS) || !map || !mapAdapter) return hideHover();
    const root = svg();
    if (!root || !mapAdapter.accepts(root)) return hideHover();
    const hit = mapAdapter.hit(event.target, root);
    if (!hit) return hideHover();
    showHover(mapAdapter.hoverElements(root, hit, map));
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
      if (root && c.adapter.accepts(root)) {
        c.adapter.prepareSvg(root);
        const elements = c.locate(root, code);
        if (elements.length) {
          // A late preview of an older candidate: keep the layer the only visible text.
          if (code !== c.code && c.teardown) for (const t of elements) t.classList.add(HIDDEN_CLASS);
          const p = c.adapter.anchor(elements);
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
    if (!root || !s.adapter.accepts(root)) return;
    s.adapter.prepareSvg(root);
    const key = s.keyByCode.get(code) ?? s.currentKey;
    const elements = s.handle.locate(root, key);
    if (!elements.length) return;
    s.currentKey = key;
    for (const t of elements) t.classList.add(HIDDEN_CLASS);
    const p = s.adapter.anchor(elements);
    s.viewport.panByScreen(s.anchor.x - p.x, s.anchor.y - p.y);
    s.viewport.flushView();
    placeLayer(s, elements);
    s.shownCode = code;
    const after = s.adapter.anchor(elements);
    stats.anchorTrace.push({ x: after.x, y: after.y, realZoom: s.viewport.getRealZoom(), id: key });
    observeSvg(s, root);
  }

  /** User pan/zoom during a session (wheel, toolbar): follow it and adopt it as the new anchor. */
  function observeSvg(s: Session, root: Element): void {
    s.svgObserver?.disconnect();
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => {
      if (session !== s || s.rendering || !root.isConnected) return;
      const elements = s.handle.locate(root, s.currentKey);
      if (!elements.length) return;
      s.realZoom = s.viewport.getRealZoom() ?? s.realZoom;
      s.anchor = s.adapter.anchor(elements);
      placeLayer(s, elements);
    });
    observer.observe(root, { attributes: true, subtree: true, attributeFilter: ['transform', 'style'] });
    // Our own zoom/pan above must not count as a user move.
    observer.takeRecords();
    s.svgObserver = observer;
  }

  /** The candidate for the layer's current text, or the rejection. Always from the base. */
  function evaluate(s: Session) {
    try {
      return s.handle.evaluate(readText(s.layer));
    } catch {
      return { ok: false as const, reason: 'position_mismatch' as const };
    }
  }

  function candidate(s: Session): { code: string; tag: number } | null {
    const r = evaluate(s);
    if (!r.ok) {
      stats.invalid += 1;
      setInvalid(s, r.reason);
      return null;
    }
    setInvalid(s, null);
    s.keyByCode.set(r.code, r.key);
    return { code: r.code, tag: s.lastInputAt };
  }

  function open(adapter: InlineEditAdapter, handle: EditHandle, event: MouseEvent, code: string, sourceMap: SourceMap): void {
    const root = svg();
    const vp = host.viewport();
    if (!root || !vp) return;
    const elements = handle.locate(root, handle.baseKey);
    if (!elements.length) return;
    hideHover();

    const layer = doc.createElement('div');
    layer.className = 'mie-layer';
    layer.setAttribute('data-mie-diagram', adapter.diagram);
    try { layer.contentEditable = 'plaintext-only'; } catch { /* unsupported value */ }
    if (layer.contentEditable !== 'plaintext-only') layer.contentEditable = 'true';
    layer.setAttribute('role', 'textbox');
    layer.setAttribute('aria-multiline', String(handle.multiline));
    layer.setAttribute('aria-label', handle.ariaLabel);
    layer.setAttribute('data-testid', 'mermaid-inline-edit-layer');
    layer.spellcheck = false;
    layer.textContent = handle.prefill;

    vp.holdView(true);
    const s: Session = {
      adapter, handle, currentKey: handle.baseKey, baseCode: code, baseMap: sourceMap,
      initialText: handle.prefill, layer, hint: null, invalid: null,
      host: vp.$el, viewport: vp, anchor: adapter.anchor(elements), realZoom: vp.getRealZoom() ?? 1,
      loop: null as unknown as RenderLoop,
      composing: false, lastInputAt: 0, rendering: false, lastRenderMs: 0, committing: false,
      shownCode: code, keyByCode: new Map([[code, handle.baseKey]]),
      svgObserver: null, openedAt: now(), cleanup: () => undefined,
    };
    s.loop = createRenderLoop({
      initialCode: code,
      schedule,
      now,
      setTimer,
      clearTimer,
      // Slow renders: wait for a typing pause. The layer itself is plain
      // contenteditable, so typing never waits for a render.
      delay: () => (adapter.slowRenderMs !== null && s.lastRenderMs > adapter.slowRenderMs ? SLOW_RENDER_DEBOUNCE_MS : 0),
      next: () => (s.committing ? null : candidate(s)),
      render: async (next) => {
        s.rendering = true;
        const started = now();
        try {
          return await host.renderPreview(next);
        } finally {
          s.rendering = false;
          s.lastRenderMs = now() - started;
          stats.renderMs.push(s.lastRenderMs);
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
      // A commit is being checked: the text is fixed until it settles.
      if (s.committing) {
        e.preventDefault();
        return;
      }
      const k = e as KeyboardEvent;
      if (k.isComposing || k.keyCode === 229 || s.composing) return;
      if (k.key === 'Enter' && !k.shiftKey) {
        e.preventDefault();
        commit('enter');
      } else if (k.key === 'Escape') {
        e.preventDefault();
        cancel('escape');
      } else if (k.key === 'Enter' && k.shiftKey && !handle.multiline) {
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
    const onBeforeInput = (e: Event) => {
      if (s.committing) e.preventDefault();
    };
    const onInput = (e: Event) => {
      if ((e as InputEvent).isComposing || s.composing || s.committing) return;
      request();
    };
    const onCompositionStart = () => { s.composing = true; };
    const onCompositionEnd = () => {
      s.composing = false;
      if (!s.committing) request();
    };
    const onDocPointerDown = (e: Event) => {
      if (session === s && !(e.target instanceof Node && layer.contains(e.target))) commit('away');
    };
    const onBlur = () => {
      if (session === s && (typeof doc.hasFocus !== 'function' || doc.hasFocus())) commit('away');
    };

    for (const name of KEY_EVENTS) win.addEventListener(name, onKey, true);
    for (const name of STOP_POINTER) layer.addEventListener(name, stop);
    layer.addEventListener('beforeinput', onBeforeInput);
    layer.addEventListener('input', onInput);
    layer.addEventListener('compositionstart', onCompositionStart);
    layer.addEventListener('compositionend', onCompositionEnd);
    layer.addEventListener('blur', onBlur);
    doc.addEventListener('pointerdown', onDocPointerDown, true);
    s.cleanup = () => {
      for (const name of KEY_EVENTS) win.removeEventListener(name, onKey, true);
      for (const name of STOP_POINTER) layer.removeEventListener(name, stop);
      layer.removeEventListener('beforeinput', onBeforeInput);
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
    for (const t of elements) t.classList.add(HIDDEN_CLASS);
    placeLayer(s, elements);
    observeSvg(s, root);
    layer.focus({ preventScroll: true });
    selectWordAt(layer, event.clientX, event.clientY);
    track('editor_inline_edit_started', handle.props);
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

  /** Remove the session; the label stays hidden and the layer up until `teardown` runs. */
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
      code, anchor: s.anchor, realZoom: s.realZoom, viewport: s.viewport, adapter: s.adapter, teardown,
      locate: (root, rendered) => s.handle.locate(root, s.keyByCode.get(rendered) ?? s.currentKey),
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

  /** The source moved on since the layer opened (with or without a notification). */
  const isStale = (s: Session) => deps.getCode() !== s.baseCode || map !== s.baseMap || !sameSource(s.baseCode);

  function rejectStale(s: Session): void {
    deps.toast(s.adapter.messages.stale_source);
    track('editor_inline_edit_rejected', { ...s.handle.props, inline_edit_rejection: 'stale_source', inline_edit_ms_open: msOpen(s) });
    abort();
  }

  function commit(how: 'enter' | 'away'): void {
    const s = session;
    if (!s || s.committing) return;
    if (isStale(s)) {
      // The source moved on without a notification: never write over it.
      rejectStale(s);
      return;
    }
    const text = readText(s.layer);
    const r = evaluate(s);
    if (!r.ok) {
      // Enter keeps editing; leaving restores the base and says why.
      if (how === 'enter') {
        setInvalid(s, r.reason);
        return;
      }
      deps.toast(s.adapter.messages[r.reason]);
      track('editor_inline_edit_rejected', { ...s.handle.props, inline_edit_rejection: r.reason, inline_edit_ms_open: msOpen(s) });
      restoreBase(s);
      return;
    }
    if (r.code === s.baseCode) {
      track('editor_inline_edit_cancelled', { ...s.handle.props, inline_edit_cancel_reason: 'unchanged', inline_edit_ms_open: msOpen(s) });
      restoreBase(s);
      return;
    }
    let result: EditResult | Promise<EditResult>;
    try {
      result = s.handle.commit(text, r.code);
    } catch {
      result = { ok: false, reason: 'position_mismatch' };
    }
    if (!isThenable(result)) {
      settleCommit(s, result, r.key);
      return;
    }
    // A gate re-parses with Mermaid: keep the layer, take no input, and start
    // no further preview render (a late one would supersede the commit render).
    s.committing = true;
    s.loop.cancelPending();
    s.layer.setAttribute('aria-busy', 'true');
    const key = r.key;
    const done = (res: EditResult) => {
      if (session !== s || destroyed) return;
      s.committing = false;
      s.layer.removeAttribute('aria-busy');
      if (isStale(s)) {
        rejectStale(s);
        return;
      }
      settleCommit(s, res, key);
    };
    result.then(done, () => done({ ok: false, reason: 'position_mismatch' }));
  }

  function settleCommit(s: Session, result: EditResult, key: string): void {
    if (!result.ok) {
      if (KEEP_OPEN.has(result.reason)) {
        setInvalid(s, result.reason);
        return;
      }
      deps.toast(s.adapter.messages[result.reason]);
      track('editor_inline_edit_rejected', { ...s.handle.props, inline_edit_rejection: result.reason, inline_edit_ms_open: msOpen(s) });
      restoreBase(s);
      return;
    }
    const teardown = endSession(s);
    s.keyByCode.set(result.code, key);
    // If the SVG on screen already shows the final candidate, swap back now
    // (same frame: the label appears, the layer goes). Otherwise keep the layer
    // until the commit render lands.
    if (s.shownCode === result.code) {
      teardown();
      holdUntil(s, result.code, null);
    } else {
      holdUntil(s, result.code, teardown);
    }
    track('editor_inline_edit_succeeded', { ...s.handle.props, inline_edit_ms_open: msOpen(s) });
    deps.writeCode(result.code);
  }

  function cancel(reason: 'escape'): void {
    const s = session;
    if (!s) return;
    track('editor_inline_edit_cancelled', { ...s.handle.props, inline_edit_cancel_reason: reason, inline_edit_ms_open: msOpen(s) });
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
    const root = svg();
    const adapter = adapterFor(root);
    if (!root || !adapter) return;
    const hit = adapter.hit(event.target, root);
    if (!hit) return;
    if (!map || mapAdapter !== adapter || !sameSource(code)) {
      // A diagram the parser gave no map for is read-only: said once, on this user action.
      if (adapter.unavailableOn === 'doubleClick' && code !== null && mapUnavailableFor === code && deps.getCode() === code) {
        reportUnavailable(adapter, 'no_map');
      }
      return;
    }
    event.preventDefault();
    const r = adapter.begin(hit, map, root, code as string);
    if (!r) return;
    if ('unavailable' in r) {
      reportUnavailable(adapter, r.unavailable);
      return;
    }
    if ('reject' in r) {
      deps.toast(adapter.messages[r.reject]);
      track('editor_inline_edit_rejected', { ...r.props, inline_edit_rejection: r.reject });
      return;
    }
    open(adapter, r.open, event, code as string, map);
  };
  /**
   * A linked node (`click X href`) is an <a> in the SVG. In the editor preview
   * its first click would leave the editor, so a double-click on it, or an
   * attempt to edit it, would navigate: links are not followed here.
   */
  const onClick = (event: MouseEvent) => {
    const root = svg();
    if (!root || !adapterFor(root) || !(event.target instanceof Element)) return;
    const link = event.target.closest('a');
    if (link && root.contains(link)) event.preventDefault();
  };
  container.addEventListener('click', onClick);
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
      mapAdapter = null;
      mapPendingFor = null;
      mapUnavailableFor = null;
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
      // Typing in the code panel or an AI apply while editing: never write over it.
      if (session && next !== session.baseCode) rejectStale(session);
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
      container.removeEventListener('click', onClick);
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
