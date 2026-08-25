import {
  readArchitectureTokenBindingState,
  type ArchitectureTokenBindingStateV1,
  type SourceRevisionRecord,
} from '@/domain/architectureTokens/architectureTokenBindingState';
import { sha256NormalizedSource } from '@/domain/architectureTokens/sourceRevision';

export type ArchitectureTokenBindingReadState =
  | Readonly<{ kind: 'not_applicable' }>
  | Readonly<{ kind: 'not_configured' }>
  | Readonly<{
    kind: 'available';
    state: ArchitectureTokenBindingStateV1;
    sourceRevision: SourceRevisionRecord;
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

  return { kind: 'available', state, sourceRevision };
}
