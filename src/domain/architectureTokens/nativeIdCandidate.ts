import type { CanonicalNode } from './mermaidFlowchart';
import type { ExactSourceRelocation } from './sourceDiffRelocation';

export type ExactNativeIdNodeCandidate = Readonly<{
  /** Revision-local parser facts, not a logical-element identity. */
  old: Readonly<{ kind: 'node'; nativeId: string }>;
  new: Readonly<{ kind: 'node'; nativeId: string }>;
  /** Stage 1 address evidence, carried separately from the native-ID signal. */
  sourceDiffRelocations: readonly ExactSourceRelocation[];
  /** Stage 2 never accepts a candidate; Stage 3 must assess static facts. */
  nextRequiredGate: 'fingerprint_scoring';
}>;

export type UnmatchedNativeIdNode = Readonly<{
  old: Readonly<{ kind: 'node'; nativeId: string }>;
  reason: 'no_exact_native_id_candidate' | 'duplicate_native_id_candidate';
}>;

export interface ExactNativeIdCandidateAssessment {
  readonly candidates: readonly ExactNativeIdNodeCandidate[];
  readonly unmatched: readonly UnmatchedNativeIdNode[];
}

/**
 * Stage 2 of the Source Binding Engine for the node-only v1 subset. A native
 * Mermaid ID is evidence that two parser-confirmed node facts may proceed to
 * fingerprint scoring; it is never identity confirmation or binding transfer.
 */
export function assessExactNativeIdNodeCandidates(input: Readonly<{
  oldNodes: readonly CanonicalNode[];
  newNodes: readonly CanonicalNode[];
  sourceDiffRelocations: readonly ExactSourceRelocation[];
}>): ExactNativeIdCandidateAssessment {
  const oldByNativeId = groupByNativeId(input.oldNodes);
  const newByNativeId = groupByNativeId(input.newNodes);
  const candidates: ExactNativeIdNodeCandidate[] = [];
  const unmatched: UnmatchedNativeIdNode[] = [];

  for (const oldNode of input.oldNodes) {
    const oldWithId = oldByNativeId.get(oldNode.nativeId) ?? [];
    const newWithId = newByNativeId.get(oldNode.nativeId) ?? [];
    if (oldWithId.length !== 1 || newWithId.length > 1) {
      unmatched.push({
        old: { kind: oldNode.kind, nativeId: oldNode.nativeId },
        reason: 'duplicate_native_id_candidate',
      });
      continue;
    }
    const newNode = newWithId[0];
    if (!newNode) {
      unmatched.push({
        old: { kind: oldNode.kind, nativeId: oldNode.nativeId },
        reason: 'no_exact_native_id_candidate',
      });
      continue;
    }

    candidates.push({
      old: { kind: oldNode.kind, nativeId: oldNode.nativeId },
      new: { kind: newNode.kind, nativeId: newNode.nativeId },
      sourceDiffRelocations: input.sourceDiffRelocations.filter((relocation) =>
        nodeHasOccurrenceSpan(oldNode, relocation.oldSpan)
        && nodeHasOccurrenceSpan(newNode, relocation.newSpan),
      ),
      nextRequiredGate: 'fingerprint_scoring',
    });
  }

  return { candidates, unmatched };
}

function groupByNativeId(nodes: readonly CanonicalNode[]): ReadonlyMap<string, readonly CanonicalNode[]> {
  const grouped = new Map<string, CanonicalNode[]>();
  for (const node of nodes) {
    const values = grouped.get(node.nativeId) ?? [];
    values.push(node);
    grouped.set(node.nativeId, values);
  }
  return grouped;
}

function nodeHasOccurrenceSpan(node: CanonicalNode, span: Readonly<{ startByte: number; endByte: number }>): boolean {
  return node.occurrences.some((occurrence) =>
    occurrence.span.startByte === span.startByte && occurrence.span.endByte === span.endByte,
  );
}
