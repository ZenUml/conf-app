import type { CanonicalNode } from './mermaidFlowchart';

/**
 * Stable evidence captured for one logical node in one source revision.
 * `nativeId` deliberately remains evidence rather than DiagramElement identity.
 */
export interface ElementFingerprint {
  readonly kind: 'node';
  readonly nativeId: string;
  readonly normalizedLabel: string | null;
  readonly shape: string | null;
  readonly containerPath: readonly string[];
  readonly statementContexts: readonly string[];
  readonly neighborNativeIds: readonly string[];
}

export interface RevisionElement {
  readonly diagramElementId: string;
  readonly fingerprint: ElementFingerprint;
}

export type ReconciliationStatus =
  | 'confirmed_automatic'
  | 'needs_confirmation'
  | 'ambiguous'
  | 'orphaned';

export interface ReconciliationDecision {
  readonly diagramElementId: string;
  readonly status: ReconciliationStatus;
  readonly newNativeId?: string;
  readonly reasons: readonly string[];
  readonly candidateNativeIds: readonly string[];
}

export interface ReconciliationInput {
  readonly oldElements: readonly RevisionElement[];
  readonly newNodes: readonly CanonicalNode[];
  /**
   * Supplied only by a source-diff relocation adapter after unchanged source
   * text has been relocated. This module never treats a Mermaid ID as such
   * evidence, so an ID-only delete/recreate cannot auto-confirm.
   */
  readonly relocatedPairs: readonly Readonly<{
    diagramElementId: string;
    newNativeId: string;
  }>[];
}

export interface ReconciliationResult {
  readonly decisions: readonly ReconciliationDecision[];
}

export function fingerprintFlowchartNode(node: CanonicalNode): ElementFingerprint {
  return {
    kind: 'node',
    nativeId: node.nativeId,
    normalizedLabel: normalize(node.label),
    shape: node.shape,
    containerPath: node.containerPath.map(normalizeRequired),
    statementContexts: [...node.statementContexts].map(normalizeRequired).sort(),
    neighborNativeIds: [...node.incidentNativeIds].map(normalizeRequired).sort(),
  };
}

/**
 * Conservative stage-one reconciler. Automatic transfer has a deliberately
 * narrow proof: a source-diff relocation plus an exact semantic fingerprint.
 * Everything else is retained as unresolved evidence for a later UI decision.
 */
export function reconcileFlowchartNodes(input: ReconciliationInput): ReconciliationResult {
  const newByNativeId = new Map(input.newNodes.map((node) => [node.nativeId, node]));
  const relocationClaims = new Map<string, string[]>();
  const contextualClaims = new Map<string, string[]>();
  for (const pair of input.relocatedPairs) {
    const claims = relocationClaims.get(pair.newNativeId) ?? [];
    claims.push(pair.diagramElementId);
    relocationClaims.set(pair.newNativeId, claims);
  }
  for (const oldElement of input.oldElements) {
    for (const newNode of input.newNodes) {
      if (!isCandidate(oldElement.fingerprint, fingerprintFlowchartNode(newNode))) continue;
      const claims = contextualClaims.get(newNode.nativeId) ?? [];
      claims.push(oldElement.diagramElementId);
      contextualClaims.set(newNode.nativeId, claims);
    }
  }

  return {
    decisions: input.oldElements.map((oldElement): ReconciliationDecision => {
      const relocated = input.relocatedPairs.filter((pair) => pair.diagramElementId === oldElement.diagramElementId);
      const exactRelocations = relocated.filter((pair) => {
        const newNode = newByNativeId.get(pair.newNativeId);
        return newNode != null && fingerprintEquals(oldElement.fingerprint, fingerprintFlowchartNode(newNode));
      });

      if (exactRelocations.length === 1) {
        const newNativeId = exactRelocations[0].newNativeId;
        if ((relocationClaims.get(newNativeId) ?? []).length === 1) {
          return {
            diagramElementId: oldElement.diagramElementId,
            status: 'confirmed_automatic',
            newNativeId,
            reasons: ['source_diff_relocated', 'fingerprint_exact'],
            candidateNativeIds: [newNativeId],
          };
        }
        return {
          diagramElementId: oldElement.diagramElementId,
          status: 'ambiguous',
          reasons: ['one_to_one_conflict'],
          candidateNativeIds: [newNativeId],
        };
      }

      const candidates = input.newNodes.filter((node) => isCandidate(oldElement.fingerprint, fingerprintFlowchartNode(node)));
      if (candidates.length === 0) {
        return {
          diagramElementId: oldElement.diagramElementId,
          status: 'orphaned',
          reasons: ['no_safe_candidate'],
          candidateNativeIds: [],
        };
      }
      if (candidates.length > 1) {
        return {
          diagramElementId: oldElement.diagramElementId,
          status: 'ambiguous',
          reasons: ['multiple_plausible_candidates'],
          candidateNativeIds: candidates.map((candidate) => candidate.nativeId).sort(),
        };
      }
      if ((contextualClaims.get(candidates[0].nativeId) ?? []).length > 1) {
        return {
          diagramElementId: oldElement.diagramElementId,
          status: 'ambiguous',
          reasons: ['one_to_one_conflict'],
          candidateNativeIds: [candidates[0].nativeId],
        };
      }
      return {
        diagramElementId: oldElement.diagramElementId,
        status: 'needs_confirmation',
        newNativeId: candidates[0].nativeId,
        reasons: oldElement.fingerprint.nativeId === candidates[0].nativeId
          ? ['native_id_is_insufficient']
          : ['contextual_candidate_requires_confirmation'],
        candidateNativeIds: [candidates[0].nativeId],
      };
    }),
  };
}

function isCandidate(oldFingerprint: ElementFingerprint, newFingerprint: ElementFingerprint): boolean {
  if (oldFingerprint.kind !== newFingerprint.kind) return false;
  return oldFingerprint.nativeId === newFingerprint.nativeId
    || (
      oldFingerprint.normalizedLabel !== null
      && oldFingerprint.normalizedLabel === newFingerprint.normalizedLabel
      && oldFingerprint.shape === newFingerprint.shape
      && arraysEqual(oldFingerprint.containerPath, newFingerprint.containerPath)
    );
}

function fingerprintEquals(left: ElementFingerprint, right: ElementFingerprint): boolean {
  return left.kind === right.kind
    && left.nativeId === right.nativeId
    && left.normalizedLabel === right.normalizedLabel
    && left.shape === right.shape
    && arraysEqual(left.containerPath, right.containerPath)
    && arraysEqual(left.statementContexts, right.statementContexts)
    && arraysEqual(left.neighborNativeIds, right.neighborNativeIds);
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalize(value: string | null): string | null {
  return value === null ? null : normalizeRequired(value);
}

function normalizeRequired(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}
