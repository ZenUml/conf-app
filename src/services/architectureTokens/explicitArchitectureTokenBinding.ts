import {
  encodeArchitectureTokenBindingState,
  type ArchitectureTokenBindingStateV1,
  type BindingAuditRecord,
  type TokenBindingRecord,
} from '@/domain/architectureTokens/architectureTokenBindingState';
import {
  findArchitectureTokenDirectoryEntry,
  type ArchitectureTokenDirectoryResult,
} from '@/domain/architectureTokens/architectureTokenDirectory';
import type { ArchitectureTokenBindingReadState } from './readMermaidArchitectureTokenBinding';
import { listBindableFlowchartNodes } from './bindableFlowchartNodes';

const POLICY_VERSION = 'architecture-token-binding-v1';

type BindingCommandDependencies = Readonly<{
  createId?: () => string;
  now?: () => string;
}>;

export type ExplicitArchitectureTokenBindingResult =
  | Readonly<{
    kind: 'updated';
    action: 'bound' | 'unbound';
    state: ArchitectureTokenBindingStateV1;
  }>
  | Readonly<{
    kind: 'rejected';
    reason:
      | 'binding_evidence_unavailable'
      | 'directory_unavailable'
      | 'token_not_in_directory'
      | 'element_not_bindable'
      | 'active_binding_exists'
      | 'binding_not_found'
      | 'state_update_invalid';
  }>;

/**
 * Explicit user binding command. A caller must provide a source-current node
 * target and an entry from the injected local token directory; this command
 * never infers either. V1 conservatively permits one active binding per node.
 */
export function bindArchitectureTokenExplicitly(input: Readonly<{
  readState: ArchitectureTokenBindingReadState | undefined;
  directory: ArchitectureTokenDirectoryResult;
  diagramElementId: string;
  logicalTokenId: string;
}> & BindingCommandDependencies): ExplicitArchitectureTokenBindingResult {
  if (input.readState?.kind !== 'available') return rejected('binding_evidence_unavailable');
  if (input.directory.kind !== 'available') return rejected('directory_unavailable');
  const token = findArchitectureTokenDirectoryEntry(input.directory, input.logicalTokenId);
  if (!token) return rejected('token_not_in_directory');
  const targets = listBindableFlowchartNodes(input.readState);
  if (targets.kind !== 'available') return rejected('binding_evidence_unavailable');
  if (!targets.entries.some((entry) => entry.diagramElementId === input.diagramElementId)) {
    return rejected('element_not_bindable');
  }
  if (input.readState.state.bindings.some(
    (binding) => binding.diagramElementId === input.diagramElementId && binding.status !== 'retired',
  )) return rejected('active_binding_exists');

  const createId = input.createId ?? (() => crypto.randomUUID());
  const now = input.now ?? (() => new Date().toISOString());
  const recordedAt = now();
  const binding: TokenBindingRecord = {
    tokenBindingId: createId(),
    diagramElementId: input.diagramElementId,
    logicalTokenId: token.logicalTokenId,
    ...(token.tokenId ? { tokenId: token.tokenId } : {}),
    status: 'confirmed',
    confirmationMethod: 'user',
    createdAt: recordedAt,
    updatedAt: recordedAt,
    provenance: { source: 'user_confirmation', recordedAt },
  };
  return updated(
    'bound',
    appendAudit({
      ...input.readState.state,
      bindings: [...input.readState.state.bindings, binding],
    }, createId, now, 'user_binding_created'),
  );
}

/**
 * Explicit unbind command. It deletes only the selected active binding and
 * records a source-free audit event, so retired records cannot later enter
 * source-change reconciliation as active evidence.
 */
export function unbindArchitectureTokenExplicitly(input: Readonly<{
  readState: ArchitectureTokenBindingReadState | undefined;
  tokenBindingId: string;
}> & BindingCommandDependencies): ExplicitArchitectureTokenBindingResult {
  if (input.readState?.kind !== 'available') return rejected('binding_evidence_unavailable');
  const binding = input.readState.state.bindings.find(
    (candidate) => candidate.tokenBindingId === input.tokenBindingId && candidate.status !== 'retired',
  );
  if (!binding) return rejected('binding_not_found');
  const createId = input.createId ?? (() => crypto.randomUUID());
  const now = input.now ?? (() => new Date().toISOString());
  return updated(
    'unbound',
    appendAudit({
      ...input.readState.state,
      bindings: input.readState.state.bindings.filter((candidate) => candidate.tokenBindingId !== binding.tokenBindingId),
    }, createId, now, 'user_binding_removed'),
  );
}

function appendAudit(
  state: ArchitectureTokenBindingStateV1,
  createId: () => string,
  now: () => string,
  reason: 'user_binding_created' | 'user_binding_removed',
): ArchitectureTokenBindingStateV1 {
  const audit: BindingAuditRecord = {
    auditId: createId(),
    kind: 'binding_action',
    sourceRevisionId: state.currentRevisionId,
    outcome: 'accepted',
    reasons: [reason],
    algorithmVersion: POLICY_VERSION,
    recordedAt: now(),
  };
  return { ...state, audit: [...state.audit, audit] };
}

function updated(
  action: 'bound' | 'unbound',
  state: ArchitectureTokenBindingStateV1,
): ExplicitArchitectureTokenBindingResult {
  return encodeArchitectureTokenBindingState(state).kind === 'ok'
    ? { kind: 'updated', action, state }
    : rejected('state_update_invalid');
}

function rejected(reason: Extract<ExplicitArchitectureTokenBindingResult, { kind: 'rejected' }>['reason']): ExplicitArchitectureTokenBindingResult {
  return { kind: 'rejected', reason };
}
