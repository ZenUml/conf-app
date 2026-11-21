import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/mermaid/loadMermaid', async () => {
  const m = (await import('mermaid')).default;
  m.initialize({ startOnLoad: false, theme: 'neutral' });
  return { loadMermaid: async () => m };
});

import fixtureSvg from './__fixtures__/flowchart-11.17.2.svg?raw';
import fixtureCode from './__fixtures__/flowchart-11.17.2.mmd?raw';
import { attachInlineEdit, __resetInlineEditSessionForTests, SLOW_RENDER_DEBOUNCE_MS, type InlineEditDeps, type InlineEditHost } from './controller';
import {
  FLOWCHART_SLOW_RENDER_MS, createFlowchartAdapter, hitFlowchartLabel, locateEdgeLabel, locateNodeLabel, readHtmlLabel,
  type FlowchartEditApi,
} from './flowchartAdapter';
import { FLOWCHART_REJECTION_MESSAGES } from './copy';
import { getFlowchartSourceMap } from '../sourcemap/getFlowchartSourceMap';
import { editFlowEdgeLabel, editFlowNodeLabel, flowSourceTextOf, planFlowEdgeLabelEdit, planFlowNodeLabelEdit } from '../edit/flowchart';
import type { EditResult, FlowchartSourceMap } from '../types';

// Real Mermaid 11.17.2 output of __fixtures__/flowchart-11.17.2.mmd, svg id
// `fixture` (scripts/mermaid-seq-loc/render-svg-fixture.mjs):
//   A[Start] -->|yes| B(Round label)      B -- inline text --> C{Decide}
//   C --> D (bare id, unlabeled edge)     E["quoted #quot;label#quot;"] --> F[line one<br/>line two]
//   G & H -->|shared| C (shared label)    I["`**md** label`"] --> J[Linked] + click J
const CODE = fixtureCode.replace(/\n$/, '');
const PROPS = { feature_area: 'macro', surface: 'editor', macro_type: 'mermaid', inline_edit_diagram: 'flowchart' };
const NODE = { ...PROPS, inline_edit_kind: 'node_label' };
const EDGE = { ...PROPS, inline_edit_kind: 'edge_label' };

let map: FlowchartSourceMap;
beforeAll(async () => {
  map = (await getFlowchartSourceMap(CODE))!;
  expect(map, 'fixture must map').not.toBeNull();
});

let renders = 0;
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * Draws the fixture under a fresh svg id (Mermaid gives every render a new
 * one), with every label set to what `code` says, read through the real map.
 */
async function draw(content: HTMLElement, code: string): Promise<void> {
  const id = `mermaid-r${renders++}`;
  const m = code === CODE ? map : await getFlowchartSourceMap(code);
  content.innerHTML = fixtureSvg.replaceAll('fixture', id);
  const svg = content.querySelector('svg')!;
  if (!m) return;
  const set = (el: HTMLElement | null, text: string | null) => {
    if (el && text !== null) el.innerHTML = text.split('\n').map(escapeHtml).join('<br>');
  };
  for (const [nodeId, loc] of m.nodes) if (!loc.readOnly) set(locateNodeLabel(svg, loc.domId, nodeId), flowSourceTextOf(m, 'nodeLabel', nodeId));
  for (const [edgeId, loc] of m.edges) if (!loc.readOnly) set(locateEdgeLabel(svg, edgeId), flowSourceTextOf(m, 'edgeLabel', edgeId));
}

const realApi = (): FlowchartEditApi & Record<keyof FlowchartEditApi, ReturnType<typeof vi.fn>> => ({
  getSourceMap: vi.fn((code: string) => (code === CODE ? Promise.resolve(map) : getFlowchartSourceMap(code))),
  planNodeLabel: vi.fn(planFlowNodeLabelEdit),
  planEdgeLabel: vi.fn(planFlowEdgeLabelEdit),
  editNodeLabel: vi.fn((c: string, m: FlowchartSourceMap, id: string, t: string) => editFlowNodeLabel(c, m, id, t)),
  editEdgeLabel: vi.fn((c: string, m: FlowchartSourceMap, id: string, t: string) => editFlowEdgeLabel(c, m, id, t)),
  sourceTextOf: vi.fn(flowSourceTextOf),
}) as any;

interface Options {
  api?: Partial<FlowchartEditApi>;
  /** Simulated duration of each preview render (ms, on the fake clock). */
  renderMs?: number;
}

function setup(opts: Options = {}) {
  const store = { code: CODE };
  const container = document.createElement('div');
  container.innerHTML = '<div class="diagram-viewport"><div class="diagram-viewport-content"></div></div>';
  document.body.appendChild(container);
  const content = container.querySelector('.diagram-viewport-content') as HTMLElement;
  content.innerHTML = fixtureSvg;
  let keeper: ((code: string) => void) | null = null;
  let clock = 1000;
  const timers: Array<{ at: number; run: () => void; live: boolean }> = [];
  const viewport = {
    $el: container.querySelector('.diagram-viewport') as HTMLElement,
    holdView: vi.fn(), getRealZoom: () => 1, setRealZoom: vi.fn(), panByScreen: vi.fn(), flushView: () => undefined,
  };
  const host = {
    renderPreview: vi.fn(async (code: string) => {
      await draw(content, code);
      clock += opts.renderMs ?? 0;
      keeper?.(code);
      return true;
    }),
    setViewKeeper: vi.fn((fn: ((code: string) => void) | null) => { keeper = fn; }),
    viewport: () => viewport,
  };
  const api = { ...realApi(), ...opts.api };
  const deps = {
    getSourceMap: vi.fn(async () => null),
    renameParticipant: vi.fn(), editMessageText: vi.fn(), sourceTextOf: vi.fn(),
    flowchart: { load: vi.fn(async () => api) },
    getCode: () => store.code,
    writeCode: vi.fn((code: string) => { store.code = code; }),
    track: vi.fn(),
    toast: vi.fn(),
    now: () => clock,
    schedule: (run: () => void) => run(),
    setTimer: (run: () => void, ms: number) => { const t = { at: clock + ms, run, live: true }; timers.push(t); return t; },
    clearTimer: (t: unknown) => { (t as { live: boolean }).live = false; },
  };
  const controller = attachInlineEdit(container, deps as unknown as InlineEditDeps, host as unknown as InlineEditHost);
  const flush = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0)); };
  const render = async (code = store.code) => {
    await draw(content, code);
    keeper?.(code);
    controller.onRendered(code);
    await flush();
  };
  const advance = async (ms: number) => {
    clock += ms;
    for (const t of timers.filter((x) => x.live && x.at <= clock)) { t.live = false; t.run(); }
    await flush();
  };
  const svg = () => content.querySelector('svg') as SVGSVGElement;
  return { container, content, deps, host, api, store, controller, flush, render, advance, svg, timers };
}

type Harness = ReturnType<typeof setup>;
const layer = () => document.querySelector('[data-testid="mermaid-inline-edit-layer"]') as HTMLElement | null;
const hint = () => document.querySelector('[data-testid="mermaid-inline-edit-hint"]') as HTMLElement | null;
const hoverBox = () => document.querySelector('[data-testid="mermaid-inline-edit-hover"]');
const node = (h: Harness, id: string) => locateNodeLabel(h.svg(), map.nodes.get(id)!.domId, id)!;
const edge = (h: Harness, id: string) => locateEdgeLabel(h.svg(), id)!;
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
const events = (h: Harness, name: string) => h.deps.track.mock.calls.filter(([n]) => n === name).map(([, p]) => p);
const names = (h: Harness) => h.deps.track.mock.calls.map(([n]) => n);
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  __resetInlineEditSessionForTests();
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('flowchart DOM mapping on a real Mermaid 11.17.2 render', () => {
  const svgOf = (id = 'fixture') => {
    const div = document.createElement('div');
    div.innerHTML = fixtureSvg.replaceAll('fixture', id);
    document.body.appendChild(div);
    return div.querySelector('svg')!;
  };

  it('a node is keyed by its domId: the svg id prefix is stripped', () => {
    const svg = svgOf();
    const hit = hitFlowchartLabel(svg.querySelector('#fixture-flowchart-A-0 p')!, svg);
    expect(hit).toMatchObject({ kind: 'nodeLabel', key: 'flowchart-A-0' });
    expect(map.nodes.get('A')!.domId).toBe('flowchart-A-0');
    // Anywhere on the node shape, not only the text.
    expect(hitFlowchartLabel(svg.querySelector('#fixture-flowchart-B-1 path, #fixture-flowchart-B-1 rect')!, svg)).toMatchObject({ key: 'flowchart-B-1' });
  });

  it('an edge label is keyed by data-id, the db edge id', () => {
    const svg = svgOf();
    const label = locateEdgeLabel(svg, 'L_A_B_0')!;
    expect(readHtmlLabel(label)).toBe('yes');
    expect(hitFlowchartLabel(label, svg)).toMatchObject({ kind: 'edgeLabel', key: 'L_A_B_0' });
    expect(map.edges.has('L_A_B_0')).toBe(true);
  });

  it('an edge without text is not a target', () => {
    const svg = svgOf();
    const empty = svg.querySelector('g.edgeLabel g.label[data-id="L_C_D_0"]')!;
    expect(empty.firstElementChild!.getAttribute('width')).toBe('0');
    expect(hitFlowchartLabel(empty.querySelector('span')!, svg)).toBeNull();
    expect(map.edges.get('L_C_D_0')!.readOnly).toBe('no_label');
  });

  it('a <br/> label reads as two lines; a #quot; label as its character', () => {
    const svg = svgOf();
    expect(readHtmlLabel(locateNodeLabel(svg, map.nodes.get('F')!.domId, 'F')!)).toBe('line one\nline two');
    expect(readHtmlLabel(locateNodeLabel(svg, map.nodes.get('E')!.domId, 'E')!)).toBe('quoted "label"');
  });

  it('after a re-render with a new svg id the same node and edge are found again', () => {
    const svg = svgOf('mermaid-other-123');
    expect(readHtmlLabel(locateNodeLabel(svg, 'flowchart-B-1', 'B')!)).toBe('Round label');
    expect(readHtmlLabel(locateEdgeLabel(svg, 'L_B_C_0')!)).toBe('inline text');
    // A candidate render that numbered the vertex differently: found by id if unique.
    expect(readHtmlLabel(locateNodeLabel(svg, 'flowchart-B-99', 'B')!)).toBe('Round label');
    expect(locateNodeLabel(svg, 'flowchart-Z-0', 'Z')).toBeNull();
  });

  it('read-only reasons come from the map: markdown, shared edge label, linked node', async () => {
    const svg = svgOf();
    const adapter = createFlowchartAdapter({ load: async () => realApi() }, window);
    await adapter.getSourceMap(CODE);
    const begin = (el: Element) => adapter.begin(hitFlowchartLabel(el, svg)!, map, svg, CODE);
    expect(begin(svg.querySelector('#fixture-flowchart-I-11 p')!)).toEqual({ unavailable: 'markdown' });
    expect(begin(svg.querySelector('#fixture-flowchart-J-12 p')!)).toEqual({ unavailable: 'linked_node' });
    expect(begin(locateEdgeLabel(svg, 'L_G_C_0')!)).toEqual({ unavailable: 'shared_edge_label' });
    expect(begin(locateEdgeLabel(svg, 'L_H_C_0')!)).toEqual({ unavailable: 'shared_edge_label' });
  });

  it('a bare-id node opens with its id and plans `D[text]`; retyping the id is unchanged', async () => {
    const svg = svgOf();
    const adapter = createFlowchartAdapter({ load: async () => realApi() }, window);
    await adapter.getSourceMap(CODE);
    const r = adapter.begin(hitFlowchartLabel(svg.querySelector('#fixture-flowchart-D-5 p')!, svg)!, map, svg, CODE);
    if (!r || !('open' in r)) throw new Error('bare-id node must open');
    expect(r.open.prefill).toBe('D');
    expect(r.open.evaluate('D')).toEqual({ ok: true, code: CODE, key: 'D' });
    const planned = r.open.evaluate('Done');
    expect(planned.ok && planned.code).toBe(CODE.replace('C --> D', 'C --> D[Done]'));
  });

  it('render parity: a label whose picture differs from its source is inert', async () => {
    const svg = svgOf();
    const adapter = createFlowchartAdapter({ load: async () => realApi() }, window);
    await adapter.getSourceMap(CODE);
    const label = locateNodeLabel(svg, 'flowchart-A-0', 'A')!;
    label.textContent = 'Tampered';
    expect(adapter.begin(hitFlowchartLabel(label, svg)!, map, svg, CODE)).toBeNull();
  });
});

describe('flowchart in-place editing (controller)', () => {
  it('editable flowchart: cursor and hover on editable labels only; the parser loads on the first render', async () => {
    const h = setup();
    expect(h.deps.flowchart.load).not.toHaveBeenCalled();
    await h.render();
    expect(h.deps.flowchart.load).toHaveBeenCalledTimes(1);
    expect(h.deps.getSourceMap).not.toHaveBeenCalled();
    expect(h.container.classList.contains('mie-enabled')).toBe(true);
    expect(h.container.classList.contains('mie-cursor')).toBe(true);
    node(h, 'B').dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(hoverBox()).not.toBeNull();
    node(h, 'I').dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(hoverBox()).toBeNull();
    expect(h.deps.track).not.toHaveBeenCalled();
  });

  it('double-click a node: the layer opens with the decoded label over the hidden label', async () => {
    const h = setup();
    await h.render();
    dblclick(node(h, 'F'));
    expect(layer()!.textContent).toBe('line one\nline two');
    expect(layer()!.getAttribute('aria-label')).toBe('Edit node label');
    expect(layer()!.getAttribute('aria-multiline')).toBe('true');
    expect(node(h, 'F').classList.contains('mie-hidden')).toBe(true);
    expect(events(h, 'editor_inline_edit_started')).toEqual([NODE]);
  });

  it('a click on a linked node does not follow the link in the editor preview (a double-click must not navigate)', async () => {
    const h = setup();
    await h.render();
    const link = node(h, 'J').closest('a')!;
    expect(link).not.toBeNull();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
    node(h, 'J').dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    // Not a link: clicks are left alone.
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
    node(h, 'A').dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    h.controller.destroy();
    const after = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
    node(h, 'J').dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('the layer takes the label ink, not the transparent colour that hides the label', async () => {
    const style = document.createElement('style');
    style.textContent = 'p { color: rgb(1, 2, 3); } svg p.mie-hidden { color: transparent !important; }';
    document.head.appendChild(style);
    try {
      const h = setup();
      await h.render();
      dblclick(node(h, 'B'));
      expect(node(h, 'B').classList.contains('mie-hidden')).toBe(true);
      expect(layer()!.style.color).toBe('rgb(1, 2, 3)');
      expect(layer()!.style.caretColor).toBe('rgb(1, 2, 3)');
      await type(h, 'Rounder');
      expect(layer()!.style.color).toBe('rgb(1, 2, 3)');
    } finally {
      style.remove();
    }
  });

  it('typing renders the planned candidate from the base, re-finds the label under the new svg id, store untouched', async () => {
    const h = setup();
    await h.render();
    const firstId = h.svg().id;
    dblclick(node(h, 'B'));
    await type(h, 'Rounder');
    expect(h.api.planNodeLabel).toHaveBeenLastCalledWith(CODE, map, 'B', 'Rounder');
    expect(h.host.renderPreview).toHaveBeenLastCalledWith(CODE.replace('B(Round label)', 'B(Rounder)'));
    expect(h.svg().id).not.toBe(firstId);
    expect(readHtmlLabel(node(h, 'B'))).toBe('Rounder');
    expect(node(h, 'B').classList.contains('mie-hidden')).toBe(true);
    await type(h, 'Round');
    expect(h.api.planNodeLabel).toHaveBeenLastCalledWith(CODE, map, 'B', 'Round');
    expect(h.store.code).toBe(CODE);
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    expect(h.api.editNodeLabel).not.toHaveBeenCalled();
  });

  it('Enter: the async gate runs once; input is ignored while it runs; one write of the verified code', async () => {
    const gate = deferred<EditResult>();
    const editNodeLabel = vi.fn(() => gate.promise);
    const h = setup({ api: { editNodeLabel } });
    await h.render();
    dblclick(node(h, 'A'));
    await type(h, 'Begin');
    key(layer()!, 'Enter');
    expect(editNodeLabel).toHaveBeenCalledWith(CODE, map, 'A', 'Begin');
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    expect(layer()).not.toBeNull();
    expect(layer()!.getAttribute('aria-busy')).toBe('true');
    // Pending: keys and text input are refused, a second Enter or click-away does not commit again.
    const before = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: 'x' });
    layer()!.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    expect(key(layer()!, 'a').defaultPrevented).toBe(true);
    key(layer()!, 'Enter');
    key(layer()!, 'Escape');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(editNodeLabel).toHaveBeenCalledTimes(1);
    const verified = CODE.replace('A[Start]', 'A[Begin]');
    gate.resolve({ ok: true, code: verified });
    await h.flush();
    expect(h.deps.writeCode).toHaveBeenCalledTimes(1);
    expect(h.deps.writeCode).toHaveBeenCalledWith(verified);
    expect(names(h)).toEqual(['editor_inline_edit_started', 'editor_inline_edit_succeeded']);
    expect(events(h, 'editor_inline_edit_succeeded')).toEqual([{ ...NODE, inline_edit_ms_open: 0 }]);
    await h.render(verified);
    expect(layer()).toBeNull();
    expect(h.host.viewport().holdView).toHaveBeenLastCalledWith(false);
  });

  it('the real gate end to end: edge label edit writes the verified source', async () => {
    const h = setup();
    await h.render();
    dblclick(edge(h, 'L_A_B_0'));
    expect(layer()!.textContent).toBe('yes');
    expect(layer()!.getAttribute('aria-label')).toBe('Edit edge label');
    await type(h, 'no way');
    key(layer()!, 'Enter');
    await vi.waitFor(() => expect(h.deps.writeCode).toHaveBeenCalledTimes(1));
    expect(h.deps.writeCode).toHaveBeenCalledWith(CODE.replace('-->|yes|', '-->|no way|'));
    expect(events(h, 'editor_inline_edit_succeeded')).toEqual([{ ...EDGE, inline_edit_ms_open: 0 }]);
  });

  it('bare-id node: the commit inserts `[text]` after the id', async () => {
    const h = setup();
    await h.render();
    dblclick(node(h, 'D'));
    expect(layer()!.textContent).toBe('D');
    await type(h, 'Done');
    key(layer()!, 'Enter');
    await vi.waitFor(() => expect(h.deps.writeCode).toHaveBeenCalledTimes(1));
    expect(h.deps.writeCode).toHaveBeenCalledWith(CODE.replace('C --> D', 'C --> D[Done]'));
  });

  it('Shift+Enter makes a line break; the commit writes <br/>', async () => {
    const h = setup();
    await h.render();
    dblclick(node(h, 'A'));
    expect(key(layer()!, 'Enter', { shiftKey: true }).defaultPrevented).toBe(false);
    await type(h, 'Two\nlines');
    key(layer()!, 'Enter');
    await vi.waitFor(() => expect(h.deps.writeCode).toHaveBeenCalledTimes(1));
    expect(h.deps.writeCode).toHaveBeenCalledWith(CODE.replace('A[Start]', 'A[Two<br/>lines]'));
  });

  it('Esc: no gate, no write, the base picture comes back', async () => {
    const h = setup();
    await h.render();
    dblclick(node(h, 'B'));
    await type(h, 'Draft');
    key(layer()!, 'Escape');
    await h.flush();
    expect(layer()).toBeNull();
    expect(h.api.editNodeLabel).not.toHaveBeenCalled();
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    expect(h.host.renderPreview).toHaveBeenLastCalledWith(CODE);
    expect(readHtmlLabel(node(h, 'B'))).toBe('Round label');
    expect(events(h, 'editor_inline_edit_cancelled')).toEqual([{ ...NODE, inline_edit_cancel_reason: 'escape', inline_edit_ms_open: 0 }]);
  });

  it('Esc while a preview render is still running: the base picture comes back, not the draft', async () => {
    const h = setup();
    await h.render();
    dblclick(node(h, 'B'));
    // The preview render of the draft starts but has not drawn yet (a slow render,
    // or a background tab whose timers are throttled).
    // Like Mermaid.vue's renderPreview: the latest request wins, an overtaken one draws nothing.
    const gate = deferred<void>();
    const drawNow = h.host.renderPreview.getMockImplementation()!;
    let generation = 0;
    h.host.renderPreview.mockImplementation(async (code: string) => {
      const mine = ++generation;
      if (mine === 1) await gate.promise;
      if (mine !== generation) return false;
      return drawNow(code);
    });
    await type(h, 'Draft');
    expect(String(h.host.renderPreview.mock.lastCall?.[0])).toContain('Draft');
    key(layer()!, 'Escape');
    await h.flush();
    // The late draft render lands after the cancel.
    gate.resolve();
    await h.flush();
    expect(layer()).toBeNull();
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    expect(readHtmlLabel(node(h, 'B'))).toBe('Round label');
  });

  it('unchanged text: no gate, no write, cancelled unchanged', async () => {
    const h = setup();
    await h.render();
    dblclick(node(h, 'D'));
    key(layer()!, 'Enter');
    expect(h.api.editNodeLabel).not.toHaveBeenCalled();
    expect(events(h, 'editor_inline_edit_cancelled')).toEqual([{ ...NODE, inline_edit_cancel_reason: 'unchanged', inline_edit_ms_open: 0 }]);
  });

  it('empty edge label: "A label can\'t be empty." hint, Enter keeps editing, no gate', async () => {
    const h = setup();
    await h.render();
    dblclick(edge(h, 'L_B_C_0'));
    await type(h, '');
    expect(hint()!.textContent).toBe(FLOWCHART_REJECTION_MESSAGES.empty);
    key(layer()!, 'Enter');
    expect(layer()).not.toBeNull();
    expect(h.api.editEdgeLabel).not.toHaveBeenCalled();
  });

  it('gate says empty or invalid_characters: hint, the layer stays open, no write, no event', async () => {
    const h = setup({ api: { editNodeLabel: vi.fn(async () => ({ ok: false as const, reason: 'invalid_characters' as const })) } });
    await h.render();
    dblclick(node(h, 'A'));
    await type(h, 'Begin');
    key(layer()!, 'Enter');
    await h.flush();
    expect(layer()).not.toBeNull();
    expect(layer()!.getAttribute('aria-busy')).toBeNull();
    expect(hint()!.textContent).toBe(FLOWCHART_REJECTION_MESSAGES.invalid_characters);
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    expect(names(h)).toEqual(['editor_inline_edit_started']);
  });

  it.each([
    ['position_mismatch', (async () => ({ ok: false as const, reason: 'position_mismatch' as const }))],
    ['a rejected promise (as position_mismatch)', (async () => { throw new Error('gate'); })],
  ])('gate rejection %s: toast, rejected event, layer closes and the base comes back', async (_label, impl) => {
    const h = setup({ api: { editNodeLabel: vi.fn(impl) as any } });
    await h.render();
    dblclick(node(h, 'A'));
    await type(h, 'Begin');
    key(layer()!, 'Enter');
    await h.flush();
    expect(layer()).toBeNull();
    expect(h.deps.toast).toHaveBeenCalledWith(FLOWCHART_REJECTION_MESSAGES.position_mismatch);
    expect(events(h, 'editor_inline_edit_rejected')).toEqual([{ ...NODE, inline_edit_rejection: 'position_mismatch', inline_edit_ms_open: 0 }]);
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    expect(h.host.renderPreview).toHaveBeenLastCalledWith(CODE);
  });

  it('the source changes while the gate runs: stale toast, no write', async () => {
    const gate = deferred<EditResult>();
    const h = setup({ api: { editNodeLabel: vi.fn(() => gate.promise) } });
    await h.render();
    dblclick(node(h, 'A'));
    await type(h, 'Begin');
    key(layer()!, 'Enter');
    h.store.code = `${CODE}\n  Z --> A`;
    gate.resolve({ ok: true, code: CODE.replace('A[Start]', 'A[Begin]') });
    await h.flush();
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    expect(h.deps.toast).toHaveBeenCalledWith(FLOWCHART_REJECTION_MESSAGES.stale_source);
    expect(events(h, 'editor_inline_edit_rejected')).toEqual([{ ...NODE, inline_edit_rejection: 'stale_source', inline_edit_ms_open: 0 }]);
    expect(layer()).toBeNull();
  });

  it('a code-panel change while the gate runs closes the layer; the late result is dropped', async () => {
    const gate = deferred<EditResult>();
    const h = setup({ api: { editNodeLabel: vi.fn(() => gate.promise) } });
    await h.render();
    dblclick(node(h, 'A'));
    await type(h, 'Begin');
    key(layer()!, 'Enter');
    const moved = `${CODE}\n  Z --> A`;
    h.store.code = moved;
    h.controller.onCodeChanged(moved);
    expect(layer()).toBeNull();
    gate.resolve({ ok: true, code: CODE.replace('A[Start]', 'A[Begin]') });
    await h.flush();
    expect(h.deps.writeCode).not.toHaveBeenCalled();
    expect(names(h)).toEqual(['editor_inline_edit_started', 'editor_inline_edit_rejected']);
  });

  describe('slow-render guard', () => {
    it(`renders under ${FLOWCHART_SLOW_RENDER_MS} ms: every coalesced input renders at once`, async () => {
      const h = setup({ renderMs: FLOWCHART_SLOW_RENDER_MS });
      await h.render();
      dblclick(node(h, 'B'));
      await type(h, 'a');
      await type(h, 'ab');
      expect(h.host.renderPreview).toHaveBeenCalledTimes(2);
    });

    it(`after a render over ${FLOWCHART_SLOW_RENDER_MS} ms: wait ${SLOW_RENDER_DEBOUNCE_MS} ms after the last keystroke`, async () => {
      const h = setup({ renderMs: 200 });
      await h.render();
      dblclick(node(h, 'B'));
      await type(h, 'a');
      expect(h.host.renderPreview).toHaveBeenCalledTimes(1);
      await type(h, 'ab');
      await h.advance(100);
      await type(h, 'abc');
      await h.advance(SLOW_RENDER_DEBOUNCE_MS - 1);
      expect(h.host.renderPreview).toHaveBeenCalledTimes(1);
      await h.advance(1);
      expect(h.host.renderPreview).toHaveBeenCalledTimes(2);
      expect(h.host.renderPreview).toHaveBeenLastCalledWith(CODE.replace('B(Round label)', 'B(abc)'));
      // The layer keeps the typed text throughout.
      expect(layer()!.textContent).toBe('abc');
    });

    it('Enter while a debounced render waits: no preview render after the commit', async () => {
      const gate = deferred<EditResult>();
      const h = setup({ renderMs: 200, api: { editNodeLabel: vi.fn(() => gate.promise) } });
      await h.render();
      dblclick(node(h, 'B'));
      await type(h, 'a');
      await type(h, 'ab');
      key(layer()!, 'Enter');
      await h.advance(1000);
      expect(h.host.renderPreview).toHaveBeenCalledTimes(1);
      const verified = CODE.replace('B(Round label)', 'B(ab)');
      gate.resolve({ ok: true, code: verified });
      await h.flush();
      await h.advance(1000);
      expect(h.host.renderPreview).toHaveBeenCalledTimes(1);
      expect(h.deps.writeCode).toHaveBeenCalledWith(verified);
    });
  });

  describe('read-only and unavailable', () => {
    it('a read-only label: no layer, no toast; unavailable once per reason, on the double-click', async () => {
      const h = setup();
      await h.render();
      expect(h.deps.track).not.toHaveBeenCalled();
      dblclick(node(h, 'I'));
      dblclick(node(h, 'I'));
      dblclick(edge(h, 'L_G_C_0'));
      dblclick(node(h, 'J'));
      expect(layer()).toBeNull();
      expect(h.deps.toast).not.toHaveBeenCalled();
      expect(events(h, 'editor_inline_edit_unavailable')).toEqual([
        { ...PROPS, inline_edit_unavailable_reason: 'markdown' },
        { ...PROPS, inline_edit_unavailable_reason: 'shared_edge_label' },
        { ...PROPS, inline_edit_unavailable_reason: 'linked_node' },
      ]);
    });

    it('no map: inert, nothing on render; unavailable no_map once, on a double-click of a label', async () => {
      const h = setup({ api: { getSourceMap: vi.fn(async () => null) } });
      await h.render();
      await h.render();
      expect(h.container.classList.contains('mie-enabled')).toBe(false);
      expect(h.container.classList.contains('mie-cursor')).toBe(false);
      expect(h.deps.track).not.toHaveBeenCalled();
      dblclick(h.svg());
      expect(h.deps.track).not.toHaveBeenCalled();
      dblclick(node(h, 'A'));
      dblclick(edge(h, 'L_A_B_0'));
      expect(layer()).toBeNull();
      expect(events(h, 'editor_inline_edit_unavailable')).toEqual([{ ...PROPS, inline_edit_unavailable_reason: 'no_map' }]);
    });

    it('no flowchart deps: a flowchart stays inert (no load, no cursor)', async () => {
      const h = setup();
      const container = document.createElement('div');
      container.innerHTML = `<div class="diagram-viewport"><div class="diagram-viewport-content">${fixtureSvg}</div></div>`;
      document.body.appendChild(container);
      const rest = { ...h.deps } as any;
      delete rest.flowchart;
      const c = attachInlineEdit(container, rest as InlineEditDeps, h.host as unknown as InlineEditHost);
      c.onRendered(CODE);
      await h.flush();
      expect(container.classList.contains('mie-cursor')).toBe(false);
      expect(rest.getSourceMap).not.toHaveBeenCalled();
    });
  });

  it('analytics never carry label text, ids or indexes', async () => {
    const h = setup();
    await h.render();
    dblclick(node(h, 'A'));
    await type(h, 'Secret words');
    key(layer()!, 'Enter');
    await vi.waitFor(() => expect(h.deps.writeCode).toHaveBeenCalled());
    const sent = JSON.stringify(h.deps.track.mock.calls);
    for (const leak of ['Secret', 'Start', '"A"', 'flowchart-A', 'L_A_B']) expect(sent).not.toContain(leak);
  });
});
