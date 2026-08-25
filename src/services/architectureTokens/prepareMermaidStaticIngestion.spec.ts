import { describe, expect, it } from 'vitest';
import { DiagramType, type Diagram } from '@/model/Diagram/Diagram';
import { mergeArchitectureTokenBindingMetadata, readArchitectureTokenBindingState } from '@/domain/architectureTokens/architectureTokenBindingState';
import { prepareMermaidStaticIngestion, ArchitectureTokenStaticIngestionError } from './prepareMermaidStaticIngestion';

const source = 'flowchart TD\n  A[Orders API] --> B[Database]';

function mermaidDiagram(metadata?: object): Diagram {
  return { diagramType: DiagramType.Mermaid, mermaidCode: source, metadata } as Diagram;
}

describe('prepareMermaidStaticIngestion', () => {
  it('captures validated Flowchart facts into only the binding metadata namespace', async () => {
    const diagram = mermaidDiagram({ comment: 'preserve-me' });

    const result = await prepareMermaidStaticIngestion(diagram, dependencies());

    expect(result).toMatchObject({ kind: 'captured', sourceRevisionState: 'captured' });
    const decoded = readArchitectureTokenBindingState(diagram.metadata);
    expect(decoded.kind).toBe('ok');
    if (decoded.kind !== 'ok' || !decoded.value) return;
    expect(diagram.metadata).toMatchObject({ comment: 'preserve-me' });
    expect(decoded.value.revisions).toHaveLength(1);
    expect(decoded.value.revisions[0]).toMatchObject({ validationStatus: 'valid', normalizedSourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(decoded.value.elements.map(({ kind }) => kind)).toEqual(['node', 'node']);
    expect(decoded.value.revisionElements.flatMap(({ locators }) => locators).every(({ locatorKind }) => locatorKind === 'utf8_byte_span')).toBe(true);
    expect(decoded.value.audit[0].reasons).toContain('jison_preferred');
  });

  it('does not invent a new revision when the current source hash is unchanged', async () => {
    const diagram = mermaidDiagram();
    const first = await prepareMermaidStaticIngestion(diagram, dependencies());
    expect(first.kind).toBe('captured');
    const previousMetadata = diagram.metadata;

    const second = await prepareMermaidStaticIngestion(diagram, dependencies());

    expect(second).toEqual({ kind: 'unchanged', sourceRevisionState: 'unchanged' });
    expect(diagram.metadata).toBe(previousMetadata);
  });

  it('records a rejected Jison adapter as static evidence without changing canonical locator facts', async () => {
    const diagram = mermaidDiagram();

    await prepareMermaidStaticIngestion(diagram, dependencies({ locatorEvidence: 'legacy_handwritten' }));

    const decoded = readArchitectureTokenBindingState(diagram.metadata);
    expect(decoded.kind).toBe('ok');
    if (decoded.kind !== 'ok' || !decoded.value) return;
    expect(decoded.value.audit[0].reasons).toContain('legacy_handwritten');
    expect(decoded.value.revisionElements).toHaveLength(2);
  });

  it('leaves metadata untouched for Mermaid-invalid or owned-parser-unsupported source', async () => {
    const metadata = { comment: 'do-not-change' };
    const invalid = mermaidDiagram(metadata);
    const unsupported = mermaidDiagram(metadata);

    await expect(prepareMermaidStaticIngestion(invalid, dependencies({ validationKind: 'invalid' }))).resolves.toEqual({
      kind: 'invalid', sourceRevisionState: 'invalid',
    });
    await expect(prepareMermaidStaticIngestion(unsupported, dependencies({ validationKind: 'unsupported' }))).resolves.toEqual({
      kind: 'unsupported', sourceRevisionState: 'unsupported',
    });
    expect(invalid.metadata).toBe(metadata);
    expect(unsupported.metadata).toBe(metadata);
  });

  it('fails closed rather than overwriting malformed existing state', async () => {
    const diagram = mermaidDiagram({ architectureTokenBindingV1: { schemaVersion: 'wrong' } });

    await expect(prepareMermaidStaticIngestion(diagram, dependencies())).rejects.toMatchObject({
      name: 'ArchitectureTokenStaticIngestionError',
      reason: 'invalid_state',
    });
  });

  it('refuses a changed source when an existing state contains a binding', async () => {
    const diagram = mermaidDiagram();
    await prepareMermaidStaticIngestion(diagram, dependencies());
    const current = readArchitectureTokenBindingState(diagram.metadata);
    expect(current.kind).toBe('ok');
    if (current.kind !== 'ok' || !current.value) return;
    const stateWithBinding = {
      ...current.value,
      bindings: [{
        tokenBindingId: 'binding-1',
        diagramElementId: current.value.elements[0].diagramElementId,
        logicalTokenId: 'logical-token-1',
        status: 'confirmed' as const,
        confirmationMethod: 'user' as const,
        createdAt: '2026-08-25T00:00:00.000Z',
        updatedAt: '2026-08-25T00:00:00.000Z',
        provenance: { source: 'user_confirmation' as const, recordedAt: '2026-08-25T00:00:00.000Z' },
      }],
    };
    const merged = mergeArchitectureTokenBindingMetadata(diagram.metadata, stateWithBinding);
    expect(merged.kind).toBe('ok');
    if (merged.kind !== 'ok') return;
    diagram.metadata = merged.value;
    diagram.mermaidCode = 'flowchart TD\n  X --> Y';

    await expect(prepareMermaidStaticIngestion(diagram, dependencies())).rejects.toBeInstanceOf(ArchitectureTokenStaticIngestionError);
  });
});

function dependencies(options: Readonly<{
  validationKind?: 'ok' | 'invalid' | 'unsupported';
  locatorEvidence?: 'jison_preferred' | 'legacy_handwritten';
}> = {}) {
  const validationKind = options.validationKind ?? 'ok';
  return {
    validate: async () => validationKind === 'invalid'
      ? { kind: 'invalid' as const, error: 'invalid' }
      : validationKind === 'unsupported'
        ? { kind: 'unsupported' as const, reason: 'unsupported_flowchart_statement' }
        : {
          kind: 'ok' as const,
          model: {
            kind: 'flowchart' as const,
            direction: 'TD',
            edges: [],
            subgraphs: [],
            nodes: [
              node('A', 'Orders API', 14, 27),
              node('B', 'Database', 32, 43),
            ],
          },
          locatorEvidence: options.locatorEvidence === 'legacy_handwritten'
            ? { kind: 'legacy_handwritten' as const, reason: 'test_adapter_rejected' }
            : { kind: 'jison_preferred' as const, adapterVersion: 'test', occurrenceCount: 2 },
        },
    createId: (() => {
      let count = 0;
      return () => `id-${++count}`;
    })(),
    now: () => '2026-08-25T00:00:00.000Z',
  };
}

function node(nativeId: string, label: string, startByte: number, endByte: number) {
  const occurrence = {
    role: 'edge_endpoint' as const,
    span: { startByte, endByte },
    statementSpan: { startByte: 2, endByte: 43 },
  };
  return {
    kind: 'node' as const,
    nativeId,
    label,
    shape: 'square',
    containerPath: [],
    primaryOccurrence: occurrence,
    occurrences: [occurrence],
    incidentNativeIds: [],
    statementContexts: [`${nativeId}[${label}]`],
  };
}
