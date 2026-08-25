import { describe, expect, it } from 'vitest';
import { DiagramType, type Diagram } from '@/model/Diagram/Diagram';
import type { ArchitectureTokenBindingStateV1 } from '@/domain/architectureTokens/architectureTokenBindingState';
import { prepareMermaidStaticIngestion } from './prepareMermaidStaticIngestion';
import { readMermaidArchitectureTokenBinding } from './readMermaidArchitectureTokenBinding';

const source = 'flowchart TD\n  A[Orders API] --> B[Database]';

describe('readMermaidArchitectureTokenBinding', () => {
  it('makes a valid current revision available without changing the Diagram metadata', async () => {
    const diagram = await capturedDiagram({ keep: 'unrelated-metadata' });
    const metadataBeforeRead = structuredClone(diagram.metadata);

    const result = await readMermaidArchitectureTokenBinding(diagram);

    expect(result).toMatchObject({
      kind: 'available',
      sourceRevision: { validationStatus: 'valid' },
      state: { schemaVersion: 'architectureTokenBindingV1', sourceType: 'mermaid_flowchart' },
    });
    expect(diagram.metadata).toEqual(metadataBeforeRead);
    expect(diagram.metadata).toMatchObject({ keep: 'unrelated-metadata' });
  });

  it('marks a valid envelope stale rather than trusting it when the authoritative source differs', async () => {
    const diagram = await capturedDiagram();
    const metadataBeforeRead = structuredClone(diagram.metadata);
    diagram.mermaidCode = 'flowchart TD\n  A[Orders API] --> C[New Database]';

    const result = await readMermaidArchitectureTokenBinding(diagram);

    expect(result).toEqual(expect.objectContaining({
      kind: 'stale',
      reason: 'source_hash_mismatch',
      sourceRevisionId: expect.any(String),
    }));
    expect(result).not.toHaveProperty('state');
    expect(result).not.toHaveProperty('reconciliationHistory');
    expect(diagram.metadata).toEqual(metadataBeforeRead);
  });

  it('projects reconciliation audits newest-first, with allow-listed categories and a max history of three', async () => {
    const diagram = await capturedDiagram();
    const state = bindingState(diagram);
    state.audit = [
      audit('reconciliation-1', state.currentRevisionId, '2026-08-21T00:00:00.000Z', 'accepted', [
        'binding_retained',
      ]),
      audit('reconciliation-2', state.currentRevisionId, '2026-08-23T00:00:00.000Z', 'unresolved', [
        'ambiguous_split_merge',
        'future_private_reason',
      ]),
      audit('reconciliation-3', state.currentRevisionId, '2026-08-24T00:00:00.000Z', 'rejected', [
        'delete_recreate_orphaned',
        'customer-secret-label',
      ]),
      audit('reconciliation-4', state.currentRevisionId, '2026-08-25T00:00:00.000Z', 'accepted', [
        'exact_source_relocation_all_occurrences',
        'static_fingerprint_exact',
        'binding_retained',
      ]),
    ];
    diagram.metadata = { architectureTokenBindingV1: state };

    const result = await readMermaidArchitectureTokenBinding(diagram);

    expect(result).toMatchObject({
      kind: 'available',
      reconciliationHistory: [
        { outcome: 'accepted', categories: ['exact_relocation', 'fingerprint_match', 'binding_retained'] },
        { outcome: 'rejected', categories: ['binding_orphaned'] },
        { outcome: 'unresolved', categories: ['ambiguous_structure'] },
      ],
    });
    expect(result).not.toHaveProperty('audit');
    expect(JSON.stringify(result.reconciliationHistory)).not.toContain('future_private_reason');
    expect(JSON.stringify(result.reconciliationHistory)).not.toContain('customer-secret-label');
  });

  it('reports no namespace as not configured and preserves unrelated metadata', async () => {
    const diagram = {
      diagramType: DiagramType.Mermaid,
      mermaidCode: source,
      metadata: { keep: 'unrelated-metadata' },
    } as Diagram;
    const metadataBeforeRead = structuredClone(diagram.metadata);

    await expect(readMermaidArchitectureTokenBinding(diagram)).resolves.toEqual({ kind: 'not_configured' });
    expect(diagram.metadata).toEqual(metadataBeforeRead);
  });

  it.each([
    ['malformed', { architectureTokenBindingV1: { schemaVersion: 'unknown' } }, 'invalid_state'],
    ['oversize', { architectureTokenBindingV1: oversizedState() }, 'oversize_state'],
  ] as const)('does not surface %s stored state as trusted evidence', async (_caseName, metadata, reason) => {
    const diagram = {
      diagramType: DiagramType.Mermaid,
      mermaidCode: source,
      metadata,
    } as Diagram;
    const metadataBeforeRead = structuredClone(diagram.metadata);

    await expect(readMermaidArchitectureTokenBinding(diagram)).resolves.toEqual({ kind: 'untrusted', reason });
    await expect(readMermaidArchitectureTokenBinding(diagram)).resolves.not.toHaveProperty('reconciliationHistory');
    expect(diagram.metadata).toEqual(metadataBeforeRead);
  });
});

async function capturedDiagram(metadata?: object): Promise<Diagram> {
  const diagram = {
    diagramType: DiagramType.Mermaid,
    mermaidCode: source,
    metadata,
  } as Diagram;
  await prepareMermaidStaticIngestion(diagram, {
    validate: async () => ({
      kind: 'ok',
      model: {
        kind: 'flowchart',
        direction: 'TD',
        edges: [],
        subgraphs: [],
        nodes: [node('A', 'Orders API'), node('B', 'Database')],
      },
      locatorEvidence: { kind: 'jison_preferred', adapterVersion: 'test', occurrenceCount: 2 },
    }),
    createId: (() => {
      let count = 0;
      return () => `id-${++count}`;
    })(),
    now: () => '2026-08-25T00:00:00.000Z',
  });
  return diagram;
}

function bindingState(diagram: Diagram) {
  return structuredClone((diagram.metadata as {
    architectureTokenBindingV1: ArchitectureTokenBindingStateV1;
  }).architectureTokenBindingV1);
}

function audit(
  auditId: string,
  sourceRevisionId: string,
  recordedAt: string,
  outcome: 'accepted' | 'rejected' | 'unresolved',
  reasons: readonly string[],
) {
  return {
    auditId,
    kind: 'reconciliation' as const,
    sourceRevisionId,
    outcome,
    reasons,
    algorithmVersion: 'policy-1',
    recordedAt,
  };
}

function node(nativeId: string, label: string) {
  const occurrence = {
    role: 'edge_endpoint' as const,
    span: { startByte: 0, endByte: 1 },
    statementSpan: { startByte: 0, endByte: 1 },
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
    statementContexts: [nativeId],
  };
}

function oversizedState() {
  return {
    schemaVersion: 'architectureTokenBindingV1',
    sourceType: 'mermaid_flowchart',
    currentRevisionId: 'r1',
    revisions: [{
      sourceRevisionId: 'r1',
      sourceId: 'source-1',
      normalizedSourceSha256: 'a'.repeat(64),
      parserVersion: 'parser-1',
      validationStatus: 'valid',
      capturedAt: '2026-08-25T00:00:00.000Z',
    }],
    elements: [],
    revisionElements: [],
    bindings: [],
    audit: [{
      auditId: 'audit-1',
      kind: 'static_ingestion',
      sourceRevisionId: 'r1',
      outcome: 'accepted',
      reasons: ['🙂'.repeat(32 * 1024)],
      algorithmVersion: 'policy-1',
      recordedAt: '2026-08-25T00:00:00.000Z',
    }],
  };
}
