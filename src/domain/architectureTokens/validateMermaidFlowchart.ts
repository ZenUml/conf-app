import { validateMermaidSyntax } from '@/utils/mermaid/validate';
import { locateFlowchartNodeOccurrences, type JisonLocatorAdapterResult, type VersionPinnedJisonParserFactory } from './jisonFlowchartLocatorAdapter';
import { mermaid112JisonParserFactory } from './mermaid112JisonParserFactory';
import { parseFlowchartSource, type CanonicalFlowchart, type FlowchartParseResult } from './mermaidFlowchart';
import { verifyJisonFlowchartEvidence } from './verifyJisonFlowchartEvidence';

export type FlowchartParserEvidence =
  | Readonly<{ kind: 'jison_verified'; adapterVersion: string; verifiedOccurrenceCount: number }>
  | Readonly<{ kind: 'jison_rejected'; reason: string }>;

export type ValidatedFlowchartResult =
  | Readonly<{ kind: 'ok'; model: CanonicalFlowchart; parserEvidence: FlowchartParserEvidence }>
  | Exclude<FlowchartParseResult, { kind: 'ok' }>
  | Readonly<{ kind: 'invalid'; error: string }>;

export type FlowchartLocatorDependencies = Readonly<{
  createJisonFactory?: () => VersionPinnedJisonParserFactory;
  locateJisonEvidence?: typeof locateFlowchartNodeOccurrences;
}>;

/**
 * Mermaid's public parser remains the grammar authority. The product Locator
 * remains the conservative canonical model; the pinned Jison adapter supplies
 * parser-derived position evidence which is accepted only after strict,
 * whole-model verification. A rejected adapter never alters a Locator.
 */
export async function validateMermaidFlowchart(
  source: string,
  dependencies: FlowchartLocatorDependencies = {},
): Promise<ValidatedFlowchartResult> {
  const validation = await validateMermaidSyntax(source);
  if (!validation.valid) return { kind: 'invalid', error: validation.error ?? 'Mermaid syntax error' };

  const handwritten = parseFlowchartSource(source);
  if (handwritten.kind !== 'ok') return handwritten;

  let adapterResult: JisonLocatorAdapterResult;
  try {
    adapterResult = (dependencies.locateJisonEvidence ?? locateFlowchartNodeOccurrences)(
      source,
      (dependencies.createJisonFactory ?? mermaid112JisonParserFactory)(),
    );
  } catch {
    return withRejectedJisonEvidence(handwritten.model, 'factory_contract_failure');
  }
  if (adapterResult.kind !== 'ok') return withRejectedJisonEvidence(handwritten.model, fallbackReason(adapterResult));

  const verification = verifyJisonFlowchartEvidence(source, handwritten.model, adapterResult.occurrences);
  if (verification.kind !== 'verified') return withRejectedJisonEvidence(handwritten.model, verification.reason);

  return {
    kind: 'ok',
    model: handwritten.model,
    parserEvidence: {
      kind: 'jison_verified',
      adapterVersion: adapterResult.adapterVersion,
      verifiedOccurrenceCount: verification.verifiedOccurrenceCount,
    },
  };
}

function withRejectedJisonEvidence(model: CanonicalFlowchart, reason: string): ValidatedFlowchartResult {
  return { kind: 'ok', model, parserEvidence: { kind: 'jison_rejected', reason } };
}

function fallbackReason(result: Exclude<JisonLocatorAdapterResult, { kind: 'ok' }>): string {
  return `${result.kind}:${result.reason}`;
}
