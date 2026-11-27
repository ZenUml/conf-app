import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import realSvg from './__fixtures__/sequence-11.17.2.svg?raw';
import {
  attachInlineEdit, glyphColour, __resetInlineEditSessionForTests,
  type InlineEditDeps, type InlineEditHost, type InlineEditViewport,
} from './controller';
import { MESSAGE_TAG, FOOTER_TAG, tagRenderedSequence, resolveTarget } from './domMapping';
import { REJECTION_MESSAGES } from './copy';
import type { EditResult, SequenceSourceMap } from '../types';
import { sampleRateFor } from '@/utils/analytics/eventSampling';

// Real Mermaid 11.17.2 output (rendered in Chromium through mermaid.render,
// strict security level, so after DOMPurify) of __fixtures__/sequence-11.17.2.mmd:
//   participant A as Alice / actor B as Bob / participant D@{database}
//   i0 A->>B: Hello<br/>two lines   i1 A->>D: $$x^2$$ (KaTeX)
//   i2 Note   i3 B->>A: wrap:...long...   i4 A->>A: Same   i5 A->>A: Same
const CODE_A = 'sequenceDiagram\n  participant A as Alice\n  A->>B: Hello<br/>two lines\n';
const CODE_B = CODE_A + '  B->>A: more\n';
const BASE_PROPS = { feature_area: 'macro', surface: 'editor', macro_type: 'mermaid', inline_edit_diagram: 'sequence' };

/**
 * The fake edit functions append a marker to the code; the fake renderer
 * draws the fixture and applies the marker, so every candidate has a picture.
 */
function draw(content: HTMLElement, code: string, opts: { bNoAlias: boolean }) {
  content.innerHTML = realSvg;
  const svg = content.querySelector('svg')!;
  const setLabel = (id: string, text: string) => {
    for (const el of Array.from(svg.querySelectorAll(`[data-et="participant"][data-id="${id}"] tspan, .actor-bottom[name="${id}"] tspan, [name="${id}"].actor-bottom ~ text tspan`))) el.textContent = text;
    for (const rect of Array.from(svg.querySelectorAll(`rect.actor-bottom[name="${id}"]`))) {
      const t = rect.parentElement!.querySelector('tspan');
      if (t) t.textContent = text;
    }
  };
  if (opts.bNoAlias) setLabel('B', 'B');
  const rename = /%rename (\w+)=(.*)$/.exec(code);
  if (rename) {
    const [, id, name] = rename;
    const loc = id === 'A' ? 'alias' : opts.bNoAlias ? 'id' : 'alias';
    setLabel(id, name);
    if (loc === 'id') {
      for (const el of Array.from(svg.querySelectorAll(`[name="${id}"]`))) el.setAttribute('name', name);
      for (const el of Array.from(svg.querySelectorAll(`[data-id="${id}"]`))) el.setAttribute('data-id', name);
    }
  }
  const msg = /%msg (\d+)=(.*)$/s.exec(code);
  if (msg) {
    const line = svg.querySelector(`[data-et="message"][data-id="i${msg[1]}"]`)!;
    while (line.previousElementSibling?.classList.contains('messageText')) line.previousElementSibling.remove();
    for (const text of msg[2].split(/<br\s*\/?>/i)) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('class', 'messageText');
      t.textContent = text === '' ? '​' : text;
      line.parentNode!.insertBefore(t, line);
    }
  }
}

function fakeMap(code: string, opts: { bNoAlias: boolean }): SequenceSourceMap {
  return {
    code,
    participants: new Map([
      ['A', { labelRanges: [[26, 31]], idRanges: [[22, 23]], hasAlias: true }],
      ['B', opts.bNoAlias
        ? { labelRanges: [[37, 38]], idRanges: [[37, 38]], hasAlias: false }
        : { labelRanges: [[37, 38]], idRanges: [[37, 38]], hasAlias: true }],
    ]),
    messages: new Map([[0, { textRange: [40, 59] }], [4, { textRange: [0, 1] }], [5, { textRange: [0, 1] }]]),
    notes: new Map(),
  };
}

interface Harness {
  container: HTMLElement;
  content: HTMLElement;
  deps: InlineEditDeps & Record<'track' | 'toast' | 'writeCode' | 'renameParticipant' | 'editMessageText' | 'getSourceMap' | 'sourceTextOf', ReturnType<typeof vi.fn>>;
  host: InlineEditHost & { renderPreview: ReturnType<typeof vi.fn>; setViewKeeper: ReturnType<typeof vi.fn> };
  viewport: InlineEditViewport & Record<'holdView' | 'setRealZoom' | 'panByScreen', ReturnType<typeof vi.fn>>;
  keeper: () => ((code: string) => void) | null;
  store: { code: string };
  controller: ReturnType<typeof attachInlineEdit>;
  flush: () => Promise<void>;
  /** A real store render: new SVG, the keeper, then onRendered. */
  render: (code?: string) => Promise<void>;
}

interface SetupOptions {
  map?: (code: string) => SequenceSourceMap | null | Promise<SequenceSourceMap | null>;
  code?: string;
  bNoAlias?: boolean;
  renderPreview?: (code: string, paint: () => void) => Promise<boolean>;
}

const controllers: ReturnType<typeof attachInlineEdit>[] = [];

function setup(opts: SetupOptions = {}): Harness {
  const bNoAlias = opts.bNoAlias ?? false;
  const store = { code: opts.code ?? CODE_A };
  const container = document.createElement('div');
  container.innerHTML = '<div class="diagram-viewport"><div class="diagram-viewport-content"></div></div>';
  document.body.appendChild(container);
  const content = container.querySelector('.diagram-viewport-content') as HTMLElement;
  draw(content, store.code, { bNoAlias });
  let keeper: ((code: string) => void) | null = null;
  const viewport = {
    $el: container.querySelector('.diagram-viewport') as HTMLElement,
    holdView: vi.fn(), getRealZoom: () => 1, setRealZoom: vi.fn(), panByScreen: vi.fn(), flushView: () => undefined,
  };
  const paintAndKeep = (code: string) => { draw(content, code, { bNoAlias }); keeper?.(code); };
  const host = {
    renderPreview: vi.fn(async (code: string) => {
      if (opts.renderPreview) return opts.renderPreview(code, () => paintAndKeep(code));
      paintAndKeep(code);
      return true;
    }),
    setViewKeeper: vi.fn((fn: ((code: string) => void) | null) => { keeper = fn; }),
    viewport: () => viewport,
  };
  const sourceOf = (map: SequenceSourceMap, kind: string, key: string | number) => {
    if (kind === 'participantLabel') return key === 'A' ? 'Alice' : key === 'B' ? (bNoAlias ? 'B' : 'Bob') : null;
    return key === 0 ? 'Hello<br/>two lines' : key === 4 || key === 5 ? 'Same' : null;
  };
  const deps = {
    getSourceMap: vi.fn(async (code: string) => (opts.map ? opts.map(code) : fakeMap(code, { bNoAlias }))),
    renameParticipant: vi.fn((code: string, _map, id: string, name: string): EditResult => {
      if (bNoAlias && id === 'B' && name === 'A') return { ok: false, reason: 'name_exists' };
      return { ok: true, code: `${code}%rename ${id}=${name}` };
    }),
    editMessageText: vi.fn((code: string, _map, i: number, text: string): EditResult => ({ ok: true, code: `${code}%msg ${i}=${text}` })),
    sourceTextOf: vi.fn(sourceOf),
    getCode: () => store.code,
    writeCode: vi.fn((code: string) => { store.code = code; }),
    track: vi.fn(),
    toast: vi.fn(),
    now: () => 1000,
    schedule: (run: () => void) => run(),
  };
  const controller = attachInlineEdit(container, deps as unknown as InlineEditDeps, host as unknown as InlineEditHost);
  controllers.push(controller);
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  const render = async (code = store.code) => {
    paintAndKeep(code);
    controller.onRendered(code);
    await flush();
  };
  return {
    container, content, deps: deps as any, host: host as any, viewport: viewport as any,
    keeper: () => keeper, store, controller, flush, render,
  };
}

const svgOf = (h: Harness) => h.content.querySelector('svg[aria-roledescription]') as SVGSVGElement;
const header = (h: Harness, id: string) =>
  Array.from(svgOf(h).querySelectorAll('[data-et="participant"]')).find((el) => el.getAttribute('data-id') === id)!;
const footer = (h: Harness, id: string) => svgOf(h).querySelector(`[${FOOTER_TAG}="${id}"]`)!;
const messageTexts = (h: Harness, i: number) =>
  Array.from(svgOf(h).querySelectorAll(`[${MESSAGE_TAG}]`)).filter((el) => el.getAttribute(MESSAGE_TAG) === `i${i}`);
const layer = () => document.querySelector('[data-testid="mermaid-inline-edit-layer"]') as HTMLElement | null;
const hint = () => document.querySelector('[data-testid="mermaid-inline-edit-hint"]') as HTMLElement | null;
const hoverBox = () => document.querySelector('[data-testid="mermaid-inline-edit-hover"]');
const dblclick = (el: Element) => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
};
async function type(h: Harness, text: string) {
  layer()!.textContent = text;
  layer()!.dispatchEvent(new Event('input', { bubbles: true }));
  await h.flush();
}
const names = (h: Harness) => h.deps.track.mock.calls.map(([n]) => n);
const events = (h: Harness, name: string) => h.deps.track.mock.calls.filter(([n]) => n === name).map(([, p]) => p);
const hidden = (h: Harness) => Array.from(svgOf(h).querySelectorAll('.mie-hidden'));

beforeEach(() => {
  __resetInlineEditSessionForTests();
});
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
  document.body.innerHTML = '';
});

describe('DOM mapping on a real Mermaid 11.17.2 render', () => {
  it('keeps data-et/data-id through mermaid.render (DOMPurify)', () => {
    const doc = new DOMParser().parseFromString(realSvg, 'image/svg+xml');
    const ids = Array.from(doc.querySelectorAll('[data-et="participant"]')).map((e) => e.getAttribute('data-id')).sort();
    expect(ids).toEqual(['A', 'B', 'D']);
    expect(Array.from(doc.querySelectorAll('[data-et="message"]')).map((e) => e.getAttribute('data-id')))
      .toEqual(['i0', 'i1', 'i3', 'i4', 'i5']);
  });

  it('tags every line of a multi-line and a wrapped message, and never a KaTeX label', () => {
    const div = document.createElement('div');
    div.innerHTML = realSvg;
    const svg = div.querySelector('svg')!;
    tagRenderedSequence(svg);
    const tagged = (i: number) => Array.from(svg.querySelectorAll(`[${MESSAGE_TAG}="i${i}"]`)).map((e) => e.textContent);
    expect(tagged(0)).toEqual(['Hello', 'two lines']);
    expect(tagged(1)).toEqual([]);
    expect(tagged(3).length).toBe(3);
    expect(tagged(4)).toEqual(['Same']);
    expect(svg.querySelector(`[${MESSAGE_TAG}="i4"]`)).not.toBe(svg.querySelector(`[${MESSAGE_TAG}="i5"]`));
  });

  it('maps footer copies by their exact name attribute; the typed database footer stays inert', () => {
    const div = document.createElement('div');
    div.innerHTML = realSvg;
    const svg = div.querySelector('svg')!;
    tagRenderedSequence(svg);
    expect(Array.from(svg.querySelectorAll(`[${FOOTER_TAG}]`)).map((e) => e.getAttribute(FOOTER_TAG)).sort()).toEqual(['A', 'B']);
    expect(resolveTarget(svg.querySelector(`[${FOOTER_TAG}="A"] text`)!, svg)).toMatchObject({ kind: 'participantLabel', key: 'A' });
    expect(resolveTarget(svg.querySelector('g.actor-bottom:not([name])')!, svg)).toBeNull();
  });

  it('tagging twice does not double-tag', () => {
    const div = document.createElement('div');
    div.innerHTML = realSvg;
    const svg = div.querySelector('svg')!;
    tagRenderedSequence(svg);
    tagRenderedSequence(svg);
    expect(svg.querySelectorAll(`[${MESSAGE_TAG}="i0"]`).length).toBe(2);
  });
});

describe('gates', () => {
  it('a sequence render with a map for the same code is editable, with the arrow cursor', async () => {
    const h = setup();
    await h.render();
    expect(h.container.classList.contains('mie-enabled')).toBe(true);
    expect(h.container.classList.contains('mie-cursor')).toBe(true);
    expect(h.deps.track).not.toHaveBeenCalled();
  });

  it('a click on a link in a sequence diagram (actor link menu) is left alone', async () => {
    const h = setup();
    await h.render();
    const svg = h.container.querySelector('svg')!;
    const a = document.createElementNS('http://www.w3.org/2000/svg', 'a');
    a.setAttribute('href', 'https://example.com/');
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    a.appendChild(t);
    svg.appendChild(a);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
    t.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  });

  it('not a sequence diagram: no map request, no cursor', async () => {
    const h = setup();
    svgOf(h).setAttribute('aria-roledescription', 'flowchart-v2');
    h.controller.onRendered(CODE_A);
    await h.flush();
    expect(h.deps.getSourceMap).not.toHaveBeenCalled();
    expect(h.container.classList.contains('mie-cursor')).toBe(false);
  });

  it('source with U+00A0 (renderer normalises it) is read-only, with no event', async () => {
    const nbsp = 'sequenceDiagram\n  A->>B:\u00A0hi\n';
    const h = setup({ code: nbsp });
    await h.render(nbsp);
    expect(h.deps.getSourceMap).not.toHaveBeenCalled();
    expect(h.container.classList.contains('mie-enabled')).toBe(false);
    expect(h.deps.track).not.toHaveBeenCalled();
  });

  it('null map: inert, no toast on double-click, unavailable once per editor session', async () => {
    const h = setup({ map: () => null });
    await h.render();
    await h.render();
    expect(h.container.classList.contains('mie-enabled')).toBe(false);
    expect(h.container.classList.contains('mie-cursor')).toBe(false);
    dblclick(header(h, 'A'));
    expect(layer()).toBeNull();
    expect(h.deps.toast).not.toHaveBeenCalled();
    expect(events(h, 'editor_inline_edit_unavailable')).toEqual([{ ...BASE_PROPS, inline_edit_unavailable_reason: 'no_map' }]);
    h.controller.destroy();
    const again = setup({ map: () => null });
    await again.render();
    expect(events(again, 'editor_inline_edit_unavailable')).toEqual([]);
  });

  it('a failing map request also counts as unavailable', async () => {
    const h = setup({ map: () => Promise.reject(new Error('parser')) });
    await h.render();
    expect(names(h)).toEqual(['editor_inline_edit_unavailable']);
  });

  it('a map whose code differs from the rendered string is never used', async () => {
    const h = setup({ map: (code) => fakeMap('something else' + code.length, { bNoAlias: false }) });
    await h.render();
    expect(h.container.classList.contains('mie-enabled')).toBe(false);
    dblclick(messageTexts(h, 0)[0]);
    expect(layer()).toBeNull();
    expect(h.deps.track).not.toHaveBeenCalled();
  });

  it('three-way check: a map for code B while the DOM still shows the render of code A stays inert', async () => {
    let resolveMap!: (m: SequenceSourceMap) => void;
    const h = setup({ map: () => new Promise((r) => { resolveMap = r; }) });
    h.controller.onRendered(CODE_A);
    await h.flush();
    h.store.code = CODE_B;
    h.controller.onCodeChanged(CODE_B);
    resolveMap(fakeMap(CODE_B, { bNoAlias: false }));
    await h.flush();
    expect(h.container.classList.contains('mie-enabled')).toBe(false);
    dblclick(messageTexts(h, 0)[0]);
    expect(layer()).toBeNull();
  });

  it('three-way check: a slow map for A that resolves after the render of B is dropped', async () => {
    const resolvers: Array<(m: SequenceSourceMap) => void> = [];
    const h = setup({ map: () => new Promise((r) => { resolvers.push(r); }) });
    h.controller.onRendered(CODE_A);
    await h.flush();
    h.store.code = CODE_B;
    h.controller.onCodeChanged(CODE_B);
    h.controller.onRendered(CODE_B);
    await h.flush();
    resolvers[0](fakeMap(CODE_A, { bNoAlias: false }));
    await h.flush();
    expect(h.container.classList.contains('mie-enabled')).toBe(false);
    resolvers[1](fakeMap(CODE_B, { bNoAlias: false }));
    await h.flush();
    expect(h.container.classList.contains('mie-enabled')).toBe(true);
  });

  it('render-parity gate: a label whose picture differs from its decoded source is inert (no layer, no event)', async () => {
    const h = setup();
    await h.render();
    header(h, 'A').querySelector('tspan')!.textContent = 'Tampered';
    dblclick(header(h, 'A').querySelector('text')!);
    expect(layer()).toBeNull();
    expect(h.deps.track).not.toHaveBeenCalled();
    expect(h.deps.toast).not.toHaveBeenCalled();
  });

  it('no source text for the target: toast and rejected position_mismatch, no layer', async () => {
    const h = setup();
    await h.render();
    h.deps.sourceTextOf.mockReturnValue(null);
    dblclick(messageTexts(h, 0)[0]);
    expect(layer()).toBeNull();
    expect(h.deps.toast).toHaveBeenCalledWith(REJECTION_MESSAGES.position_mismatch);
    expect(events(h, 'editor_inline_edit_rejected')).toEqual([{ ...BASE_PROPS, inline_edit_kind: 'message_text', inline_edit_rejection: 'position_mismatch' }]);
  });

  it('suspend (export capture) puts the stored picture back, closes the layer and removes both classes', async () => {
    const h = setup();
    await h.render();
    dblclick(messageTexts(h, 0)[0]);
    await type(h, 'Draft');
    expect(messageTexts(h, 0).map((e) => e.textContent)).toEqual(['Draft']);
    h.controller.setSuspended(true);
    await h.flush();
    expect(layer()).toBeNull();
    expect(messageTexts(h, 0).map((e) => e.textContent)).toEqual(['Hello', 'two lines']);
    expect(h.container.classList.contains('mie-enabled')).toBe(false);
    expect(h.container.classList.contains('mie-cursor')).toBe(false);
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    h.controller.setSuspended(false);
    expect(h.container.classList.contains('mie-enabled')).toBe(true);
  });

  it('destroy closes the layer, removes listeners, the hover box and both classes', async () => {
    const h = setup();
    await h.render();
    messageTexts(h, 0)[0].dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(hoverBox()).not.toBeNull();
    dblclick(messageTexts(h, 4)[0]);
    expect(layer()).not.toBeNull();
    h.controller.destroy();
    expect(layer()).toBeNull();
    expect(hoverBox()).toBeNull();
    expect(h.container.classList.contains('mie-enabled')).toBe(false);
    expect(h.container.classList.contains('mie-cursor')).toBe(false);
    expect(h.keeper()).toBeNull();
    dblclick(header(h, 'A'));
    expect(layer()).toBeNull();
    // The window key listener went with it.
    const seen = vi.fn();
    document.addEventListener('keydown', seen, true);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(seen).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', seen, true);
  });
});

describe('opening', () => {
  it('message: the layer holds the decoded lines, covers both SVG lines and holds the view', async () => {
    const h = setup();
    await h.render();
    dblclick(messageTexts(h, 0)[1]);
    expect(layer()!.textContent).toBe('Hello\ntwo lines');
    expect(layer()!.getAttribute('aria-label')).toBe('Edit message text');
    expect(hidden(h)).toEqual(messageTexts(h, 0));
    expect(h.viewport.holdView).toHaveBeenCalledWith(true);
    expect(h.keeper()).not.toBeNull();
    expect(h.container.classList.contains('mie-enabled')).toBe(false);
    expect(h.container.classList.contains('mie-cursor')).toBe(true);
    expect(events(h, 'editor_inline_edit_started')).toEqual([{ ...BASE_PROPS, inline_edit_kind: 'message_text' }]);
  });

  it('participant header with alias: prefill is the alias, had_alias true', async () => {
    const h = setup();
    await h.render();
    dblclick(header(h, 'A').querySelector('text')!);
    expect(layer()!.textContent).toBe('Alice');
    expect(hidden(h)).toEqual(Array.from(header(h, 'A').querySelectorAll('text')));
    expect(events(h, 'editor_inline_edit_started')).toEqual([{ ...BASE_PROPS, inline_edit_kind: 'participant_label', inline_edit_had_alias: true }]);
  });

  it('footer copy: the layer covers the footer; the header stays plain SVG', async () => {
    const h = setup();
    await h.render();
    dblclick(footer(h, 'B').querySelector('text')!);
    expect(layer()!.textContent).toBe('Bob');
    expect(hidden(h)).toEqual(Array.from(footer(h, 'B').querySelectorAll('text')));
  });

  it('places the layer centred on the SVG text, one line box tall, in the viewport element', async () => {
    const h = setup();
    await h.render();
    const text = header(h, 'A').querySelector('text')!;
    text.getBoundingClientRect = () => ({ left: 100, top: 50, right: 140, bottom: 70, width: 40, height: 20, x: 100, y: 50, toJSON() {} }) as DOMRect;
    dblclick(text);
    const st = layer()!.style;
    expect(layer()!.parentElement).toBe(h.viewport.$el);
    expect(st.left).toBe('120px');
    expect(st.top).toBe('50px');
    expect(st.lineHeight).toBe('20px');
    expect(st.transform).toBe('translateX(-50%)');
  });

  it('only one layer at a time', async () => {
    const h = setup();
    await h.render();
    dblclick(messageTexts(h, 0)[0]);
    dblclick(header(h, 'A'));
    expect(document.querySelectorAll('[data-testid="mermaid-inline-edit-layer"]').length).toBe(1);
    expect(layer()!.textContent).toBe('Hello\ntwo lines');
  });

  it('hover outlines all lines of a message; nothing while inert or editing; leaves on pointerleave and re-render', async () => {
    const h = setup();
    await h.render();
    messageTexts(h, 0)[1].dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(hoverBox()).not.toBeNull();
    h.container.dispatchEvent(new Event('pointerleave'));
    expect(hoverBox()).toBeNull();
    messageTexts(h, 0)[1].dispatchEvent(new Event('pointerover', { bubbles: true }));
    await h.render();
    expect(hoverBox()).toBeNull();
    h.controller.setSuspended(true);
    messageTexts(h, 0)[0].dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(hoverBox()).toBeNull();
  });
});

describe('typing: live preview from a fixed base', () => {
  it('renders the candidate from the base through renderPreview; store and analytics untouched', async () => {
    const h = setup();
    await h.render();
    dblclick(messageTexts(h, 0)[0]);
    h.deps.track.mockClear();
    await type(h, 'Hi\nthere');
    expect(h.deps.editMessageText).toHaveBeenLastCalledWith(CODE_A, expect.objectContaining({ code: CODE_A }), 0, 'Hi<br/>there');
    expect(h.host.renderPreview).toHaveBeenLastCalledWith(`${CODE_A}%msg 0=Hi<br/>there`);
    expect(messageTexts(h, 0).map((e) => e.textContent)).toEqual(['Hi', 'there']);
    expect(hidden(h)).toEqual(messageTexts(h, 0));
    await type(h, 'Hi');
    // Always from the base, never from the previous candidate.
    expect(h.deps.editMessageText).toHaveBeenLastCalledWith(CODE_A, expect.anything(), 0, 'Hi');
    expect(h.store.code).toBe(CODE_A);
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    expect(h.deps.track).not.toHaveBeenCalled();
    expect(layer()).not.toBeNull();
  });

  it('latest wins: inputs during an in-flight render collapse into one render of the newest text', async () => {
    const pending: Array<() => void> = [];
    const h = setup({ renderPreview: (_code, paint) => new Promise((r) => pending.push(() => { paint(); r(true); })) });
    await h.render();
    dblclick(messageTexts(h, 4)[0]);
    await type(h, 'a');
    await type(h, 'ab');
    await type(h, 'abc');
    expect(h.host.renderPreview.mock.calls.map(([c]) => c)).toEqual([`${CODE_A}%msg 4=a`]);
    pending.shift()!();
    await h.flush();
    expect(h.host.renderPreview.mock.calls.map(([c]) => c)).toEqual([`${CODE_A}%msg 4=a`, `${CODE_A}%msg 4=abc`]);
    pending.shift()!();
    await h.flush();
    expect(messageTexts(h, 4)[0].textContent).toBe('abc');
  });

  it('IME: no render while composing, one render at compositionend', async () => {
    const h = setup();
    await h.render();
    dblclick(messageTexts(h, 4)[0]);
    layer()!.dispatchEvent(new Event('compositionstart'));
    layer()!.textContent = 'Sameに';
    const composingInput = new Event('input', { bubbles: true }) as any;
    Object.defineProperty(composingInput, 'isComposing', { value: true });
    layer()!.dispatchEvent(composingInput);
    await h.flush();
    expect(h.host.renderPreview).not.toHaveBeenCalled();
    // Enter that confirms the composition must not commit.
    key(layer()!, 'Enter', { isComposing: true } as KeyboardEventInit);
    expect(layer()).not.toBeNull();
    layer()!.textContent = 'Same日本';
    layer()!.dispatchEvent(new Event('compositionend'));
    await h.flush();
    expect(h.host.renderPreview).toHaveBeenCalledTimes(1);
    expect(h.host.renderPreview).toHaveBeenLastCalledWith(`${CODE_A}%msg 4=Same日本`);
  });

  it('participant without alias: the id changes live and the layer follows it across renders', async () => {
    const h = setup({ bNoAlias: true });
    await h.render();
    dblclick(header(h, 'B').querySelector('text')!);
    expect(layer()!.textContent).toBe('B');
    await type(h, 'Bo');
    expect(header(h, 'Bo')).toBeDefined();
    expect(hidden(h)).toEqual(Array.from(header(h, 'Bo').querySelectorAll('text')));
    await type(h, 'Bob2');
    expect(h.deps.renameParticipant).toHaveBeenLastCalledWith(CODE_A, expect.anything(), 'B', 'Bob2');
    expect(hidden(h)).toEqual(Array.from(header(h, 'Bob2').querySelectorAll('text')));
    // Both copies show the new text; only the clicked copy is hidden.
    expect(footer(h, 'Bob2').textContent).toBe('Bob2');
    expect(footer(h, 'Bob2').querySelector('.mie-hidden')).toBeNull();
  });

  it('participant with alias: the id stays, the alias text changes', async () => {
    const h = setup();
    await h.render();
    dblclick(header(h, 'A').querySelector('text')!);
    await type(h, 'Alicia');
    expect(h.deps.renameParticipant).toHaveBeenLastCalledWith(CODE_A, expect.anything(), 'A', 'Alicia');
    expect(header(h, 'A').textContent).toBe('Alicia');
    expect(hidden(h)).toEqual(Array.from(header(h, 'A').querySelectorAll('text')));
  });

  it('typing and paste in the layer do not reach document listeners; pointer and wheel do not reach the viewport', async () => {
    const h = setup();
    await h.render();
    const seen = vi.fn();
    for (const t of ['keydown', 'keyup', 'keypress', 'paste', 'copy', 'cut']) document.addEventListener(t, seen, true);
    const viewportSeen = vi.fn();
    h.container.addEventListener('wheel', viewportSeen);
    h.container.addEventListener('mousedown', viewportSeen);
    dblclick(messageTexts(h, 0)[0]);
    layer()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    layer()!.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
    layer()!.dispatchEvent(new Event('paste', { bubbles: true }));
    layer()!.dispatchEvent(new Event('wheel', { bubbles: true }));
    layer()!.dispatchEvent(new Event('mousedown', { bubbles: true }));
    expect(seen).not.toHaveBeenCalled();
    expect(viewportSeen).not.toHaveBeenCalled();
    for (const t of ['keydown', 'keyup', 'keypress', 'paste', 'copy', 'cut']) document.removeEventListener(t, seen, true);
  });
});

describe('invalid text', () => {
  it('collision: red outline and hint, no render, no event; the last valid picture stays', async () => {
    const h = setup({ bNoAlias: true });
    await h.render();
    dblclick(header(h, 'B').querySelector('text')!);
    h.deps.track.mockClear();
    await type(h, 'A');
    expect(layer()!.classList.contains('mie-invalid')).toBe(true);
    expect(layer()!.getAttribute('aria-invalid')).toBe('true');
    expect(hint()!.textContent).toBe(REJECTION_MESSAGES.name_exists);
    expect(h.host.renderPreview).not.toHaveBeenCalled();
    expect(layer()!.textContent).toBe('A');
    expect(header(h, 'B')).toBeDefined();
    expect(h.deps.track).not.toHaveBeenCalled();
  });

  it('empty participant name: "empty" hint (not invalid_characters)', async () => {
    const h = setup({ bNoAlias: true });
    await h.render();
    dblclick(header(h, 'B').querySelector('text')!);
    await type(h, '');
    expect(hint()!.textContent).toBe(REJECTION_MESSAGES.empty);
  });

  // Chromium leaves a lone <br> in a contenteditable the user has emptied; it
  // is a placeholder, not a line break (found in the browser: an emptied
  // message was written as "<br/>").
  it('an emptied layer holding only the placeholder <br> reads as empty, not as a line break', async () => {
    const h = setup({ bNoAlias: true });
    await h.render();
    dblclick(header(h, 'B').querySelector('text')!);
    layer()!.innerHTML = '<br>';
    layer()!.dispatchEvent(new Event('input', { bubbles: true }));
    await h.flush();
    expect(hint()!.textContent).toBe(REJECTION_MESSAGES.empty);
  });

  it('an emptied message never commits as "<br/>"', async () => {
    const h = setup();
    await h.render();
    dblclick(messageTexts(h, 4)[0]);
    layer()!.innerHTML = '<br>';
    layer()!.dispatchEvent(new Event('input', { bubbles: true }));
    await h.flush();
    key(layer()!, 'Enter');
    for (const [written] of h.deps.writeCode.mock.calls) expect(written).not.toContain('%msg 4=<br/>');
    for (const call of h.deps.editMessageText.mock.calls) expect(call[3]).not.toContain('<br/>');
  });

  it.each([
    ['actor id with ;', true, 'B;'],
    ['alias with a control character', false, 'Bob\u0001'],
  ])('illegal characters (%s): invalid_characters hint, no edit call', async (_label, bNoAlias, text) => {
    const h = setup({ bNoAlias });
    await h.render();
    dblclick(header(h, 'B').querySelector('text')!);
    await type(h, text);
    expect(hint()!.textContent).toBe(REJECTION_MESSAGES.invalid_characters);
    expect(h.deps.renameParticipant).not.toHaveBeenCalled();
  });

  it('a throwing edit function is shown as position_mismatch, never silently', async () => {
    const h = setup();
    await h.render();
    h.deps.editMessageText.mockImplementation(() => { throw new Error('boom'); });
    dblclick(messageTexts(h, 0)[0]);
    await type(h, 'x');
    expect(hint()!.textContent).toBe(REJECTION_MESSAGES.position_mismatch);
  });

  it('back to valid text clears the red state and renders', async () => {
    const h = setup({ bNoAlias: true });
    await h.render();
    dblclick(header(h, 'B').querySelector('text')!);
    await type(h, 'A');
    await type(h, 'Al');
    expect(hint()).toBeNull();
    expect(layer()!.classList.contains('mie-invalid')).toBe(false);
    expect(h.host.renderPreview).toHaveBeenLastCalledWith(`${CODE_A}%rename B=Al`);
  });

  it('Enter while invalid stays in edit: no write, no event', async () => {
    const h = setup({ bNoAlias: true });
    await h.render();
    dblclick(header(h, 'B').querySelector('text')!);
    await type(h, 'A');
    h.deps.track.mockClear();
    key(layer()!, 'Enter');
    expect(layer()).not.toBeNull();
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    expect(h.deps.toast).not.toHaveBeenCalled();
    expect(h.deps.track).not.toHaveBeenCalled();
  });

  it('click-away while invalid: base restored, toast with the reason, one rejected event', async () => {
    const h = setup({ bNoAlias: true });
    await h.render();
    dblclick(header(h, 'B').querySelector('text')!);
    await type(h, 'Bx');
    await type(h, 'A');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await h.flush();
    expect(layer()).toBeNull();
    expect(hint()).toBeNull();
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    expect(h.deps.toast).toHaveBeenCalledWith(REJECTION_MESSAGES.name_exists);
    expect(h.host.renderPreview).toHaveBeenLastCalledWith(CODE_A);
    expect(header(h, 'B')).toBeDefined();
    expect(names(h)).toEqual(['editor_inline_edit_started', 'editor_inline_edit_rejected']);
    expect(events(h, 'editor_inline_edit_rejected')).toEqual([{
      ...BASE_PROPS, inline_edit_kind: 'participant_label', inline_edit_had_alias: false,
      inline_edit_rejection: 'name_exists', inline_edit_ms_open: 0,
    }]);
  });

  it('Esc while invalid: cancelled escape, base restored', async () => {
    const h = setup({ bNoAlias: true });
    await h.render();
    dblclick(header(h, 'B').querySelector('text')!);
    await type(h, 'A');
    key(layer()!, 'Escape');
    await h.flush();
    expect(layer()).toBeNull();
    expect(names(h)).toEqual(['editor_inline_edit_started', 'editor_inline_edit_cancelled']);
  });
});

describe('closing', () => {
  it('Enter commits once: one store write, succeeded; the layer stays until the commit render lands', async () => {
    const h = setup();
    await h.render();
    dblclick(header(h, 'A').querySelector('text')!);
    await type(h, 'Alicia');
    key(layer()!, 'Enter');
    const committed = `${CODE_A}%rename A=Alicia`;
    expect(h.deps.writeCode).toHaveBeenCalledTimes(1);
    expect(h.deps.writeCode).toHaveBeenCalledWith(committed);
    expect(names(h)).toEqual(['editor_inline_edit_started', 'editor_inline_edit_succeeded']);
    expect(events(h, 'editor_inline_edit_succeeded')).toEqual([{
      ...BASE_PROPS, inline_edit_kind: 'participant_label', inline_edit_had_alias: true, inline_edit_ms_open: 0,
    }]);
    // The picture already showed the final candidate: the layer goes at once.
    expect(layer()).toBeNull();
    expect(hidden(h)).toEqual([]);
    h.controller.onCodeChanged(committed);
    expect(h.viewport.holdView).not.toHaveBeenCalledWith(false);
    await h.render(committed);
    expect(h.viewport.holdView).toHaveBeenLastCalledWith(false);
    expect(h.keeper()).toBeNull();
    // The blur caused by closing does not commit again.
    expect(h.deps.writeCode).toHaveBeenCalledTimes(1);
  });

  it('commit before the candidate is drawn: the layer stays over the old picture until the commit render', async () => {
    const pending: Array<() => void> = [];
    const h = setup({ renderPreview: (_code, paint) => new Promise((r) => pending.push(() => { paint(); r(true); })) });
    await h.render();
    dblclick(messageTexts(h, 4)[0]);
    await type(h, 'New');
    key(layer()!, 'Enter');
    expect(layer()).not.toBeNull();
    expect(hidden(h).length).toBe(1);
    const committed = `${CODE_A}%msg 4=New`;
    h.controller.onCodeChanged(committed);
    await h.render(committed);
    expect(layer()).toBeNull();
    expect(hidden(h)).toEqual([]);
  });

  it('Shift+Enter in a message makes a second line; the commit writes <br/>', async () => {
    const h = setup();
    await h.render();
    dblclick(messageTexts(h, 4)[0]);
    const shiftEnter = key(layer()!, 'Enter', { shiftKey: true });
    expect(shiftEnter.defaultPrevented).toBe(false);
    expect(layer()).not.toBeNull();
    await type(h, 'Same\nmore');
    key(layer()!, 'Enter');
    expect(h.deps.writeCode).toHaveBeenCalledWith(`${CODE_A}%msg 4=Same<br/>more`);
  });

  it('Shift+Enter in an actor id is refused (no line break in an id)', async () => {
    const h = setup({ bNoAlias: true });
    await h.render();
    dblclick(header(h, 'B').querySelector('text')!);
    expect(key(layer()!, 'Enter', { shiftKey: true }).defaultPrevented).toBe(true);
  });

  it('click-away (pointerdown outside the layer) commits', async () => {
    const h = setup();
    await h.render();
    dblclick(messageTexts(h, 5)[0]);
    await type(h, 'Second');
    layer()!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(h.deps.writeCode).toHaveBeenCalledWith(`${CODE_A}%msg 5=Second`);
  });

  it('blur commits', async () => {
    const h = setup();
    await h.render();
    dblclick(messageTexts(h, 5)[0]);
    await type(h, 'Second');
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    // Switching window or tab (document lost focus): not a commit.
    layer()!.dispatchEvent(new Event('blur'));
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    focus.mockReturnValue(true);
    layer()!.dispatchEvent(new Event('blur'));
    expect(h.deps.writeCode).toHaveBeenCalledWith(`${CODE_A}%msg 5=Second`);
    focus.mockRestore();
  });

  it('Esc: no write, cancelled escape, base re-rendered; never reaches an editor-level Escape handler', async () => {
    const h = setup();
    await h.render();
    const documentEsc = vi.fn();
    document.addEventListener('keydown', documentEsc, true);
    try {
      dblclick(messageTexts(h, 0)[0]);
      await type(h, 'typed but cancelled');
      key(layer()!, 'Escape');
      await h.flush();
      expect(documentEsc).not.toHaveBeenCalled();
      expect(layer()).toBeNull();
      expect(h.deps.writeCode).not.toHaveBeenCalled();
      expect(h.host.renderPreview).toHaveBeenLastCalledWith(CODE_A);
      expect(messageTexts(h, 0).map((e) => e.textContent)).toEqual(['Hello', 'two lines']);
      expect(h.viewport.holdView).toHaveBeenLastCalledWith(false);
      expect(names(h)).toEqual(['editor_inline_edit_started', 'editor_inline_edit_cancelled']);
      expect(events(h, 'editor_inline_edit_cancelled')).toEqual([{
        ...BASE_PROPS, inline_edit_kind: 'message_text', inline_edit_cancel_reason: 'escape', inline_edit_ms_open: 0,
      }]);
    } finally {
      document.removeEventListener('keydown', documentEsc, true);
    }
  });

  it('unchanged text: no edit call, no write, cancelled unchanged', async () => {
    const h = setup();
    await h.render();
    dblclick(messageTexts(h, 0)[0]);
    key(layer()!, 'Enter');
    expect(h.deps.editMessageText).not.toHaveBeenCalled();
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    expect(names(h)).toEqual(['editor_inline_edit_started', 'editor_inline_edit_cancelled']);
    expect(events(h, 'editor_inline_edit_cancelled')[0]).toMatchObject({ inline_edit_cancel_reason: 'unchanged', inline_edit_ms_open: 0 });
  });

  it('typed and typed back: still unchanged', async () => {
    const h = setup();
    await h.render();
    dblclick(messageTexts(h, 4)[0]);
    await type(h, 'Other');
    await type(h, 'Same');
    key(layer()!, 'Enter');
    await h.flush();
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    expect(events(h, 'editor_inline_edit_cancelled')[0]).toMatchObject({ inline_edit_cancel_reason: 'unchanged' });
    expect(messageTexts(h, 4)[0].textContent).toBe('Same');
  });

  it('an edit that leaves the source unchanged (trimmed whitespace) writes nothing and is "unchanged"', async () => {
    const h = setup();
    await h.render();
    h.deps.editMessageText.mockImplementation((code: string): EditResult => ({ ok: true, code }));
    dblclick(messageTexts(h, 4)[0]);
    await type(h, 'Same ');
    key(layer()!, 'Enter');
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    expect(events(h, 'editor_inline_edit_cancelled')[0]).toMatchObject({ inline_edit_cancel_reason: 'unchanged' });
  });

  it('code changing while editing closes with the stale toast, one rejected event and no write', async () => {
    const h = setup();
    await h.render();
    dblclick(messageTexts(h, 0)[0]);
    await type(h, 'mine');
    h.store.code = CODE_B;
    h.controller.onCodeChanged(CODE_B);
    expect(layer()).toBeNull();
    expect(h.deps.toast).toHaveBeenCalledWith(REJECTION_MESSAGES.stale_source);
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    expect(names(h)).toEqual(['editor_inline_edit_started', 'editor_inline_edit_rejected']);
    expect(events(h, 'editor_inline_edit_rejected')[0]).toMatchObject({ inline_edit_rejection: 'stale_source', inline_edit_ms_open: 0 });
  });

  it('commit re-checks the store: code that moved on without a notification is stale', async () => {
    const h = setup();
    await h.render();
    dblclick(messageTexts(h, 0)[0]);
    await type(h, 'mine');
    h.store.code = CODE_B;
    key(layer()!, 'Enter');
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    expect(h.deps.toast).toHaveBeenCalledWith(REJECTION_MESSAGES.stale_source);
  });

  it('a real re-render of the same code closes the layer quietly', async () => {
    const h = setup();
    await h.render();
    dblclick(messageTexts(h, 0)[0]);
    await h.render();
    expect(layer()).toBeNull();
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    expect(h.deps.toast).not.toHaveBeenCalled();
    expect(names(h)).toEqual(['editor_inline_edit_started']);
  });

  it('the arrow cursor stays on from commit, through the commit render, until the next map arrives', async () => {
    let resolveMap: ((m: SequenceSourceMap) => void) | null = null;
    const h = setup({ map: (code) => (code === CODE_A ? fakeMap(code, { bNoAlias: false }) : new Promise((r) => { resolveMap = r; })) });
    await h.render();
    dblclick(messageTexts(h, 4)[0]);
    await type(h, 'New');
    key(layer()!, 'Enter');
    const committed = `${CODE_A}%msg 4=New`;
    h.controller.onCodeChanged(committed);
    expect(h.container.classList.contains('mie-cursor')).toBe(true);
    await h.render(committed);
    expect(h.container.classList.contains('mie-enabled')).toBe(false);
    expect(h.container.classList.contains('mie-cursor')).toBe(true);
    resolveMap!(fakeMap(committed, { bNoAlias: false }));
    await h.flush();
    expect(h.container.classList.contains('mie-enabled')).toBe(true);
    expect(h.container.classList.contains('mie-cursor')).toBe(true);
  });
});

describe('glyphColour', () => {
  const SVG = 'http://www.w3.org/2000/svg';
  function textWith(fills: { text: string; tspan?: string }): SVGTextElement {
    const svg = document.createElementNS(SVG, 'svg');
    const text = document.createElementNS(SVG, 'text');
    text.setAttribute('style', `fill: ${fills.text}`);
    if (fills.tspan) {
      const tspan = document.createElementNS(SVG, 'tspan');
      tspan.setAttribute('style', `fill: ${fills.tspan}`);
      tspan.textContent = 'Alice';
      text.appendChild(tspan);
    } else {
      text.textContent = 'Hi';
    }
    svg.appendChild(text);
    document.body.appendChild(svg);
    return text as SVGTextElement;
  }

  it('reads the <tspan> fill when the <text> fill differs (Mermaid participant label)', () => {
    expect(glyphColour(textWith({ text: 'rgb(238, 238, 238)', tspan: 'rgb(51, 51, 51)' }))).toBe('rgb(51, 51, 51)');
  });

  it('reads the <text> fill when there is no <tspan> (message text)', () => {
    expect(glyphColour(textWith({ text: 'rgb(10, 20, 30)' }))).toBe('rgb(10, 20, 30)');
  });

  it('falls back to color when fill is none', () => {
    const text = textWith({ text: 'none' });
    text.style.color = 'rgb(1, 2, 3)';
    expect(glyphColour(text)).toBe('rgb(1, 2, 3)');
  });
});

describe('analytics placement', () => {
  it('sends all five events at rate 1', () => {
    for (const name of [
      'editor_inline_edit_started', 'editor_inline_edit_succeeded', 'editor_inline_edit_rejected',
      'editor_inline_edit_cancelled', 'editor_inline_edit_unavailable',
    ]) {
      expect(sampleRateFor(name, Date.parse('2026-11-20T00:00:00Z'))).toBe(1);
    }
  });
});

describe('source selection discovery', () => {
  it('uses offsets for identical labels, follows zoom and redraw, and preserves source focus until inline edit', async () => {
    const code = CODE_A + '  A->>A: Same\n  A->>A: Same\n';
    const h = setup({
      code,
      map(source) {
        const map = fakeMap(source, { bNoAlias: false });
        const first = source.indexOf('Same');
        const last = source.lastIndexOf('Same');
        map.messages.set(4, { textRange: [first, first + 4] });
        map.messages.set(5, { textRange: [last, last + 4] });
        const reference = source.indexOf('A->>B');
        map.participants.get('A')!.idRanges.push([reference, reference + 1]);
        return map;
      },
    });
    const rectangle = (left: number, width = 20) => ({
      left, top: 0, right: left + width, bottom: 20, width, height: 20,
    }) as DOMRect;
    h.viewport.$el.getBoundingClientRect = () => ({ ...rectangle(0, 500), bottom: 500, height: 500 });
    const ring = () => h.container.querySelector<HTMLElement>('[data-testid="mermaid-source-selection-ring"]');
    const hint = () => h.container.querySelector('[data-testid="mermaid-source-selection-hint"]');
    const select = (source: string, from: number, to: number, typing = false, owner = h.container) =>
      window.dispatchEvent(new CustomEvent('mermaid-source-selection', { detail: { owner, code: source, from, to, typing } }));
    await h.render();
    messageTexts(h, 4)[0].getBoundingClientRect = () => rectangle(20);
    const second = messageTexts(h, 5)[0];
    let left = 120;
    second.getBoundingClientRect = () => rectangle(left);
    const from = code.lastIndexOf('Same');

    select(code, from, from, false, document.createElement('div'));
    expect(ring()).toBeNull();
    select(code, from, from);
    expect(ring()?.style.left).toBe('120px');
    expect(hint()).toBeNull();
    const reference = code.indexOf('A->>B');
    const participant = header(h, 'A').querySelector('text')!;
    participant.getBoundingClientRect = () => rectangle(60);
    select(code, reference + 1, reference + 1);
    expect(ring()?.style.left).toBe('60px');
    const first = code.indexOf('Same');
    select(code, first + 4, first + 4);
    expect(ring()?.style.left).toBe('20px');
    select(code, from, from + 4);
    expect(ring()?.style.left).toBe('120px');
    expect(hint()?.textContent).toBe('You can also double-click here to edit.');
    left = 160;
    second.setAttribute('transform', 'translate(40)');
    await h.flush();
    expect(ring()?.style.left).toBe('160px');

    const typed = code.slice(0, from) + 'Same!' + code.slice(from + 4);
    h.store.code = typed;
    select(typed, from + 5, from + 5, true);
    h.controller.onCodeChanged(typed);
    expect(ring()?.style.left).toBe('160px');
    expect(hint()).toBeNull();
    h.controller.onRenderFailed(typed);
    expect(ring()).toBeNull();

    h.store.code = code;
    h.controller.onCodeChanged(code);
    select(code, from, from + 4);
    await h.render();
    const after = messageTexts(h, 5)[0];
    after.getBoundingClientRect = () => rectangle(200);
    after.setAttribute('transform', 'translate(80)');
    await h.flush();
    expect(ring()?.style.left).toBe('200px');
    expect(h.deps.track.mock.calls.filter(([event]: [string]) => event === 'editor_source_selection_hint_shown'))
      .toEqual([['editor_source_selection_hint_shown', { ...BASE_PROPS, inline_edit_kind: 'message_text' }]]);

    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    after.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    after.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(layer()).not.toBeNull();
    expect(ring()).toBeNull();
    expect(hint()).toBeNull();
    h.controller.destroy();
  });

  it('waits for the exact source map and clears on scoped reset', async () => {
    let resolve!: (map: SequenceSourceMap) => void;
    const h = setup({ map: () => new Promise((done) => { resolve = done; }) });
    await h.render();
    const hasRing = () => !!h.container.querySelector('[data-testid="mermaid-source-selection-ring"]');
    const select = (code: string, from: number, to: number) => window.dispatchEvent(new CustomEvent('mermaid-source-selection', {
      detail: { owner: h.container, code, from, to, typing: false },
    }));
    select(CODE_A, 26, 31);
    expect(hasRing()).toBe(false);
    resolve(fakeMap(CODE_A, { bNoAlias: false }));
    await h.flush();
    expect(hasRing()).toBe(true);
    select(CODE_B, 26, 31);
    expect(hasRing()).toBe(false);
    select(CODE_A, 26, 31);
    expect(hasRing()).toBe(true);
    window.dispatchEvent(new CustomEvent('mermaid-source-selection', { detail: { owner: h.container, clear: true } }));
    expect(hasRing()).toBe(false);
    h.controller.destroy();
  });
});
