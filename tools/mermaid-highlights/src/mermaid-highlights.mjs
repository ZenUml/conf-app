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
  const groups = typeof diagram.db.getSubGraphs === 'function'
    ? diagram.db.getSubGraphs().map(g => ({id:g.id})) : [];
  return {type:diagram.type, nodes, edges, groups};
}

/** Attach to Mermaid's existing SVG. No layout, path or source text is regenerated.
 * The model supplies endpoint identity; never split Mermaid IDs on '_' or '-'. */
export function attachMermaidHighlights(svg, model, {status = null} = {}) {
  requireMountedFlowchart(svg, model);
  const drawnNodes = [...svg.querySelectorAll('g.node')].filter(n => n.id);
  const drawnGroups = [...svg.querySelectorAll('g.cluster')].filter(g => g.id);
  const drawnEdges = [...svg.querySelectorAll('path.flowchart-link')];
  const nodeIds = new Set(), edgeIds = new Set();
  const groupIds = new Set();
  const groupBindings = (model.groups || []).map(g => {
    if (typeof g.id !== 'string' || !g.id || groupIds.has(g.id)) throw Error('MERMAID_HIGHLIGHTS_GROUP_ID_INVALID');
    groupIds.add(g.id);
    const matches = drawnGroups.filter(el => el.id === g.id || el.id === `${svg.id}-${g.id}`);
    if (matches.length !== 1) throw Error(`MERMAID_HIGHLIGHTS_GROUP_BINDING_UNRESOLVED:${g.id}`);
    return {element:matches[0], id:g.id, kind:'group'};
  });
  const nodeBindings = model.nodes.filter(n => !groupIds.has(n.id)).map(n => {
    if (typeof n.id !== 'string' || !n.id || typeof n.domId !== 'string' || !n.domId || nodeIds.has(n.id)) throw Error('MERMAID_HIGHLIGHTS_NODE_ID_INVALID');
    nodeIds.add(n.id);
    const matches = drawnNodes.filter(el => el.id === n.domId || el.id === `${svg.id}-${n.domId}`);
    if (matches.length !== 1) throw Error(`MERMAID_HIGHLIGHTS_NODE_BINDING_UNRESOLVED:${n.id}`);
    return {element:matches[0], id:n.id, kind:'node'};
  });
  for (const group of groupBindings) {
    if (nodeIds.has(group.id)) throw Error('MERMAID_HIGHLIGHTS_GROUP_ID_COLLISION');
    nodeIds.add(group.id);
  }
  nodeBindings.push(...groupBindings);
  if (drawnNodes.length !== model.nodes.filter(n => !groupIds.has(n.id)).length || drawnGroups.length !== groupBindings.length) {
    throw Error('MERMAID_HIGHLIGHTS_INCOMPLETE_DRAWING');
  }
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
  return installValidatedBindings(svg, nodeBindings, edgeBindings, status);
}

export function requireMountedFlowchart(svg, model) {
  if (!svg || svg.localName !== 'svg' || svg.namespaceURI !== 'http://www.w3.org/2000/svg' ||
      !svg.isConnected) throw Error('MERMAID_HIGHLIGHTS_MOUNTED_SVG_REQUIRED');
  if (!model || !/^flowchart(?:-|$)/.test(model.type || '') ||
      !Array.isArray(model.nodes) || !Array.isArray(model.edges) || !Array.isArray(model.groups)) {
    throw Error('MERMAID_HIGHLIGHTS_MODEL_REQUIRED');
  }
}

/** A prepared drawing has its own path IDs. Bind by independently parsed
 * directed endpoint multiset, not by those producer-assigned IDs. Every drawn
 * node, group and connector must match; partial semantic overlays are unsafe. */
export function attachPreparedSvgHighlights(svg, model, {status = null} = {}) {
  requireMountedFlowchart(svg, model);
  const groupIds = new Set(), nodeIds = new Set(), edgeIds = new Set();
  const groupBindings = model.groups.map(group => {
    if (typeof group.id !== 'string' || !group.id || groupIds.has(group.id)) throw Error('MAGIC_HIGHLIGHTS_GROUP_ID_INVALID');
    groupIds.add(group.id);
    const matches = [...svg.querySelectorAll('g[data-group]')].filter(el => el.getAttribute('data-group') === group.id && el.getAttribute('data-node') === null);
    if (matches.length !== 1) throw Error(`MAGIC_HIGHLIGHTS_GROUP_BINDING_UNRESOLVED:${group.id}`);
    return {element:matches[0], id:group.id, kind:'group'};
  });
  const nodeBindings = model.nodes.filter(node => !groupIds.has(node.id)).map(node => {
    if (typeof node.id !== 'string' || !node.id || nodeIds.has(node.id)) throw Error('MAGIC_HIGHLIGHTS_NODE_ID_INVALID');
    nodeIds.add(node.id);
    const matches = [...svg.querySelectorAll('g[data-node]')].filter(el => el.getAttribute('data-node') === node.id && !el.hasAttribute('data-group'));
    if (matches.length !== 1) throw Error(`MAGIC_HIGHLIGHTS_NODE_BINDING_UNRESOLVED:${node.id}`);
    return {element:matches[0], id:node.id, kind:'node'};
  });
  for (const group of groupBindings) {
    if (nodeIds.has(group.id)) throw Error('MAGIC_HIGHLIGHTS_GROUP_ID_COLLISION');
    nodeIds.add(group.id);
  }
  nodeBindings.push(...groupBindings);
  const drawnNodes = [...svg.querySelectorAll('g[data-node]')];
  const drawnGroups = [...svg.querySelectorAll('g[data-group]')];
  if (drawnNodes.length !== nodeBindings.length - groupBindings.length || drawnGroups.length !== groupBindings.length) {
    throw Error('MAGIC_HIGHLIGHTS_INCOMPLETE_DRAWING');
  }
  const drawnEdges = [...svg.querySelectorAll('path[data-edge],path[data-source],path[data-target]')];
  if (drawnEdges.length !== model.edges.length) throw Error('MAGIC_HIGHLIGHTS_EDGE_COUNT_MISMATCH');
  const expected = new Map();
  for (const edge of model.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) throw Error('MAGIC_HIGHLIGHTS_SOURCE_ENDPOINT_INVALID');
    const key = JSON.stringify([edge.source, edge.target]);
    expected.set(key, (expected.get(key) || 0) + 1);
  }
  const edgeBindings = drawnEdges.map(element => {
    const id = element.getAttribute('data-edge'), source = element.getAttribute('data-source'), target = element.getAttribute('data-target');
    if (!id || !source || !target || edgeIds.has(id) || !nodeIds.has(source) || !nodeIds.has(target)) {
      throw Error('MAGIC_HIGHLIGHTS_EDGE_BINDING_INVALID');
    }
    edgeIds.add(id);
    const key = JSON.stringify([source, target]), remaining = expected.get(key) || 0;
    if (!remaining) throw Error('MAGIC_HIGHLIGHTS_EDGE_ENDPOINT_MISMATCH');
    expected.set(key, remaining - 1);
    return {element, id, source, target};
  });
  if ([...expected.values()].some(count => count !== 0)) throw Error('MAGIC_HIGHLIGHTS_EDGE_ENDPOINT_MISMATCH');
  if (new Set(nodeBindings.map(n => n.element)).size !== nodeBindings.length) throw Error('MAGIC_HIGHLIGHTS_AMBIGUOUS_BINDING');
  return installValidatedBindings(svg, nodeBindings, edgeBindings, status);
}

export function installValidatedBindings(svg, nodeBindings, edgeBindings, status) {
  // Validate the complete binding before changing the displayed diagram.
  const key = Symbol.for('mermaid-highlights.controller');
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
    for (const n of nodeBindings) {
      set(n.element, 'data-node', n.id);
      if (n.kind === 'group') set(n.element, 'data-group', n.id);
    }
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
