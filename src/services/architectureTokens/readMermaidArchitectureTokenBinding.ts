import {
  readArchitectureTokenBindingState,
  type ArchitectureTokenBindingStateV1,
  type BindingAuditRecord,
  type SourceRevisionRecord,
} from '@/domain/architectureTokens/architectureTokenBindingState';
import { sha256NormalizedSource } from '@/domain/architectureTokens/sourceRevision';

const RECONCILIATION_HISTORY_LIMIT = 3;

/**
 * Closed, editor-safe categories for reconciliation evidence. These values
 * are deliberately not the persisted reason strings: the latter are audit
 * internals and must never cross the read/display boundary.
 */
export type ReconciliationAuditCategory =
  | 'exact_relocation'
  | 'fingerprint_match'
  | 'binding_retained'
  | 'no_safe_relocation'
  | 'relocation_unresolved'
  | 'candidate_unresolved'
  | 'assignment_unresolved'
  | 'topology_unresolved'
  | 'ambiguous_structure'
  | 'binding_orphaned';

export type ReconciliationAuditSummary = Readonly<{
  outcome: BindingAuditRecord['outcome'];
  categories: readonly ReconciliationAuditCategory[];
}>;

/**
 * Only these persisted reasons are eligible for a display projection. Keep
 * this map explicit: an unknown future reason is omitted rather than echoed,
 * bucketed as `unknown`, or exposed as raw audit text.
 */
const RECONCILIATION_REASON_CATEGORY: Readonly<
  Record<string, ReconciliationAuditCategory>
> = {
  exact_source_relocation_all_occurrences: 'exact_relocation',
  static_fingerprint_exact: 'fingerprint_match',
  binding_retained: 'binding_retained',
  no_safe_exact_relocation: 'no_safe_relocation',
  source_diff_unresolved: 'relocation_unresolved',
  native_id_unmatched: 'candidate_unresolved',
  fingerprint_unresolved: 'candidate_unresolved',
  assignment_unresolved: 'assignment_unresolved',
  topology_unresolved: 'topology_unresolved',
  ambiguous_split_merge: 'ambiguous_structure',
  delete_recreate_orphaned: 'binding_orphaned',
};

export type ArchitectureTokenBindingReadState =
  | Readonly<{ kind: 'not_applicable' }>
  | Readonly<{ kind: 'not_configured' }>
  | Readonly<{
    kind: 'available';
    state: ArchitectureTokenBindingStateV1;
    sourceRevision: SourceRevisionRecord;
    reconciliationHistory: readonly ReconciliationAuditSummary[];
  }>
  | Readonly<{
    kind: 'stale';
    reason: 'source_hash_mismatch';
    sourceRevisionId: string;
  }>
  | Readonly<{
    kind: 'untrusted';
    reason: 'invalid_metadata' | 'invalid_state' | 'oversize_state' | 'current_revision_not_valid';
  }>;

export type MermaidBindingReadableDiagram = Readonly<{
  diagramType?: unknown;
  mermaidCode?: unknown;
  metadata?: unknown;
}>;

/**
 * Reduce persisted reconciliation audits to a bounded, privacy-safe history.
 * The codec has already validated the state before this function is called;
 * this projection still treats every reason as untrusted input and only
 * returns categories present in the explicit allow-list above.
 */
export function projectReconciliationAuditHistory(
  state: ArchitectureTokenBindingStateV1,
): readonly ReconciliationAuditSummary[] {
  return state.audit
    .map((audit, index) => ({ audit, index }))
    .filter(({ audit }) => audit.kind === 'reconciliation')
    .sort((left, right) => {
      const byRecordedAt = Date.parse(right.audit.recordedAt) - Date.parse(left.audit.recordedAt);
      return byRecordedAt || right.index - left.index;
    })
    .slice(0, RECONCILIATION_HISTORY_LIMIT)
    .map(({ audit }) => ({
      outcome: audit.outcome,
      categories: audit.reasons
        .map((reason) => RECONCILIATION_REASON_CATEGORY[reason])
        .filter((category): category is ReconciliationAuditCategory => category !== undefined)
        .filter((category, index, categories) => categories.indexOf(category) === index),
    }));
}

/**
 * Read-only boundary for stored Architecture Token evidence. A valid envelope
 * becomes available only when it names a valid current revision whose
 * normalized source hash equals the Diagram's authoritative Mermaid source.
 * This function deliberately never repairs, merges, or writes metadata.
 */
export async function readMermaidArchitectureTokenBinding(
  diagram: MermaidBindingReadableDiagram,
): Promise<ArchitectureTokenBindingReadState> {
  if (diagram.diagramType !== 'mermaid') return { kind: 'not_applicable' };

  const decoded = readArchitectureTokenBindingState(diagram.metadata ?? {});
  if (decoded.kind !== 'ok') return { kind: 'untrusted', reason: decoded.reason };
  const state = decoded.value;
  if (!state) return { kind: 'not_configured' };

  const sourceRevision = state.revisions.find(
    (revision) => revision.sourceRevisionId === state.currentRevisionId,
  );
  if (!sourceRevision || sourceRevision.validationStatus !== 'valid') {
    return { kind: 'untrusted', reason: 'current_revision_not_valid' };
  }

  const sourceHash = await sha256NormalizedSource(
    typeof diagram.mermaidCode === 'string' ? diagram.mermaidCode : '',
  );
  if (sourceRevision.normalizedSourceSha256 !== sourceHash) {
    return {
      kind: 'stale',
      reason: 'source_hash_mismatch',
      sourceRevisionId: sourceRevision.sourceRevisionId,
    };
  }

  return {
    kind: 'available',
    state,
    sourceRevision,
    reconciliationHistory: projectReconciliationAuditHistory(state),
  };
}
