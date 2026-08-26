import { describe, expect, it } from 'vitest';
import { resolveArchitectureTokenDirectory } from '@/domain/architectureTokens/architectureTokenDirectory';
import { readArchitectureTokenBindingState } from '@/domain/architectureTokens/architectureTokenBindingState';
import { DiagramType, type Diagram } from '@/model/Diagram/Diagram';
import { prepareMermaidStaticIngestion } from './prepareMermaidStaticIngestion';
import {
  applyExplicitArchitectureTokenBind,
  applyExplicitArchitectureTokenUnbind,
} from './applyExplicitArchitectureTokenBinding';

describe('explicit Architecture Token binding Diagram seam', () => {
  it('merges an explicit binding into only the canonical metadata namespace', async () => {
    const diagram = await capturedDiagram();
    const directory = resolveArchitectureTokenDirectory([{
      logicalTokenId: 'logical-orders',
      tokenId: 'enterprise-orders',
      displayName: 'Orders service',
    }]);
    if (directory.kind !== 'available') throw new Error('fixture directory must be available');
    const elementId = availableState(diagram).elements[0].diagramElementId;

    const result = await applyExplicitArchitectureTokenBind({
      diagram,
      directory,
      diagramElementId: elementId,
      logicalTokenId: 'logical-orders',
      createId: () => 'binding-orders',
      now: () => '2026-08-26T00:00:00.000Z',
    });

    expect(result).toMatchObject({ kind: 'updated', action: 'bound' });
    expect(diagram.metadata).toMatchObject({ keep: 'unrelated metadata' });
    const decoded = readArchitectureTokenBindingState(diagram.metadata);
    expect(decoded).toMatchObject({ kind: 'ok' });
    if (decoded.kind !== 'ok' || !decoded.value) return;
    expect(decoded.value.bindings).toMatchObject([{ logicalTokenId: 'logical-orders' }]);
    expect(diagram.architectureTokenBindingReadState).toMatchObject({ kind: 'available' });

    // The normal save preparation sees the same source revision and retains
    // this explicitly applied binding instead of creating a replacement state.
    await expect(prepareMermaidStaticIngestion(diagram, testDependencies())).resolves.toEqual({
      kind: 'unchanged',
      sourceRevisionState: 'unchanged',
    });
    expect(availableState(diagram).bindings).toMatchObject([{ logicalTokenId: 'logical-orders' }]);
  });

  it('leaves metadata unchanged when source evidence is not current', async () => {
    const diagram = await capturedDiagram();
    const metadataBefore = structuredClone(diagram.metadata);
    const elementId = availableState(diagram).elements[0].diagramElementId;
    diagram.architectureTokenBindingReadState = {
      kind: 'stale',
      reason: 'source_hash_mismatch',
      sourceRevisionId: 'revision-old',
    };
    const directory = resolveArchitectureTokenDirectory([]);
    if (directory.kind !== 'available') throw new Error('empty directory is valid');

    await expect(applyExplicitArchitectureTokenBind({
      diagram,
      directory,
      diagramElementId: elementId,
      logicalTokenId: 'logical-orders',
    })).resolves.toEqual({ kind: 'rejected', reason: 'binding_evidence_unavailable' });
    expect(diagram.metadata).toEqual(metadataBefore);
  });

  it('unmerges only the selected active binding and preserves unrelated metadata', async () => {
    const diagram = await capturedDiagram();
    const directory = resolveArchitectureTokenDirectory([{
      logicalTokenId: 'logical-orders',
      displayName: 'Orders service',
    }]);
    if (directory.kind !== 'available') throw new Error('fixture directory must be available');
    const elementId = availableState(diagram).elements[0].diagramElementId;
    const bound = await applyExplicitArchitectureTokenBind({
      diagram,
      directory,
      diagramElementId: elementId,
      logicalTokenId: 'logical-orders',
      createId: () => 'binding-orders',
      now: () => '2026-08-26T00:00:00.000Z',
    });
    if (bound.kind !== 'updated') throw new Error('fixture bind must succeed');

    const result = await applyExplicitArchitectureTokenUnbind({
      diagram,
      tokenBindingId: 'binding-orders',
      createId: () => 'audit-unbind',
      now: () => '2026-08-26T00:01:00.000Z',
    });

    expect(result).toMatchObject({ kind: 'updated', action: 'unbound' });
    expect(diagram.metadata).toMatchObject({ keep: 'unrelated metadata' });
    expect(availableState(diagram).bindings).toEqual([]);
  });
});

function availableState(diagram: Diagram) {
  const readState = diagram.architectureTokenBindingReadState;
  if (readState?.kind !== 'available') throw new Error('fixture binding state must be available');
  return readState.state;
}

async function capturedDiagram() {
  const diagram = {
    diagramType: DiagramType.Mermaid,
    mermaidCode: 'flowchart TD\n  A[Orders service] --> B[Database]',
    metadata: { keep: 'unrelated metadata' },
  } as Diagram;
  await prepareMermaidStaticIngestion(diagram, testDependencies());
  const { readMermaidArchitectureTokenBinding } = await import('./readMermaidArchitectureTokenBinding');
  diagram.architectureTokenBindingReadState = await readMermaidArchitectureTokenBinding(diagram);
  diagram.architectureTokenBindingLoadedSource = diagram.mermaidCode;
  return diagram;
}

function testDependencies() {
  return {
    validate: async () => ({
      kind: 'ok' as const,
      model: {
        kind: 'flowchart' as const,
        direction: 'TD' as const,
        edges: [],
        subgraphs: [],
        nodes: ['A', 'B'].map((nativeId) => ({
          kind: 'node' as const,
          nativeId,
          label: nativeId === 'A' ? 'Orders service' : 'Database',
          shape: 'square',
          containerPath: [],
          primaryOccurrence: occurrence(nativeId),
          occurrences: [occurrence(nativeId)],
          incidentNativeIds: [],
          statementContexts: [nativeId],
        })),
      },
      locatorEvidence: { kind: 'jison_preferred' as const, adapterVersion: 'test', occurrenceCount: 2 },
    }),
    createId: (() => {
      let count = 0;
      return () => `id-${++count}`;
    })(),
    now: () => '2026-08-25T00:00:00.000Z',
  };
}

function occurrence(nativeId: string) {
  return {
    role: 'edge_endpoint' as const,
    span: { startByte: nativeId === 'A' ? 13 : 36, endByte: nativeId === 'A' ? 14 : 37 },
    statementSpan: { startByte: 13, endByte: 37 },
  };
}
