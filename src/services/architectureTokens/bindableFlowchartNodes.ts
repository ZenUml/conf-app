import type { ArchitectureTokenBindingReadState } from './readMermaidArchitectureTokenBinding';

export type BindableFlowchartNode = Readonly<{
  diagramElementId: string;
  displayName: string;
}>;

export type BindableFlowchartNodesResult =
  | Readonly<{ kind: 'available'; entries: readonly BindableFlowchartNode[] }>
  | Readonly<{
    kind: 'unavailable';
    reason: 'binding_evidence_unavailable' | 'ambiguous_current_elements';
  }>;

/**
 * Converts only source-current, strictly decoded binding evidence into local
 * Flowchart node targets for a future explicit binding surface. This does not
 * inspect rendered SVG, infer a node from source text, or mutate state.
 */
export function listBindableFlowchartNodes(
  readState: ArchitectureTokenBindingReadState | undefined,
): BindableFlowchartNodesResult {
  if (readState?.kind !== 'available') {
    return { kind: 'unavailable', reason: 'binding_evidence_unavailable' };
  }
  const { state, sourceRevision } = readState;
  if (sourceRevision.sourceRevisionId !== state.currentRevisionId) {
    return { kind: 'unavailable', reason: 'ambiguous_current_elements' };
  }
  const currentEntries = state.revisionElements.filter(
    (entry) => entry.sourceRevisionId === state.currentRevisionId,
  );
  const targets: BindableFlowchartNode[] = [];
  for (const element of state.elements) {
    if (element.kind !== 'node' || element.lifecycleStatus !== 'active') continue;
    const matches = currentEntries.filter(
      (entry) => entry.diagramElementId === element.diagramElementId,
    );
    if (matches.length !== 1) {
      return { kind: 'unavailable', reason: 'ambiguous_current_elements' };
    }
    targets.push({
      diagramElementId: element.diagramElementId,
      displayName: matches[0].fingerprint.normalizedLabel ?? 'Unnamed Flowchart node',
    });
  }
  return {
    kind: 'available',
    entries: targets.sort((left, right) =>
      left.displayName.localeCompare(right.displayName) || left.diagramElementId.localeCompare(right.diagramElementId),
    ),
  };
}
