import {
  mergeArchitectureTokenBindingMetadata,
} from '@/domain/architectureTokens/architectureTokenBindingState';
import type { ArchitectureTokenDirectoryResult } from '@/domain/architectureTokens/architectureTokenDirectory';
import type { Diagram } from '@/model/Diagram/Diagram';
import {
  bindArchitectureTokenExplicitly,
  unbindArchitectureTokenExplicitly,
  type ExplicitArchitectureTokenBindingResult,
} from './explicitArchitectureTokenBinding';
import { readMermaidArchitectureTokenBinding } from './readMermaidArchitectureTokenBinding';

type CommandDependencies = Readonly<{
  createId?: () => string;
  now?: () => string;
}>;

/**
 * Applies a successful local bind command to the in-memory Diagram envelope.
 * The regular save path will later persist its source and namespaced state in
 * one custom-content write; this seam never performs its own network request.
 */
export async function applyExplicitArchitectureTokenBind(input: Readonly<{
  diagram: Diagram;
  directory: ArchitectureTokenDirectoryResult;
  diagramElementId: string;
  logicalTokenId: string;
}> & CommandDependencies): Promise<ExplicitArchitectureTokenBindingResult> {
  const result = bindArchitectureTokenExplicitly({
    readState: input.diagram.architectureTokenBindingReadState,
    directory: input.directory,
    diagramElementId: input.diagramElementId,
    logicalTokenId: input.logicalTokenId,
    createId: input.createId,
    now: input.now,
  });
  return applyUpdatedState(input.diagram, result);
}

/** Removes a selected active binding through the same namespaced Diagram seam. */
export async function applyExplicitArchitectureTokenUnbind(input: Readonly<{
  diagram: Diagram;
  tokenBindingId: string;
}> & CommandDependencies): Promise<ExplicitArchitectureTokenBindingResult> {
  const result = unbindArchitectureTokenExplicitly({
    readState: input.diagram.architectureTokenBindingReadState,
    tokenBindingId: input.tokenBindingId,
    createId: input.createId,
    now: input.now,
  });
  return applyUpdatedState(input.diagram, result);
}

async function applyUpdatedState(
  diagram: Diagram,
  result: ExplicitArchitectureTokenBindingResult,
): Promise<ExplicitArchitectureTokenBindingResult> {
  if (result.kind !== 'updated') return result;
  const merged = mergeArchitectureTokenBindingMetadata(diagram.metadata, result.state);
  if (merged.kind !== 'ok') return { kind: 'rejected', reason: 'state_update_invalid' };

  try {
    const refreshed = await readMermaidArchitectureTokenBinding({
      diagramType: diagram.diagramType,
      mermaidCode: diagram.mermaidCode,
      metadata: merged.value,
    });
    if (refreshed.kind !== 'available') return { kind: 'rejected', reason: 'binding_evidence_unavailable' };
    diagram.metadata = merged.value;
    diagram.architectureTokenBindingReadState = refreshed;
    diagram.architectureTokenBindingLoadedSource = diagram.mermaidCode;
    return result;
  } catch {
    return { kind: 'rejected', reason: 'state_update_invalid' };
  }
}
