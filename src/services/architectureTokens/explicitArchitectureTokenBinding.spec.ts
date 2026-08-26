import { describe, expect, it } from 'vitest';
import { resolveArchitectureTokenDirectory } from '@/domain/architectureTokens/architectureTokenDirectory';
import { DiagramType, type Diagram } from '@/model/Diagram/Diagram';
import { prepareMermaidStaticIngestion } from './prepareMermaidStaticIngestion';
import { readMermaidArchitectureTokenBinding } from './readMermaidArchitectureTokenBinding';
import {
  bindArchitectureTokenExplicitly,
  unbindArchitectureTokenExplicitly,
} from './explicitArchitectureTokenBinding';

describe('explicit Architecture Token binding command', () => {
  it('binds an approved local-directory token to one source-current Flowchart node and records source-free provenance', async () => {
    const readState = await availableReadState();
    const directory = resolveArchitectureTokenDirectory([{
      logicalTokenId: 'logical-orders',
      tokenId: 'enterprise-orders',
      displayName: 'Orders service',
    }]);
    if (directory.kind !== 'available') throw new Error('fixture directory must be available');

    const result = bindArchitectureTokenExplicitly({
      readState,
      directory,
      diagramElementId: readState.state.elements[0].diagramElementId,
      logicalTokenId: 'logical-orders',
      createId: () => 'binding-orders',
      now: () => '2026-08-26T00:00:00.000Z',
    });

    expect(result).toMatchObject({ kind: 'updated', action: 'bound' });
    if (result.kind !== 'updated') return;
    expect(result.state.bindings).toMatchObject([{
      tokenBindingId: 'binding-orders',
      logicalTokenId: 'logical-orders',
      tokenId: 'enterprise-orders',
      status: 'confirmed',
      confirmationMethod: 'user',
      provenance: { source: 'user_confirmation' },
    }]);
    expect(result.state.audit.at(-1)).toMatchObject({
      kind: 'binding_action',
      outcome: 'accepted',
      reasons: ['user_binding_created'],
    });
    expect(JSON.stringify(result.state.audit.at(-1))).not.toContain('Orders service');
  });

  it('does not overwrite an existing active binding for the same logical Flowchart node', async () => {
    const readState = await availableReadState();
    const directory = availableDirectory();
    const first = bindArchitectureTokenExplicitly({
      readState,
      directory,
      diagramElementId: readState.state.elements[0].diagramElementId,
      logicalTokenId: 'logical-orders',
      createId: () => 'binding-orders',
      now: () => '2026-08-26T00:00:00.000Z',
    });
    if (first.kind !== 'updated') throw new Error('fixture bind must succeed');

    expect(bindArchitectureTokenExplicitly({
      readState: { ...readState, state: first.state },
      directory,
      diagramElementId: readState.state.elements[0].diagramElementId,
      logicalTokenId: 'logical-payments',
      createId: () => 'binding-payments',
      now: () => '2026-08-26T00:00:00.000Z',
    })).toEqual({ kind: 'rejected', reason: 'active_binding_exists' });
  });

  it('removes only the selected active binding and leaves a source-free unbind audit', async () => {
    const readState = await availableReadState();
    const bound = bindArchitectureTokenExplicitly({
      readState,
      directory: availableDirectory(),
      diagramElementId: readState.state.elements[0].diagramElementId,
      logicalTokenId: 'logical-orders',
      createId: () => 'binding-orders',
      now: () => '2026-08-26T00:00:00.000Z',
    });
    if (bound.kind !== 'updated') throw new Error('fixture bind must succeed');

    const result = unbindArchitectureTokenExplicitly({
      readState: { ...readState, state: bound.state },
      tokenBindingId: 'binding-orders',
      createId: () => 'audit-unbind',
      now: () => '2026-08-26T00:01:00.000Z',
    });

    expect(result).toMatchObject({ kind: 'updated', action: 'unbound' });
    if (result.kind !== 'updated') return;
    expect(result.state.bindings).toEqual([]);
    expect(result.state.audit.at(-1)).toMatchObject({
      auditId: 'audit-unbind',
      kind: 'binding_action',
      reasons: ['user_binding_removed'],
    });
  });

  it('fails closed without current evidence or an approved directory entry', async () => {
    const readState = await availableReadState();
    const directory = resolveArchitectureTokenDirectory([]);
    if (directory.kind !== 'available') throw new Error('empty directory is valid');

    expect(bindArchitectureTokenExplicitly({
      readState: { kind: 'stale', reason: 'source_hash_mismatch', sourceRevisionId: 'revision-current' },
      directory,
      diagramElementId: readState.state.elements[0].diagramElementId,
      logicalTokenId: 'logical-orders',
    })).toEqual({ kind: 'rejected', reason: 'binding_evidence_unavailable' });

    expect(bindArchitectureTokenExplicitly({
      readState,
      directory,
      diagramElementId: readState.state.elements[0].diagramElementId,
      logicalTokenId: 'logical-orders',
    })).toEqual({ kind: 'rejected', reason: 'token_not_in_directory' });
  });
});

function availableDirectory() {
  const directory = resolveArchitectureTokenDirectory([
    { logicalTokenId: 'logical-orders', tokenId: 'enterprise-orders', displayName: 'Orders service' },
    { logicalTokenId: 'logical-payments', tokenId: 'enterprise-payments', displayName: 'Payments service' },
  ]);
  if (directory.kind !== 'available') throw new Error('fixture directory must be available');
  return directory;
}

async function availableReadState() {
  const diagram = {
    diagramType: DiagramType.Mermaid,
    mermaidCode: 'flowchart TD\n  A[Orders service] --> B[Database]',
  } as Diagram;
  await prepareMermaidStaticIngestion(diagram, {
    validate: async () => ({
      kind: 'ok',
      model: {
        kind: 'flowchart',
        direction: 'TD',
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
      locatorEvidence: { kind: 'jison_preferred', adapterVersion: 'test', occurrenceCount: 2 },
    }),
    createId: (() => {
      let count = 0;
      return () => `id-${++count}`;
    })(),
    now: () => '2026-08-25T00:00:00.000Z',
  });
  const readState = await readMermaidArchitectureTokenBinding(diagram);
  if (readState.kind !== 'available') throw new Error('fixture state must be available');
  return readState;
}

function occurrence(nativeId: string) {
  return {
    role: 'edge_endpoint' as const,
    span: { startByte: nativeId === 'A' ? 13 : 36, endByte: nativeId === 'A' ? 14 : 37 },
    statementSpan: { startByte: 13, endByte: 37 },
  };
}
