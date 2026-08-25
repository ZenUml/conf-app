import type { FingerprintScoredCandidate } from './fingerprintScoring';

const MIN_ASSIGNABLE_SCORE = 0.65;
const SCORE_SCALE = 1_000_000;

export type GlobalAssignmentSelection = Readonly<{
  candidate: FingerprintScoredCandidate;
  proof: 'unique_maximum_weight_assignment';
  componentMaximumScore: number;
  componentCandidateCount: number;
  /** Assignment evidence only; the following stage may assess structure. */
  nextRequiredGate: 'structural_topology_assessment';
}>;

export type GlobalAssignmentUnresolved = Readonly<{
  candidate: FingerprintScoredCandidate;
  reason:
    | 'invalid_or_absent_score'
    | 'score_below_assignment_floor'
    | 'duplicate_candidate_edge'
    | 'not_selected_by_higher_global_assignment'
    | 'ambiguous_global_assignment_tie';
  componentMaximumScore?: number;
}>;

export interface GlobalAssignmentAssessment {
  readonly selected: readonly GlobalAssignmentSelection[];
  readonly unresolved: readonly GlobalAssignmentUnresolved[];
}

/**
 * Stage 4 of the Source Binding Engine. Selects only unique, globally
 * maximum-weight one-to-one candidate assignments. It neither confirms
 * identity nor changes a binding; ties and insufficient evidence stay
 * unresolved for later gates.
 */
export function assignMaximumWeightCandidates(input: Readonly<{
  scored: readonly FingerprintScoredCandidate[];
  minimumScore?: number;
}>): GlobalAssignmentAssessment {
  const minimumScore = input.minimumScore ?? MIN_ASSIGNABLE_SCORE;
  if (!Number.isFinite(minimumScore) || minimumScore < 0 || minimumScore > 1) {
    throw new RangeError('minimumScore must be a finite number between 0 and 1');
  }

  const selected: GlobalAssignmentSelection[] = [];
  const unresolved: GlobalAssignmentUnresolved[] = [];
  const eligible: FingerprintScoredCandidate[] = [];
  const duplicateEdges = new Set<string>();
  const edgeCounts = new Map<string, number>();

  for (const candidate of input.scored) {
    if (!Number.isFinite(candidate.score) || candidate.score < 0 || candidate.score > 1) {
      unresolved.push({ candidate, reason: 'invalid_or_absent_score' });
      continue;
    }
    if (candidate.score < minimumScore) {
      unresolved.push({ candidate, reason: 'score_below_assignment_floor' });
      continue;
    }
    const key = edgeKey(candidate);
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    eligible.push(candidate);
  }
  for (const [key, count] of edgeCounts) if (count > 1) duplicateEdges.add(key);
  const uniqueEdges = eligible.filter((candidate) => {
    if (!duplicateEdges.has(edgeKey(candidate))) return true;
    unresolved.push({ candidate, reason: 'duplicate_candidate_edge' });
    return false;
  });

  for (const component of connectedComponents(uniqueEdges)) {
    const solution = solveMaximumWeightComponent(component);
    if (solution.selected.length === 0) continue;

    const isAmbiguous = solution.selected.some((edge) =>
      solveMaximumWeightComponent(component, edge).totalWeight === solution.totalWeight,
    );
    if (isAmbiguous) {
      for (const candidate of component.edges) {
        unresolved.push({
          candidate,
          reason: 'ambiguous_global_assignment_tie',
          componentMaximumScore: unscale(solution.totalWeight),
        });
      }
      continue;
    }

    const selectedEdges = new Set(solution.selected);
    for (const candidate of component.edges) {
      if (!selectedEdges.has(candidate)) {
        unresolved.push({
          candidate,
          reason: 'not_selected_by_higher_global_assignment',
          componentMaximumScore: unscale(solution.totalWeight),
        });
        continue;
      }
      selected.push({
        candidate,
        proof: 'unique_maximum_weight_assignment',
        componentMaximumScore: unscale(solution.totalWeight),
        componentCandidateCount: component.edges.length,
        nextRequiredGate: 'structural_topology_assessment',
      });
    }
  }

  return {
    selected: [...selected].sort((left, right) => compareCandidates(left.candidate, right.candidate)),
    unresolved: [...unresolved].sort((left, right) => compareCandidates(left.candidate, right.candidate)),
  };
}

type AssignmentComponent = Readonly<{
  oldNativeIds: readonly string[];
  newNativeIds: readonly string[];
  edges: readonly FingerprintScoredCandidate[];
}>;

function connectedComponents(edges: readonly FingerprintScoredCandidate[]): readonly AssignmentComponent[] {
  const oldToEdges = new Map<string, FingerprintScoredCandidate[]>();
  const newToEdges = new Map<string, FingerprintScoredCandidate[]>();
  for (const edge of edges) {
    addEdge(oldToEdges, edge.candidate.old.nativeId, edge);
    addEdge(newToEdges, edge.candidate.new.nativeId, edge);
  }

  const visitedEdges = new Set<FingerprintScoredCandidate>();
  const components: AssignmentComponent[] = [];
  for (const initial of edges) {
    if (visitedEdges.has(initial)) continue;
    const componentEdges = new Set<FingerprintScoredCandidate>();
    const oldIds = new Set<string>();
    const newIds = new Set<string>();
    const queue = [initial];
    while (queue.length > 0) {
      const edge = queue.pop();
      if (!edge || visitedEdges.has(edge)) continue;
      visitedEdges.add(edge);
      componentEdges.add(edge);
      const oldNativeId = edge.candidate.old.nativeId;
      const newNativeId = edge.candidate.new.nativeId;
      oldIds.add(oldNativeId);
      newIds.add(newNativeId);
      queue.push(...(oldToEdges.get(oldNativeId) ?? []), ...(newToEdges.get(newNativeId) ?? []));
    }
    components.push({
      oldNativeIds: [...oldIds].sort(),
      newNativeIds: [...newIds].sort(),
      edges: [...componentEdges],
    });
  }
  return components;
}

function addEdge(index: Map<string, FingerprintScoredCandidate[]>, id: string, edge: FingerprintScoredCandidate): void {
  const edges = index.get(id) ?? [];
  edges.push(edge);
  index.set(id, edges);
}

function solveMaximumWeightComponent(
  component: AssignmentComponent,
  forbidden?: FingerprintScoredCandidate,
): Readonly<{ selected: readonly FingerprintScoredCandidate[]; totalWeight: number }> {
  const edgeByPair = new Map<string, FingerprintScoredCandidate>();
  for (const edge of component.edges) if (edge !== forbidden) edgeByPair.set(edgeKey(edge), edge);
  const oldIds = component.oldNativeIds;
  const newIds = component.newNativeIds;
  const maxWeight = Math.max(...[...edgeByPair.values()].map((edge) => scaled(edge.score)), 0);
  const forbiddenCost = maxWeight + SCORE_SCALE;
  const costs = oldIds.map((oldNativeId) => [
    ...newIds.map((newNativeId) => {
      const edge = edgeByPair.get(edgeKeyForIds(oldNativeId, newNativeId));
      return edge ? maxWeight - scaled(edge.score) : forbiddenCost;
    }),
    ...oldIds.map(() => maxWeight),
  ]);
  const assignment = hungarianMinimumCost(costs);
  const selected = assignment.flatMap((column, row) => {
    if (column < 0 || column >= newIds.length) return [];
    const edge = edgeByPair.get(edgeKeyForIds(oldIds[row], newIds[column]));
    return edge ? [edge] : [];
  });
  return { selected, totalWeight: selected.reduce((total, edge) => total + scaled(edge.score), 0) };
}

/** Hungarian algorithm for a rectangular cost matrix with rows <= columns. */
function hungarianMinimumCost(costs: readonly (readonly number[])[]): readonly number[] {
  const rowCount = costs.length;
  if (rowCount === 0) return [];
  const columnCount = costs[0].length;
  const u = Array<number>(rowCount + 1).fill(0);
  const v = Array<number>(columnCount + 1).fill(0);
  const p = Array<number>(columnCount + 1).fill(0);
  const way = Array<number>(columnCount + 1).fill(0);

  for (let row = 1; row <= rowCount; row += 1) {
    p[0] = row;
    let column0 = 0;
    const minValue = Array<number>(columnCount + 1).fill(Number.POSITIVE_INFINITY);
    const used = Array<boolean>(columnCount + 1).fill(false);
    do {
      used[column0] = true;
      const currentRow = p[column0];
      let delta = Number.POSITIVE_INFINITY;
      let column1 = 0;
      for (let column = 1; column <= columnCount; column += 1) {
        if (used[column]) continue;
        const current = costs[currentRow - 1][column - 1] - u[currentRow] - v[column];
        if (current < minValue[column]) {
          minValue[column] = current;
          way[column] = column0;
        }
        if (minValue[column] < delta) {
          delta = minValue[column];
          column1 = column;
        }
      }
      for (let column = 0; column <= columnCount; column += 1) {
        if (used[column]) {
          u[p[column]] += delta;
          v[column] -= delta;
        } else {
          minValue[column] -= delta;
        }
      }
      column0 = column1;
    } while (p[column0] !== 0);

    do {
      const column1 = way[column0];
      p[column0] = p[column1];
      column0 = column1;
    } while (column0 !== 0);
  }

  const assignment = Array<number>(rowCount).fill(-1);
  for (let column = 1; column <= columnCount; column += 1) {
    if (p[column] !== 0) assignment[p[column] - 1] = column - 1;
  }
  return assignment;
}

function edgeKey(candidate: FingerprintScoredCandidate): string {
  return edgeKeyForIds(candidate.candidate.old.nativeId, candidate.candidate.new.nativeId);
}

function edgeKeyForIds(oldNativeId: string, newNativeId: string): string {
  return JSON.stringify([oldNativeId, newNativeId]);
}

function scaled(score: number): number {
  return Math.round(score * SCORE_SCALE);
}

function unscale(score: number): number {
  return score / SCORE_SCALE;
}

function compareCandidates(left: FingerprintScoredCandidate, right: FingerprintScoredCandidate): number {
  return left.candidate.old.nativeId.localeCompare(right.candidate.old.nativeId)
    || left.candidate.new.nativeId.localeCompare(right.candidate.new.nativeId);
}
