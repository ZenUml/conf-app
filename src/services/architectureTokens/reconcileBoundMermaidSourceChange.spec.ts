import { describe, expect, it } from 'vitest';
import { DiagramType, type Diagram } from '@/model/Diagram/Diagram';
import {
  mergeArchitectureTokenBindingMetadata,
  readArchitectureTokenBindingState,
  type ArchitectureTokenBindingStateV1,
} from '@/domain/architectureTokens/architectureTokenBindingState';
import { parseFlowchartSource } from '@/domain/architectureTokens/mermaidFlowchart';
import { prepareMermaidStaticIngestion } from './prepareMermaidStaticIngestion';

const before = 'flowchart TD\n  A[Orders API] --> B[Database]';
const shiftedAfter = 'flowchart TD\n  %% explanatory comment\n  A[Orders API] --> B[Database]';
const renamedAfter = 'flowchart TD\n  A[Orders Gateway] --> B[Database]';

describe('bound Mermaid source changes', () => {
  it('retains a binding only after every stored occurrence exactly relocates to one unchanged canonical node', async () => {
    const diagram = await boundDiagram(before);
    const original = currentState(diagram);
    const originalBinding = original.bindings[0];

    diagram.architectureTokenBindingLoadedSource = before;
    diagram.mermaidCode = shiftedAfter;

    await expect(prepareMermaidStaticIngestion(diagram, testDependencies())).resolves.toMatchObject({
      kind: 'reconciled',
      sourceRevisionState: 'reconciled',
    });

    const reconciled = currentState(diagram);
    expect(reconciled.currentRevisionId).not.toBe(original.currentRevisionId);
    expect(reconciled.bindings).toEqual([
      expect.objectContaining({
        tokenBindingId: originalBinding.tokenBindingId,
        logicalTokenId: originalBinding.logicalTokenId,
        status: 'confirmed',
        confirmationMethod: 'reconciliation',
        diagramElementId: expect.not.stringContaining(originalBinding.diagramElementId),
      }),
    ]);
    expect(reconciled.bindings[0].diagramElementId).not.toBe(originalBinding.diagramElementId);
    expect(reconciled.audit.at(-1)).toEqual(expect.objectContaining({
      kind: 'reconciliation',
      outcome: 'accepted',
      reasons: expect.arrayContaining([
        'exact_source_relocation_all_occurrences',
        'static_fingerprint_exact',
        'binding_retained',
      ]),
    }));
  });

  it('preserves the prior binding as unresolved when a changed occurrence has no exact relocation evidence', async () => {
    const diagram = await boundDiagram(before);
    const original = currentState(diagram);
    const originalBinding = original.bindings[0];

    diagram.architectureTokenBindingLoadedSource = before;
    diagram.mermaidCode = renamedAfter;

    await expect(prepareMermaidStaticIngestion(diagram, testDependencies())).resolves.toMatchObject({
      kind: 'reconciled',
      sourceRevisionState: 'reconciled',
    });

    const reconciled = currentState(diagram);
    expect(reconciled.bindings).toEqual([
      expect.objectContaining({
        tokenBindingId: originalBinding.tokenBindingId,
        diagramElementId: originalBinding.diagramElementId,
        status: 'unresolved',
      }),
    ]);
    expect(reconciled.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        diagramElementId: originalBinding.diagramElementId,
        lifecycleStatus: 'unresolved',
      }),
    ]));
    expect(reconciled.audit.at(-1)).toEqual(expect.objectContaining({
      kind: 'reconciliation',
      outcome: 'unresolved',
      reasons: expect.arrayContaining(['no_safe_exact_relocation']),
    }));
  });

  it('refuses the save without changing metadata when the session before-source is not the stored current revision', async () => {
    const diagram = await boundDiagram(before);
    const metadataBeforeSave = structuredClone(diagram.metadata);
    diagram.architectureTokenBindingLoadedSource = 'flowchart TD\n  X[Unrelated]';
    diagram.mermaidCode = shiftedAfter;

    await expect(prepareMermaidStaticIngestion(diagram, testDependencies())).rejects.toMatchObject({
      name: 'ArchitectureTokenStaticIngestionError',
      reason: 'source_change_requires_reconciliation',
    });

    expect(diagram.metadata).toEqual(metadataBeforeSave);
  });
});

async function boundDiagram(source: string): Promise<Diagram> {
  const diagram = { diagramType: DiagramType.Mermaid, mermaidCode: source, metadata: { preserve: 'unrelated' } } as Diagram;
  await prepareMermaidStaticIngestion(diagram, testDependencies());
  const state = currentState(diagram);
  const boundElement = state.elements.find((element) => element.diagramElementId === state.revisionElements[0].diagramElementId);
  if (!boundElement) throw new Error('test fixture requires a static element');
  const merged = mergeArchitectureTokenBindingMetadata(diagram.metadata, {
    ...state,
    bindings: [{
      tokenBindingId: 'binding-orders',
      diagramElementId: boundElement.diagramElementId,
      logicalTokenId: 'logical-orders',
      status: 'confirmed' as const,
      confirmationMethod: 'user' as const,
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
      provenance: { source: 'user_confirmation' as const, recordedAt: '2026-08-25T00:00:00.000Z' },
    }],
  });
  if (merged.kind !== 'ok') throw new Error('test fixture state must encode');
  diagram.metadata = merged.value;
  return diagram;
}

function currentState(diagram: Diagram): ArchitectureTokenBindingStateV1 {
  const decoded = readArchitectureTokenBindingState(diagram.metadata);
  if (decoded.kind !== 'ok' || !decoded.value) throw new Error('test fixture requires a state');
  return decoded.value;
}

function testDependencies() {
  let sequence = 0;
  return {
    validate: async (source: string) => {
      const parsed = parseFlowchartSource(source);
      if (parsed.kind !== 'ok') return { kind: 'unsupported' as const, reason: parsed.reason };
      return {
        kind: 'ok' as const,
        model: parsed.model,
        locatorEvidence: { kind: 'jison_preferred' as const, adapterVersion: 'test', occurrenceCount: parsed.model.nodes.length },
      };
    },
    createId: () => `id-${++sequence}`,
    now: () => '2026-08-25T00:00:00.000Z',
  };
}
