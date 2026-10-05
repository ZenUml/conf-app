import {installInteractiveSvg, INTERACTIVE_SVG_STYLE} from './interactive-runtime.mjs';

/** Snapshot the flowchart database before the next Mermaid render mutates shared state. */
export function readMermaidFlowchartModel(diagram) {
  if (!diagram || !/^flowchart(?:-|$)/.test(diagram.type || '') ||
      typeof diagram.db?.getVertices !== 'function' || typeof diagram.db?.getEdges !== 'function') {
    throw Error('MERMAID_HIGHLIGHTS_FLOWCHART_REQUIRED');
  }
  const vertices = diagram.db.getVertices();
  const nodes = [...(vertices instanceof Map ? vertices.values() : Object.values(vertices))]
    .map(n => ({id:n.id, domId:n.domId}));
  const edges = diagram.db.getEdges().filter(e => e.stroke !== 'invisible')
    .map(e => ({id:e.id, source:e.start, target:e.end}));
  return {type:diagram.type, nodes, edges};
}

/** Attach to Mermaid's existing SVG. No layout, path or source text is regenerated.
 * The model supplies endpoint identity; never split Mermaid IDs on '_' or '-'. */
export function attachMermaidHighlights(svg, model, {status = null} = {}) {
  if (!svg || svg.localName !== 'svg' || svg.namespaceURI !== 'http://www.w3.org/2000/svg' ||
      !svg.isConnected) throw Error('MERMAID_HIGHLIGHTS_MOUNTED_SVG_REQUIRED');
  if (!model || !/^flowchart(?:-|$)/.test(model.type || '') ||
      !Array.isArray(model.nodes) || !Array.isArray(model.edges)) throw Error('MERMAID_HIGHLIGHTS_MODEL_REQUIRED');
  const key = Symbol.for('mermaid-highlights.controller');
  const drawnNodes = [...svg.querySelectorAll('g.node')].filter(n => n.id);
  const drawnEdges = [...svg.querySelectorAll('path.flowchart-link')];
  const nodeIds = new Set(), edgeIds = new Set();
  const nodeBindings = model.nodes.map(n => {
    if (typeof n.id !== 'string' || !n.id || typeof n.domId !== 'string' || !n.domId || nodeIds.has(n.id)) throw Error('MERMAID_HIGHLIGHTS_NODE_ID_INVALID');
    nodeIds.add(n.id);
    const matches = drawnNodes.filter(el => el.id === n.domId || el.id === `${svg.id}-${n.domId}`);
    if (matches.length !== 1) throw Error(`MERMAID_HIGHLIGHTS_NODE_BINDING_UNRESOLVED:${n.id}`);
    return {element:matches[0], id:n.id};
  });
  const edgeBindings = model.edges.map(e => {
    if (typeof e.id !== 'string' || !e.id || edgeIds.has(e.id)) throw Error('MERMAID_HIGHLIGHTS_EDGE_ID_INVALID');
    edgeIds.add(e.id);
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) throw Error('MERMAID_HIGHLIGHTS_GROUP_ENDPOINT_UNSUPPORTED');
    const matches = drawnEdges.filter(el => el.getAttribute('data-id') === e.id || el.id === e.id || el.id === `${svg.id}-${e.id}`);
    if (matches.length !== 1) throw Error(`MERMAID_HIGHLIGHTS_EDGE_BINDING_UNRESOLVED:${e.id}`);
    return {element:matches[0], ...e};
  });
  if (new Set(nodeBindings.map(n=>n.element)).size!==nodeBindings.length ||
      new Set(edgeBindings.map(e=>e.element)).size!==edgeBindings.length) throw Error('MERMAID_HIGHLIGHTS_AMBIGUOUS_BINDING');
  // Validate the complete binding before changing the displayed diagram.
  svg[key]?.destroy();
  const changes = [];
  const set = (element, name, value) => {
    changes.push([element, name, element.getAttribute(name)]);
    element.setAttribute(name, value);
  };
  let runtime, style, destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    runtime?.destroy();
    style?.remove();
    for (const [element, name, previous] of changes.reverse()) {
      if (previous === null) element.removeAttribute(name); else element.setAttribute(name, previous);
    }
    if (svg[key] === controller) delete svg[key];
  };
  const controller = {reset:() => runtime?.reset(), destroy, nodeCount:nodeBindings.length, edgeCount:edgeBindings.length};
  try {
    for (const n of nodeBindings) set(n.element, 'data-node', n.id);
    for (const e of edgeBindings) {
      set(e.element, 'data-edge', e.id);
      set(e.element, 'data-source', e.source);
      set(e.element, 'data-target', e.target);
    }
    set(svg, 'data-mermaid-highlights', '');
    style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.setAttribute('data-mermaid-highlight-style', '');
    // Scope our presentation to opted-in SVG roots, leaving other diagrams alone.
    style.textContent = INTERACTIVE_SVG_STYLE.replace(/([^{}]+)\{([^{}]*)\}/g, (_, selectors, declaration) =>
      selectors.split(',').map(s => s.trim().startsWith('.focus-on')
        ? `svg[data-mermaid-highlights]${s.trim()}` : `svg[data-mermaid-highlights] ${s.trim()}`).join(',') + `{${declaration}}`);
    svg.append(style);
    runtime = installInteractiveSvg(svg, [], status);
    svg[key] = controller;
    return controller;
  } catch (error) { destroy(); throw error; }
}
