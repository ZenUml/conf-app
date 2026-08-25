import type { GlobalAssignmentSelection } from './globalAssignment';
import type { CanonicalFlowchart, CanonicalNode } from './mermaidFlowchart';

export type DirectionalTopologyEvidence = Readonly<{
  mappedOldNeighborNativeIds: readonly string[];
  newNeighborNativeIds: readonly string[];
  similarity: number | null;
}>;

export type StructuralTopologyAssessment = Readonly<{
  selection: GlobalAssignmentSelection;
  incoming: DirectionalTopologyEvidence;
  outgoing: DirectionalTopologyEvidence;
  topologySimilarity: number;
  /** Gate 4 selections are evidence only, not confirmed neighbor mappings. */
  evidence: 'provisional_global_assignment_mapped_neighbors';
  nextRequiredGate: 'split_merge_assessment';
}>;

export type StructuralTopologyUnresolved = Readonly<{
  selection: GlobalAssignmentSelection;
  reason:
    | 'ambiguous_global_assignment_evidence'
    | 'missing_old_canonical_node'
    | 'missing_new_canonical_node'
    | 'ambiguous_old_canonical_node'
    | 'ambiguous_new_canonical_node'
    | 'missing_topology_evidence'
    | 'unmapped_neighbor_assignment_evidence';
}>;

export interface StructuralTopologyResult {
  readonly assessed: readonly StructuralTopologyAssessment[];
  readonly unresolved: readonly StructuralTopologyUnresolved[];
  /** Iteration requires actual confirmed mappings, which this stage cannot create. */
  readonly iteration: Readonly<{
    status: 'deferred_requires_confirmed_neighbor_mappings';
    roundsRun: 0;
  }>;
}

/**
 * Structural/topology evidence after Gate 4. It compares directed neighbors
 * using only provisional one-to-one assignment evidence and intentionally
 * never promotes it to an identity confirmation or iterative mapping.
 */
export function assessStructuralTopology(input: Readonly<{
  oldModel: CanonicalFlowchart;
  newModel: CanonicalFlowchart;
  globalAssignmentSelections: readonly GlobalAssignmentSelection[];
}>): StructuralTopologyResult {
  const oldNodes = groupNodes(input.oldModel.nodes);
  const newNodes = groupNodes(input.newModel.nodes);
  const oldTopology = directedTopology(input.oldModel);
  const newTopology = directedTopology(input.newModel);
  const ambiguousSelections = ambiguousSelectionEvidence(input.globalAssignmentSelections);
  const provisionalNewByOld = new Map(
    input.globalAssignmentSelections.map((selection) => [
      selection.candidate.candidate.old.nativeId,
      selection.candidate.candidate.new.nativeId,
    ]),
  );
  const assessed: StructuralTopologyAssessment[] = [];
  const unresolved: StructuralTopologyUnresolved[] = [];

  for (const selection of input.globalAssignmentSelections) {
    if (ambiguousSelections.has(selection)) {
      unresolved.push({ selection, reason: 'ambiguous_global_assignment_evidence' });
      continue;
    }
    const oldNativeId = selection.candidate.candidate.old.nativeId;
    const newNativeId = selection.candidate.candidate.new.nativeId;
    const oldNode = requireUniqueNode(oldNodes, oldNativeId, 'old');
    if ('reason' in oldNode) {
      unresolved.push({ selection, reason: oldNode.reason });
      continue;
    }
    const newNode = requireUniqueNode(newNodes, newNativeId, 'new');
    if ('reason' in newNode) {
      unresolved.push({ selection, reason: newNode.reason });
      continue;
    }

    const oldNeighbors = oldTopology.get(oldNode.node.nativeId) ?? emptyTopology();
    const newNeighbors = newTopology.get(newNode.node.nativeId) ?? emptyTopology();
    if (oldNeighbors.incoming.size + oldNeighbors.outgoing.size + newNeighbors.incoming.size + newNeighbors.outgoing.size === 0) {
      unresolved.push({ selection, reason: 'missing_topology_evidence' });
      continue;
    }
    const mappedIncoming = mapNeighbors(oldNeighbors.incoming, provisionalNewByOld);
    const mappedOutgoing = mapNeighbors(oldNeighbors.outgoing, provisionalNewByOld);
    if (mappedIncoming.unmapped.length > 0 || mappedOutgoing.unmapped.length > 0) {
      unresolved.push({ selection, reason: 'unmapped_neighbor_assignment_evidence' });
      continue;
    }

    const incoming = directionalEvidence(mappedIncoming.mapped, newNeighbors.incoming);
    const outgoing = directionalEvidence(mappedOutgoing.mapped, newNeighbors.outgoing);
    const availableSimilarities = [incoming.similarity, outgoing.similarity].filter((similarity): similarity is number => similarity !== null);
    if (availableSimilarities.length === 0) {
      unresolved.push({ selection, reason: 'missing_topology_evidence' });
      continue;
    }
    assessed.push({
      selection,
      incoming,
      outgoing,
      topologySimilarity: round(availableSimilarities.reduce((total, value) => total + value, 0) / availableSimilarities.length),
      evidence: 'provisional_global_assignment_mapped_neighbors',
      nextRequiredGate: 'split_merge_assessment',
    });
  }

  return {
    assessed: [...assessed].sort((left, right) => compareSelections(left.selection, right.selection)),
    unresolved: [...unresolved].sort((left, right) => compareSelections(left.selection, right.selection)),
    iteration: { status: 'deferred_requires_confirmed_neighbor_mappings', roundsRun: 0 },
  };
}

type NodeGroup = ReadonlyMap<string, readonly CanonicalNode[]>;
type DirectedTopology = Readonly<{ incoming: ReadonlySet<string>; outgoing: ReadonlySet<string> }>;

function groupNodes(nodes: readonly CanonicalNode[]): NodeGroup {
  const grouped = new Map<string, CanonicalNode[]>();
  for (const node of nodes) {
    const values = grouped.get(node.nativeId) ?? [];
    values.push(node);
    grouped.set(node.nativeId, values);
  }
  return grouped;
}

function requireUniqueNode(
  nodes: NodeGroup,
  nativeId: string,
  revision: 'old' | 'new',
): Readonly<{ node: CanonicalNode }> | Readonly<{ reason: StructuralTopologyUnresolved['reason'] }> {
  const candidates = nodes.get(nativeId) ?? [];
  if (candidates.length === 0) return { reason: revision === 'old' ? 'missing_old_canonical_node' : 'missing_new_canonical_node' };
  if (candidates.length > 1) return { reason: revision === 'old' ? 'ambiguous_old_canonical_node' : 'ambiguous_new_canonical_node' };
  return { node: candidates[0] };
}

function directedTopology(model: CanonicalFlowchart): ReadonlyMap<string, DirectedTopology> {
  const topology = new Map<string, { incoming: Set<string>; outgoing: Set<string> }>();
  for (const node of model.nodes) topology.set(node.nativeId, { incoming: new Set(), outgoing: new Set() });
  for (const edge of model.edges) {
    for (let index = 0; index < edge.endpointNativeIds.length - 1; index += 1) {
      const source = edge.endpointNativeIds[index];
      const target = edge.endpointNativeIds[index + 1];
      const sourceTopology = topology.get(source);
      const targetTopology = topology.get(target);
      if (!sourceTopology || !targetTopology) continue;
      sourceTopology.outgoing.add(target);
      targetTopology.incoming.add(source);
    }
  }
  return topology;
}

function emptyTopology(): DirectedTopology {
  return { incoming: new Set(), outgoing: new Set() };
}

function ambiguousSelectionEvidence(selections: readonly GlobalAssignmentSelection[]): ReadonlySet<GlobalAssignmentSelection> {
  const byOld = new Map<string, GlobalAssignmentSelection[]>();
  const byNew = new Map<string, GlobalAssignmentSelection[]>();
  for (const selection of selections) {
    addSelection(byOld, selection.candidate.candidate.old.nativeId, selection);
    addSelection(byNew, selection.candidate.candidate.new.nativeId, selection);
  }
  const ambiguous = new Set<GlobalAssignmentSelection>();
  for (const group of [...byOld.values(), ...byNew.values()]) {
    if (group.length > 1) for (const selection of group) ambiguous.add(selection);
  }
  return ambiguous;
}

function addSelection(
  index: Map<string, GlobalAssignmentSelection[]>,
  nativeId: string,
  selection: GlobalAssignmentSelection,
): void {
  const values = index.get(nativeId) ?? [];
  values.push(selection);
  index.set(nativeId, values);
}

function mapNeighbors(
  oldNeighbors: ReadonlySet<string>,
  provisionalNewByOld: ReadonlyMap<string, string>,
): Readonly<{ mapped: readonly string[]; unmapped: readonly string[] }> {
  const mapped: string[] = [];
  const unmapped: string[] = [];
  for (const oldNeighbor of oldNeighbors) {
    const mappedNeighbor = provisionalNewByOld.get(oldNeighbor);
    if (mappedNeighbor === undefined) unmapped.push(oldNeighbor);
    else mapped.push(mappedNeighbor);
  }
  return { mapped: [...new Set(mapped)].sort(), unmapped: [...new Set(unmapped)].sort() };
}

function directionalEvidence(mappedOldNeighbors: readonly string[], newNeighbors: ReadonlySet<string>): DirectionalTopologyEvidence {
  const newNeighborNativeIds = [...newNeighbors].sort();
  if (mappedOldNeighbors.length === 0 && newNeighborNativeIds.length === 0) {
    return { mappedOldNeighborNativeIds: mappedOldNeighbors, newNeighborNativeIds, similarity: null };
  }
  const union = new Set([...mappedOldNeighbors, ...newNeighborNativeIds]);
  const newNeighborSet = new Set(newNeighborNativeIds);
  const intersection = mappedOldNeighbors.filter((neighbor) => newNeighborSet.has(neighbor));
  return {
    mappedOldNeighborNativeIds: mappedOldNeighbors,
    newNeighborNativeIds,
    similarity: round(intersection.length / union.size),
  };
}

function compareSelections(left: GlobalAssignmentSelection, right: GlobalAssignmentSelection): number {
  return left.candidate.candidate.old.nativeId.localeCompare(right.candidate.candidate.old.nativeId)
    || left.candidate.candidate.new.nativeId.localeCompare(right.candidate.candidate.new.nativeId);
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
