import { validateMermaidSyntax } from '@/utils/mermaid/validate';
import { parseFlowchartSource, type CanonicalFlowchart, type FlowchartParseResult } from './mermaidFlowchart';

export type ValidatedFlowchartResult =
  | Readonly<{ kind: 'ok'; model: CanonicalFlowchart }>
  | Exclude<FlowchartParseResult, { kind: 'ok' }>
  | Readonly<{ kind: 'invalid'; error: string }>;

/**
 * Mermaid's public parser remains the grammar authority. The owned parser runs
 * only after it accepts the source and only produces our narrow v1 model.
 */
export async function validateMermaidFlowchart(source: string): Promise<ValidatedFlowchartResult> {
  const validation = await validateMermaidSyntax(source);
  if (!validation.valid) return { kind: 'invalid', error: validation.error ?? 'Mermaid syntax error' };
  return parseFlowchartSource(source);
}
