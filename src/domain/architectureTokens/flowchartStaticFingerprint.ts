import type { CanonicalNode } from './mermaidFlowchart';

export interface StaticFlowchartNodeFingerprint {
  readonly fingerprintVersion: 'flowchart_node_static_v1';
  /** This evidence describes one parsed revision and never claims continuity. */
  readonly provenance: 'single_revision_static';
  readonly syntax: Readonly<{
    kind: 'node';
    nativeId: string;
    normalizedLabel: string | null;
    shape: string | null;
    canonicalSyntaxKey: string;
  }>;
  /** Facts available from this canonical revision; no neighbor mapping occurs. */
  readonly structural: Readonly<{
    containerPath: readonly string[];
    statementContexts: readonly string[];
    incidentNeighborNativeIds: readonly string[];
  }>;
}

/**
 * Produces deterministic syntax facts for a canonical node in one source
 * revision. It does not accept a second revision and cannot reconcile IDs.
 */
export function fingerprintStaticFlowchartNode(node: CanonicalNode): StaticFlowchartNodeFingerprint {
  const normalizedLabel = normalizeNullable(node.label);
  const shape = node.shape;
  return {
    fingerprintVersion: 'flowchart_node_static_v1',
    provenance: 'single_revision_static',
    syntax: {
      kind: 'node',
      nativeId: node.nativeId,
      normalizedLabel,
      shape,
      canonicalSyntaxKey: JSON.stringify({
        fingerprintVersion: 'flowchart_node_static_v1',
        kind: 'node',
        nativeId: node.nativeId,
        shape,
        normalizedLabel,
      }),
    },
    structural: {
      containerPath: normalizeSequence(node.containerPath),
      statementContexts: normalizeSorted(node.statementContexts),
      incidentNeighborNativeIds: normalizeSorted(node.incidentNativeIds),
    },
  };
}

function normalizeNullable(value: string | null): string | null {
  return value === null ? null : normalizeRequired(value);
}

function normalizeSequence(values: readonly string[]): readonly string[] {
  return values.map(normalizeRequired);
}

function normalizeSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(normalizeRequired))].sort();
}

function normalizeRequired(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
