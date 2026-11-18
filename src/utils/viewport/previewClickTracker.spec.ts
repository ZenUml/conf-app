import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifyPreviewTarget, createPreviewClickTracker } from './previewClickTracker';

const MERMAID_FLOWCHART = `
<div id="toolbar"><button type="button" aria-label="Zoom in">+</button></div>
<svg id="mermaid-1">
  <g class="cluster" id="mermaid-1-Core"><rect id="cluster-rect"></rect></g>
  <g class="node" id="flowchart-A-0"><rect id="node-rect"></rect><g class="label"><text id="node-text">A</text></g></g>
  <path class="flowchart-link" id="edge-path"></path>
  <g class="edgeLabel"><text id="edge-text">yes</text></g>
  <text id="free-text">title</text>
</svg>`;

const PLANTUML = `
<svg>
  <g class="entity" data-entity="Alice" data-source-line="2" id="entity_Alice"><rect id="pu-node"></rect></g>
  <g class="link" id="link_Alice_Bob"><path id="pu-edge"></path></g>
</svg>`;

// Trimmed from the in-browser PlantUML engine (1.2026.9beta4) in Storybook,
// story Editor/Diagram/WorkspacePreviewClick / PlantUmlSequence.
const PLANTUML_LOCAL_SEQUENCE = `
<svg viewBox="0 0 152 159" data-diagram-type="SEQUENCE"><defs></defs><g font-family="sans-serif">
  <g><title>Alice</title><rect id="lifeline-hit" x="30" y="41" width="8" height="76" fill-opacity="0"></rect><line id="lifeline" x1="33" y1="41" x2="33" y2="117"></line></g>
  <rect id="participant" x="10" y="10" width="47" height="30" fill="#E2E2F0"></rect><text id="participant-text" x="17" y="29">Alice</text>
  <polygon id="arrowhead" points="109,67,119,71,109,75,113,71"></polygon><line id="message" x1="33" y1="71" x2="115" y2="71"></line>
  <rect id="backdrop" x="0" y="0" width="152" height="159"></rect>
</g></svg>`;

// Trimmed from Mermaid 11 in Storybook (WorkspacePreviewClick / MermaidFlowchart
// and MermaidEr): labels are HTML inside <foreignObject>.
const MERMAID_REAL = `
<svg id="mermaid-9">
  <g class="cluster" id="mermaid-9-Core"><rect id="m-cluster"></rect><g class="cluster-label"><foreignObject><div id="m-cluster-label">Core</div></foreignObject></g></g>
  <g class="node default" id="mermaid-9-flowchart-A-0"><rect id="m-node" class="basic label-container"></rect><g class="label"><foreignObject><div><span id="m-node-label">Order API</span></div></foreignObject></g></g>
  <g class="edgePaths"><path id="m-link" class="flowchart-link"></path><path id="m-er-line" class="relationshipLine"></path></g>
  <g class="edgeLabels"><g class="edgeLabel"><foreignObject><div><span id="m-edge-label">POST</span></div></foreignObject></g></g>
  <g class="node default" id="mermaid-9-entity-ORDER-1"><path id="m-entity"></path></g>
</svg>`;

function press(el: Element, x: number, y: number, upX = x, upY = y) {
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
  el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: upX, clientY: upY }));
}

describe('classifyPreviewTarget', () => {
  it('names Mermaid nodes, subgraphs, edges, labels and background', () => {
    const root = document.createElement('div');
    root.innerHTML = MERMAID_FLOWCHART;
    const q = (id: string) => root.querySelector(`#${id}`)!;
    expect(classifyPreviewTarget(q('node-rect'), root)).toBe('node');
    expect(classifyPreviewTarget(q('node-text'), root)).toBe('node');
    expect(classifyPreviewTarget(q('cluster-rect'), root)).toBe('cluster');
    expect(classifyPreviewTarget(q('edge-path'), root)).toBe('edge');
    expect(classifyPreviewTarget(q('edge-text'), root)).toBe('edge');
    expect(classifyPreviewTarget(q('free-text'), root)).toBe('label');
    expect(classifyPreviewTarget(q('mermaid-1'), root)).toBe('background');
  });

  it('names PlantUML entities and links', () => {
    const root = document.createElement('div');
    root.innerHTML = PLANTUML;
    expect(classifyPreviewTarget(root.querySelector('#pu-node')!, root)).toBe('node');
    expect(classifyPreviewTarget(root.querySelector('#pu-edge')!, root)).toBe('edge');
  });

  it('names elements of real Mermaid 11 output, labels inside foreignObject included', () => {
    const root = document.createElement('div');
    root.innerHTML = MERMAID_REAL;
    const kind = (id: string) => classifyPreviewTarget(root.querySelector(`#${id}`)!, root);
    expect(kind('m-node')).toBe('node');
    expect(kind('m-node-label')).toBe('node');
    expect(kind('m-cluster')).toBe('cluster');
    expect(kind('m-cluster-label')).toBe('cluster');
    expect(kind('m-link')).toBe('edge');
    expect(kind('m-er-line')).toBe('edge');
    expect(kind('m-edge-label')).toBe('edge');
    expect(kind('m-entity')).toBe('node');
    expect(kind('mermaid-9')).toBe('background');
  });

  it('names elements of the flat SVG the in-browser PlantUML engine draws', () => {
    const root = document.createElement('div');
    root.innerHTML = PLANTUML_LOCAL_SEQUENCE;
    const kind = (id: string) => classifyPreviewTarget(root.querySelector(`#${id}`)!, root);
    expect(kind('participant')).toBe('node');
    expect(kind('participant-text')).toBe('label');
    expect(kind('lifeline')).toBe('node');
    expect(kind('lifeline-hit')).toBe('node');
    expect(kind('message')).toBe('edge');
    expect(kind('arrowhead')).toBe('edge');
    expect(kind('backdrop')).toBe('background');
    expect(classifyPreviewTarget(root.querySelector('svg')!, root)).toBe('background');
  });

  it('ignores anything outside the diagram svg, such as toolbar buttons', () => {
    const root = document.createElement('div');
    root.innerHTML = MERMAID_FLOWCHART;
    expect(classifyPreviewTarget(root.querySelector('button')!, root)).toBeNull();
  });
});

describe('createPreviewClickTracker', () => {
  let preview: HTMLElement;
  let source: HTMLElement;
  let track: ReturnType<typeof vi.fn>;
  let macroType: string;
  let codeHidden: boolean;
  let clock: number;

  const q = (id: string) => preview.querySelector(`#${id}`)!;
  const make = () =>
    createPreviewClickTracker({
      preview,
      source,
      macroType: () => macroType,
      codePanelHidden: () => codeHidden,
      track,
      now: () => clock,
    });

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    preview = document.createElement('div');
    preview.innerHTML = MERMAID_FLOWCHART;
    source = document.createElement('div');
    source.innerHTML = '<textarea id="code"></textarea>';
    document.body.appendChild(source);
    document.body.appendChild(preview);
    track = vi.fn();
    macroType = 'mermaid';
    codeHidden = false;
    clock = 1_000;
  });
  afterEach(() => vi.useRealTimers());

  it('sends one event 10 s after the first node click, with what followed', () => {
    const tracker = make();
    clock = 4_000;
    press(q('node-rect'), 10, 10);
    q('node-rect').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    press(q('node-rect'), 10, 10);
    source.querySelector('#code')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    tracker.notifySourceChanged();
    expect(track).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track.mock.calls[0][0]).toEqual({
      macro_type: 'mermaid',
      preview_target_kind: 'node',
      preview_zoomed_in_before: false,
      preview_code_panel_hidden: false,
      preview_drag_count_before: 0,
      preview_background_click_count_before: 0,
      preview_click_count_in_window: 2,
      preview_double_click_count_in_window: 1,
      preview_source_focused_in_window: true,
      preview_source_changed_in_window: true,
      preview_window_completed: true,
      preview_ms_since_editor_open: 3_000,
    });

    press(q('node-rect'), 10, 10);
    vi.advanceTimersByTime(20_000);
    expect(track).toHaveBeenCalledTimes(1);
    tracker.dispose();
  });

  it('counts a press that moved more than 4 px as a pan drag, not a click', () => {
    const tracker = make();
    press(q('node-rect'), 10, 10, 30, 10);
    press(q('mermaid-1'), 10, 10);
    vi.advanceTimersByTime(60_000);
    expect(track).not.toHaveBeenCalled();

    q('toolbar').querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    codeHidden = true;
    press(q('cluster-rect'), 10, 10, 12, 13);
    vi.advanceTimersByTime(10_000);
    expect(track.mock.calls[0][0]).toMatchObject({
      preview_target_kind: 'cluster',
      preview_zoomed_in_before: true,
      preview_code_panel_hidden: true,
      preview_drag_count_before: 1,
      preview_background_click_count_before: 1,
      preview_click_count_in_window: 1,
      preview_source_focused_in_window: false,
      preview_source_changed_in_window: false,
    });
    tracker.dispose();
  });

  it('treats a Ctrl/Cmd wheel toward the user as a zoom in', () => {
    const tracker = make();
    preview.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100, ctrlKey: true }));
    press(q('node-rect'), 10, 10);
    vi.advanceTimersByTime(10_000);
    expect(track.mock.calls[0][0]).toMatchObject({ preview_zoomed_in_before: true });
    tracker.dispose();
  });

  it('sends the open window early when the editor closes', () => {
    const tracker = make();
    press(q('edge-path'), 10, 10);
    tracker.dispose();
    expect(track).toHaveBeenCalledTimes(1);
    expect(track.mock.calls[0][0]).toMatchObject({
      preview_target_kind: 'edge',
      preview_window_completed: false,
    });
    vi.advanceTimersByTime(10_000);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('sends nothing for diagram types outside Mermaid and PlantUML', () => {
    macroType = 'sequence';
    const tracker = make();
    press(q('node-rect'), 10, 10);
    vi.advanceTimersByTime(10_000);
    tracker.dispose();
    expect(track).not.toHaveBeenCalled();
  });

  it('stops listening after dispose', () => {
    const tracker = make();
    tracker.dispose();
    press(q('node-rect'), 10, 10);
    vi.advanceTimersByTime(10_000);
    expect(track).not.toHaveBeenCalled();
  });
});
