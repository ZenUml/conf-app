import type { GetFlowchartSourceMap, GetSequenceSourceMap, GetSourceMap } from '../types';
import { getFlowchartSourceMap } from './getFlowchartSourceMap';
import { getSourceMap } from './getSourceMap';
import { toParserInput } from './preprocess';

// Compile-time checks: the implementations satisfy the contract's seams.
// Each also takes an optional `{ onReject }` for diagnostics.
const sequenceContract: GetSequenceSourceMap = getSourceMap;
const flowchartContract: GetFlowchartSourceMap = getFlowchartSourceMap;
void sequenceContract;
void flowchartContract;

/**
 * Dispatches on the diagram header after Mermaid's own preprocessing (front
 * matter, directives and comments removed), the text Mermaid's detectors
 * read. The chosen parser checks the official diagram type again, so a wrong
 * guess here only costs a null. Loads only the parser chunk it needs.
 */
export const getDiagramSourceMap: GetSourceMap = async (code) => {
  const header = toParserInput(code).text;
  if (/^\s*sequenceDiagram/.test(header)) return getSourceMap(code);
  if (/^\s*(?:graph|flowchart)(?![\w-])/.test(header)) return getFlowchartSourceMap(code);
  return null;
};

export { getFlowchartSourceMap, getSourceMap };
