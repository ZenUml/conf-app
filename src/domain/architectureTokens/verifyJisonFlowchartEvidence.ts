import { sliceUtf8ByteSpan } from './utf8Locator';
import type { CanonicalFlowchart, NodeOccurrence } from './mermaidFlowchart';
import type { JisonNodeOccurrenceEvidence } from './jisonFlowchartLocatorAdapter';

export type JisonFlowchartEvidenceVerification =
  | Readonly<{ kind: 'verified'; verifiedOccurrenceCount: number }>
  | Readonly<{ kind: 'rejected'; reason: 'canonical_occurrence_mismatch' }>;

/**
 * Verifies parser-derived Jison structure and positions against the domain
 * Locator result. It intentionally never writes a Jison span into the model:
 * Jison is evidence, while `NodeOccurrence` remains the product Locator with
 * its role, statement context, and future locator semantics owned here.
 */
export function verifyJisonFlowchartEvidence(
  source: string,
  model: CanonicalFlowchart,
  jisonOccurrences: readonly JisonNodeOccurrenceEvidence[],
): JisonFlowchartEvidenceVerification {
  const byNativeId = new Map<string, JisonNodeOccurrenceEvidence[]>();
  for (const occurrence of jisonOccurrences) {
    const group = byNativeId.get(occurrence.nativeId) ?? [];
    group.push(occurrence);
    byNativeId.set(occurrence.nativeId, group);
  }

  const expectedCount = model.nodes.reduce((count, node) => count + node.occurrences.length, 0);
  if (expectedCount !== jisonOccurrences.length) return { kind: 'rejected', reason: 'canonical_occurrence_mismatch' };

  for (const node of model.nodes) {
    const locators = [...node.occurrences].sort(compareOccurrence);
    const evidence = [...(byNativeId.get(node.nativeId) ?? [])].sort(compareOccurrence);
    if (locators.length !== evidence.length) return { kind: 'rejected', reason: 'canonical_occurrence_mismatch' };

    for (let index = 0; index < locators.length; index += 1) {
      const locator = locators[index];
      const jisonOccurrenceEvidence = evidence[index];
      if (locator.role !== jisonOccurrenceEvidence.role
        || sliceUtf8ByteSpan(source, jisonOccurrenceEvidence.span) !== jisonOccurrenceEvidence.fragment
        || sliceUtf8ByteSpan(source, locator.span) !== jisonOccurrenceEvidence.fragment
        || !isSyntacticClauseOf(locator, jisonOccurrenceEvidence, source)) {
        return { kind: 'rejected', reason: 'canonical_occurrence_mismatch' };
      }
    }
  }

  return { kind: 'verified', verifiedOccurrenceCount: expectedCount };
}

function isSyntacticClauseOf(locator: NodeOccurrence, evidence: JisonNodeOccurrenceEvidence, source: string): boolean {
  const locatorStatement = sliceUtf8ByteSpan(source, locator.statementSpan).trim();
  const parserStatement = sliceUtf8ByteSpan(source, evidence.statementSpan).trim();
  // A chained edge may reduce as a clause (`C --> D`) within the source line
  // (`C --> D --> E`). It must nevertheless be an exact source subset that
  // contains the already matched occurrence fragment.
  return parserStatement.length > 0
    && locatorStatement.includes(parserStatement)
    && parserStatement.includes(evidence.fragment);
}

function compareOccurrence(
  left: Pick<NodeOccurrence, 'span'>,
  right: Pick<NodeOccurrence, 'span'>,
): number {
  return left.span.startByte - right.span.startByte || left.span.endByte - right.span.endByte;
}
