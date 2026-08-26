import { validateMermaidSyntax } from '@/utils/mermaid/validate';
import {
  extractFlowchartNodeOccurrenceEvidence,
  type JisonOccurrenceEvidenceResult,
  type VersionPinnedJisonParserFactory,
} from './jisonFlowchartLocatorAdapter';
import { mermaid112JisonParserFactory } from './mermaid112JisonParserFactory';
import {
  applyNodeOccurrenceSourcePositionEvidence,
  parseFlowchartSource,
  type CanonicalFlowchart,
  type FlowchartParseResult,
} from './mermaidFlowchart';
import { verifyJisonFlowchartEvidence } from './verifyJisonFlowchartEvidence';

export type FlowchartLocatorEvidence =
  | Readonly<{ kind: 'jison_preferred'; adapterVersion: string; occurrenceCount: number }>
  | Readonly<{ kind: 'legacy_handwritten'; reason: string }>;

export type ValidatedFlowchartResult =
  | Readonly<{ kind: 'ok'; model: CanonicalFlowchart; locatorEvidence: FlowchartLocatorEvidence }>
  | Exclude<FlowchartParseResult, { kind: 'ok' }>
  | Readonly<{ kind: 'invalid'; error: string }>;

export type FlowchartLocatorEvidenceDependencies = Readonly<{
  createJisonEvidenceFactory?: () => VersionPinnedJisonParserFactory;
  extractJisonOccurrenceEvidence?: typeof extractFlowchartNodeOccurrenceEvidence;
}>;

/**
 * Mermaid's public parser remains the grammar authority. The product Locator
 * is the grammar authority. The Locator remains a distinct domain layer that
 * turns source-position evidence into product locators. The pinned Jison
 * adapter is the preferred evidence provider; the legacy handwritten extractor
 * is a migration-period evidence provider only. Provider selection never
 * changes public Mermaid syntax validity.
 */
export async function validateMermaidFlowchart(
  source: string,
  dependencies: FlowchartLocatorEvidenceDependencies = {},
): Promise<ValidatedFlowchartResult> {
  const validation = await validateMermaidSyntax(source);
  if (!validation.valid) return { kind: 'invalid', error: validation.error ?? 'Mermaid syntax error' };

  const legacyLocator = parseFlowchartSource(source);
  if (legacyLocator.kind !== 'ok') return legacyLocator;

  let adapterResult: JisonOccurrenceEvidenceResult;
  try {
    adapterResult = (dependencies.extractJisonOccurrenceEvidence ?? extractFlowchartNodeOccurrenceEvidence)(
      source,
      (dependencies.createJisonEvidenceFactory ?? mermaid112JisonParserFactory)(),
    );
  } catch {
    return withLegacyLocatorEvidence(legacyLocator.model, 'factory_contract_failure');
  }
  if (adapterResult.kind !== 'ok') return withLegacyLocatorEvidence(legacyLocator.model, evidenceRejectionReason(adapterResult));

  const verification = verifyJisonFlowchartEvidence(source, legacyLocator.model, adapterResult.occurrences);
  if (verification.kind !== 'verified') return withLegacyLocatorEvidence(legacyLocator.model, verification.reason);
  const model = applyNodeOccurrenceSourcePositionEvidence(source, legacyLocator.model, adapterResult.occurrences);
  if (!model) return withLegacyLocatorEvidence(legacyLocator.model, 'canonical_occurrence_mismatch');

  return {
    kind: 'ok',
    model,
    locatorEvidence: {
      kind: 'jison_preferred',
      adapterVersion: adapterResult.adapterVersion,
      occurrenceCount: verification.verifiedOccurrenceCount,
    },
  };
}

function withLegacyLocatorEvidence(model: CanonicalFlowchart, reason: string): ValidatedFlowchartResult {
  return { kind: 'ok', model, locatorEvidence: { kind: 'legacy_handwritten', reason } };
}

function evidenceRejectionReason(result: Exclude<JisonOccurrenceEvidenceResult, { kind: 'ok' }>): string {
  return `${result.kind}:${result.reason}`;
}
