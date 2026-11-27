/** Test-only: checks a flowchart source map against every rule of the contract, using the official db. */
import { expect } from 'vitest';
import mermaid from 'mermaid';
import { flowDbTextOf } from '../codec/flowchartText';
import type { FlowchartSourceMap, Range } from '../types';
import { getFlowchartSourceMap } from './getFlowchartSourceMap';

export const slice = (code: string, [s, e]: Range) => code.slice(s, e);

/** The official db, parsed the way getFlowchartSourceMap (and render) parse. */
export async function officialFlowDb(code: string) {
  const { loadMermaid } = await import('@/utils/mermaid/loadMermaid');
  await loadMermaid();
  await mermaid.parse(code);
  const diagram: any = await mermaid.mermaidAPI.getDiagramFromText(code);
  return diagram.db;
}

const inside = ([s, e]: Range, [is, ie]: Range) => is <= s && e <= ie;

/** Checks every invariant of the contract against the official db and returns the map. */
export async function expectFlowMap(code: string): Promise<FlowchartSourceMap> {
  let reason = '';
  const map = await getFlowchartSourceMap(code, { onReject: (r) => (reason = r) });
  expect(map, `flowchart source map (${reason})`).not.toBeNull();
  const db = await officialFlowDb(code);
  const sanitize = (t: string) => db.sanitizeText(t);
  expect(map!.kind).toBe('flowchart');
  expect(map!.code).toBe(code);

  const vertices: any[] = [...db.getVertices().values()];
  expect([...map!.nodes.keys()]).toEqual(vertices.map((v) => v.id));
  for (const v of vertices) {
    const loc = map!.nodes.get(v.id)!;
    expect(loc.domId).toBe(v.domId);
    for (const range of loc.idRanges) expect(slice(code, range)).toBe(v.id);
    expect(loc.shape).toBe(v.type);
    expect(loc.quoted).toBe(v.labelType === 'string');
    if (loc.labelRange) {
      expect(flowDbTextOf(slice(code, loc.labelRange), sanitize)).toBe(v.text);
      expect(loc.innerRange).not.toBeNull();
      expect(inside(loc.labelRange, loc.innerRange!)).toBe(true);
      if (loc.quoted) expect([code[loc.innerRange![0]], code[loc.innerRange![1] - 1]]).toEqual(['"', '"']);
      expect(loc.insertAt).toBeNull();
      if (v.labelType === 'markdown') expect(loc.readOnly).toBe('markdown');
    } else {
      expect(loc.innerRange).toBeNull();
      if (loc.readOnly !== 'shape_data') {
        expect(v.text).toBe(v.id);
        if (loc.insertAt !== null) expect(code.slice(loc.insertAt - v.id.length, loc.insertAt)).toBe(v.id);
        else expect(loc.readOnly).toBe('unsupported');
      }
    }
  }

  const edges: any[] = db.getEdges();
  expect([...map!.edges.keys()]).toEqual(edges.map((e) => e.id));
  const rangeUse = new Map<string, number>();
  for (const loc of map!.edges.values()) if (loc.textRange) rangeUse.set(loc.textRange.join(':'), (rangeUse.get(loc.textRange.join(':')) ?? 0) + 1);
  for (const e of edges) {
    const loc = map!.edges.get(e.id)!;
    expect(loc.quoted).toBe(e.labelType === 'string');
    if (loc.textRange) {
      expect(flowDbTextOf(slice(code, loc.textRange), sanitize)).toBe(e.text);
      expect(inside(loc.textRange, loc.innerRange!)).toBe(true);
      if ((rangeUse.get(loc.textRange.join(':')) ?? 0) > 1) expect(loc.readOnly).toBe('shared_edge_label');
    } else {
      expect(e.text).toBe('');
      expect(loc.readOnly).toBe('no_label');
    }
  }
  return map!;
}
