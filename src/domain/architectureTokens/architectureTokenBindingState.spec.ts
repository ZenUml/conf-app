import { describe, expect, it } from 'vitest';
import {
  ARCHITECTURE_TOKEN_BINDING_MAX_BYTES,
  encodeArchitectureTokenBindingState,
  mergeArchitectureTokenBindingMetadata,
  readArchitectureTokenBindingState,
  type ArchitectureTokenBindingStateV1,
} from './architectureTokenBindingState';

const validState: ArchitectureTokenBindingStateV1 = {
  schemaVersion: 'architectureTokenBindingV1',
  sourceType: 'mermaid_flowchart',
  currentRevisionId: 'revision-2',
  revisions: [
    {
      sourceRevisionId: 'revision-2',
      sourceId: 'diagram-source',
      parentSourceRevisionId: 'revision-1',
      normalizedSourceSha256: 'a'.repeat(64),
      parserVersion: 'mermaid-flowchart-canonical-v1',
      validationStatus: 'valid',
      capturedAt: '2026-08-25T00:00:00.000Z',
    },
  ],
  elements: [
    {
      diagramElementId: 'element-orders',
      kind: 'node',
      createdInRevisionId: 'revision-2',
      lifecycleStatus: 'active',
    },
  ],
  revisionElements: [
    {
      sourceRevisionId: 'revision-2',
      diagramElementId: 'element-orders',
      primaryLocatorId: 'locator-orders-0',
      locators: [
        {
          locatorId: 'locator-orders-0',
          sourceRevisionId: 'revision-2',
          diagramElementId: 'element-orders',
          locatorKind: 'utf8_byte_span',
          spanStartByte: 16,
          spanEndByte: 31,
          statementSpanStartByte: 16,
          statementSpanEndByte: 31,
          occurrenceRole: 'declaration',
          occurrenceIndex: 0,
          nativeId: 'orders',
        },
      ],
      fingerprint: {
        fingerprintVersion: 'flowchart_node_static_v1',
        nativeId: 'orders',
        normalizedLabel: 'orders api',
        shape: 'square',
        containerPath: [],
        statementContexts: ['orders[Orders API]'],
        neighborNativeIds: ['database'],
      },
      provenance: {
        extraction: 'static_source_ingestion',
        parserVersion: 'mermaid-flowchart-canonical-v1',
        policyVersion: 'architecture-token-binding-v1',
        recordedAt: '2026-08-25T00:00:00.000Z',
      },
    },
  ],
  bindings: [
    {
      tokenBindingId: 'binding-orders',
      diagramElementId: 'element-orders',
      logicalTokenId: 'logical-token-orders',
      tokenId: 'enterprise-token-orders',
      status: 'confirmed',
      confirmationMethod: 'user',
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
      provenance: {
        source: 'user_confirmation',
        recordedAt: '2026-08-25T00:00:00.000Z',
      },
    },
  ],
  audit: [
    {
      auditId: 'audit-ingestion-2',
      kind: 'static_ingestion',
      sourceRevisionId: 'revision-2',
      outcome: 'accepted',
      reasons: ['public_syntax_valid', 'flowchart_nodes_located'],
      algorithmVersion: 'architecture-token-binding-v1',
      recordedAt: '2026-08-25T00:00:00.000Z',
    },
  ],
};

describe('ArchitectureTokenBindingStateV1 codec', () => {
  it('round-trips the audit-friendly current revision state', () => {
    const encoded = encodeArchitectureTokenBindingState(validState);
    expect(encoded).toMatchObject({ kind: 'ok' });
    if (encoded.kind !== 'ok') return;

    const decoded = readArchitectureTokenBindingState({ architectureTokenBindingV1: encoded.value });
    expect(decoded).toEqual({ kind: 'ok', value: validState, byteLength: encoded.byteLength });
  });

  it('merges only the Architecture Tokens namespace and preserves unrelated metadata', () => {
    const metadata = {
      comment: 'keep me',
      customFlag: true,
      nested: { owner: 'existing-feature' },
    };

    const merged = mergeArchitectureTokenBindingMetadata(metadata, validState);
    expect(merged.kind).toBe('ok');
    if (merged.kind !== 'ok') return;

    expect(merged.value).toMatchObject({
      comment: 'keep me',
      customFlag: true,
      nested: { owner: 'existing-feature' },
      architectureTokenBindingV1: validState,
    });
    expect(metadata).not.toHaveProperty('architectureTokenBindingV1');
  });

  it('rejects malformed state and leaves metadata merge unavailable', () => {
    const malformed = { ...validState, currentRevisionId: 42 } as unknown;

    expect(encodeArchitectureTokenBindingState(malformed)).toEqual({
      kind: 'rejected',
      reason: 'invalid_state',
    });
    expect(mergeArchitectureTokenBindingMetadata({}, malformed)).toEqual({
      kind: 'rejected',
      reason: 'invalid_state',
    });
    expect(readArchitectureTokenBindingState({ architectureTokenBindingV1: malformed })).toEqual({
      kind: 'rejected',
      reason: 'invalid_state',
    });
  });

  it('rejects unknown schema fields and non-Flowchart element kinds', () => {
    expect(encodeArchitectureTokenBindingState({ ...validState, unexpected: true })).toEqual({
      kind: 'rejected',
      reason: 'invalid_state',
    });
    expect(encodeArchitectureTokenBindingState({
      ...validState,
      elements: [{ ...validState.elements[0], kind: 'edge' }],
    })).toEqual({ kind: 'rejected', reason: 'invalid_state' });
    // Source remains the enclosing Diagram body; it must never be duplicated
    // into the binding namespace as a convenience field.
    expect(encodeArchitectureTokenBindingState({ ...validState, source: 'flowchart TD\n  A --> B' })).toEqual({
      kind: 'rejected',
      reason: 'invalid_state',
    });
  });

  it('rejects invalid revision references and duplicate logical records', () => {
    expect(encodeArchitectureTokenBindingState({
      ...validState,
      currentRevisionId: 'missing-revision',
    })).toEqual({ kind: 'rejected', reason: 'invalid_state' });
    expect(encodeArchitectureTokenBindingState({
      ...validState,
      elements: [...validState.elements, validState.elements[0]],
    })).toEqual({ kind: 'rejected', reason: 'invalid_state' });
  });

  it('counts serialized state in UTF-8 bytes and rejects oversize state', () => {
    const oversized = {
      ...validState,
      audit: [{
        ...validState.audit[0],
        reasons: ['🙂'.repeat(ARCHITECTURE_TOKEN_BINDING_MAX_BYTES)],
      }],
    };
    const encoded = encodeArchitectureTokenBindingState(oversized);
    expect(encoded).toEqual({ kind: 'rejected', reason: 'oversize_state' });

    const asciiState = encodeArchitectureTokenBindingState(validState);
    expect(asciiState.kind).toBe('ok');
    if (asciiState.kind === 'ok') {
      expect(asciiState.byteLength).toBe(new TextEncoder().encode(asciiState.value).byteLength);
      expect(asciiState.byteLength).toBeLessThanOrEqual(ARCHITECTURE_TOKEN_BINDING_MAX_BYTES);
    }
  });

  it('reads no namespace as an empty state without changing metadata', () => {
    expect(readArchitectureTokenBindingState({ comment: 'unrelated' })).toEqual({
      kind: 'ok',
      value: null,
      byteLength: 0,
    });
  });
});
