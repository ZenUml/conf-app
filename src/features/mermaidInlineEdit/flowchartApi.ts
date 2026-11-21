/**
 * The flowchart half of the wiring, loaded by index.ts with a dynamic import
 * on the first flowchart render in the editor. It pulls in the flowchart edit
 * functions and the source map; the generated parser is a further chunk that
 * getFlowchartSourceMap imports on its first call.
 */
import { editFlowEdgeLabel, editFlowNodeLabel, flowSourceTextOf, planFlowEdgeLabelEdit, planFlowNodeLabelEdit } from './edit/flowchart';
import { getFlowchartSourceMap } from './sourcemap/getFlowchartSourceMap';
import type { FlowchartEditApi } from './ui/flowchartAdapter';

export const flowchartEditApi: FlowchartEditApi = {
  // getFlowchartSourceMap and the edit gate queue their own Mermaid work
  // (enqueueMermaid); never call them from inside the queue.
  getSourceMap: (code) => getFlowchartSourceMap(code),
  planNodeLabel: planFlowNodeLabelEdit,
  planEdgeLabel: planFlowEdgeLabelEdit,
  editNodeLabel: (code, map, id, text) => editFlowNodeLabel(code, map, id, text),
  editEdgeLabel: (code, map, id, text) => editFlowEdgeLabel(code, map, id, text),
  sourceTextOf: flowSourceTextOf,
};
