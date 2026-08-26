import { describe, expect, it } from 'vitest';
import { applyNodeOccurrenceSourcePositionEvidence, parseFlowchartSource } from './mermaidFlowchart';
import { sliceUtf8ByteSpan, utf8ByteOffsetAt } from './utf8Locator';

describe('parseFlowchartSource', () => {
  it('represents a declared node and implicit edge endpoint as one logical node each', () => {
    const result = parseFlowchartSource('flowchart LR\n  A[Public API] --> B');

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    expect(result.model).toMatchObject({ kind: 'flowchart', direction: 'LR' });
    expect(result.model.nodes).toMatchObject([
      { nativeId: 'A', label: 'Public API' },
      { nativeId: 'B', label: null },
    ]);
    expect(result.model.nodes.map((node) => node.occurrences)).toHaveLength(2);
  });

  it('prefers an explicit declaration as the primary locator while retaining all occurrences', () => {
    const source = 'flowchart TD\nA --> B\nA[Public API]';
    const result = parseFlowchartSource(source);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    const api = result.model.nodes.find((node) => node.nativeId === 'A');
    expect(api).toBeDefined();
    expect(api!.occurrences).toHaveLength(2);
    expect(api!.primaryOccurrence.role).toBe('declaration');
    expect(sliceUtf8ByteSpan(source, api!.primaryOccurrence.span)).toBe('A[Public API]');
  });

  it('keeps a chained edge as three node elements and records the subgraph path', () => {
    const result = parseFlowchartSource([
      'flowchart TD',
      '  subgraph Platform[Platform]',
      '    A((API)) --> B --> C[Database]',
      '  end',
    ].join('\n'));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    expect(result.model.nodes).toMatchObject([
      { nativeId: 'A', shape: 'double_circle', containerPath: ['Platform'] },
      { nativeId: 'B', label: null, containerPath: ['Platform'] },
      { nativeId: 'C', label: 'Database', shape: 'square', containerPath: ['Platform'] },
    ]);
    expect(result.model.edges).toMatchObject([{ endpointNativeIds: ['A', 'B', 'C'] }]);
    expect(result.model.subgraphs).toMatchObject([{ nativeId: 'Platform', title: 'Platform' }]);
  });

  it.each(['TB', 'TD', 'BT', 'RL', 'LR'])('ignores a line-only subgraph direction %s without creating an element', (direction) => {
    const result = parseFlowchartSource([
      'flowchart TD',
      '  subgraph Platform[Platform]',
      `    direction ${direction}`,
      '    API[Public API]',
      '  end',
    ].join('\n'));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    expect(result.model.nodes).toMatchObject([
      { nativeId: 'API', containerPath: ['Platform'] },
    ]);
    expect(result.model.nodes.some((node) => node.nativeId === 'direction')).toBe(false);
  });

  it('emits UTF-8 byte locators even when a node label contains an astral character', () => {
    const source = 'flowchart LR\n  A[服务🙂] --> B';
    const result = parseFlowchartSource(source);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    const api = result.model.nodes.find((node) => node.nativeId === 'A');
    expect(api).toBeDefined();
    expect(sliceUtf8ByteSpan(source, api!.occurrences[0].span)).toBe('A[服务🙂]');
    expect(api!.occurrences[0].span.endByte).toBeGreaterThan('flowchart LR\n  A[服务🙂]'.length);
  });

  it('fails closed when a position-evidence provider changes the node fragment or statement context', () => {
    const source = 'flowchart LR\n  A[服务🙂] --> B[Database]';
    const parsed = parseFlowchartSource(source);
    expect(parsed.kind).toBe('ok');
    if (parsed.kind !== 'ok') return;

    const trustedEvidence = parsed.model.nodes.flatMap((node) => node.occurrences.map((occurrence) => ({
      nativeId: node.nativeId,
      role: occurrence.role,
      span: occurrence.span,
      statementSpan: occurrence.statementSpan,
    })));
    expect(applyNodeOccurrenceSourcePositionEvidence(source, parsed.model, trustedEvidence)).not.toBeNull();

    const database = parsed.model.nodes.find((node) => node.nativeId === 'B')?.occurrences[0];
    expect(database).toBeDefined();
    expect(applyNodeOccurrenceSourcePositionEvidence(source, parsed.model, trustedEvidence.map((evidence, index) => index === 0
      ? { ...evidence, span: database!.span }
      : evidence))).toBeNull();

    const emojiStartByte = utf8ByteOffsetAt(source, source.indexOf('🙂'));
    expect(applyNodeOccurrenceSourcePositionEvidence(source, parsed.model, trustedEvidence.map((evidence, index) => index === 0
      ? { ...evidence, span: { startByte: emojiStartByte + 1, endByte: evidence.span.endByte } }
      : evidence))).toBeNull();
  });

  it('does not split quoted labels on arrows or semicolon-separated statements', () => {
    const result = parseFlowchartSource([
      'flowchart TD',
      '  %% comments are not elements',
      '  A["alerts --> events"] --> B; A --> C',
    ].join('\n'));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    expect(result.model.nodes).toMatchObject([
      { nativeId: 'A', label: 'alerts --> events' },
      { nativeId: 'B' },
      { nativeId: 'C' },
    ]);
    expect(result.model.nodes.find((node) => node.nativeId === 'A')?.occurrences).toHaveLength(2);
  });

  it('keeps a pipe-labelled edge as two endpoint nodes', () => {
    const result = parseFlowchartSource('flowchart TD\n  Orders -->|publishes| Events');

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    expect(result.model.nodes.map((node) => node.nativeId)).toEqual(['Orders', 'Events']);
    expect(result.model.edges).toMatchObject([{ endpointNativeIds: ['Orders', 'Events'] }]);
  });

  it('keeps a text-labelled arrow edge as two endpoint nodes', () => {
    const result = parseFlowchartSource('flowchart TD\n  Orders -- publishes --> Events');

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    expect(result.model.nodes.map((node) => node.nativeId)).toEqual(['Orders', 'Events']);
    expect(result.model.edges).toMatchObject([{ endpointNativeIds: ['Orders', 'Events'] }]);
  });

  it('keeps a lengthened arrow edge as two endpoint nodes', () => {
    const result = parseFlowchartSource('flowchart TD\n  Orders ----> Events');

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    expect(result.model.nodes.map((node) => node.nativeId)).toEqual(['Orders', 'Events']);
    expect(result.model.edges).toMatchObject([{ endpointNativeIds: ['Orders', 'Events'] }]);
  });

  it('keeps a dotted text-labelled edge as two endpoint nodes', () => {
    const result = parseFlowchartSource('flowchart TD\n  Orders -. publishes .-> Events');

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    expect(result.model.nodes.map((node) => node.nativeId)).toEqual(['Orders', 'Events']);
    expect(result.model.edges).toMatchObject([{ endpointNativeIds: ['Orders', 'Events'] }]);
  });

  it('ignores a supported direction statement inside a subgraph without creating a locator', () => {
    const result = parseFlowchartSource('flowchart TD\nsubgraph Platform\ndirection LR\nOrders --> Events\nend');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.model.nodes.map((node) => node.nativeId)).toEqual(['Orders', 'Events']);
    expect(result.model.nodes.flatMap((node) => node.occurrences).some((occurrence) => occurrence.span.startByte === 29)).toBe(false);
  });

  it('keeps a standalone CRLF subgraph direction as a non-element statement', () => {
    const result = parseFlowchartSource('flowchart TD\r\nsubgraph Platform\r\ndirection LR\r\nOrders --> Events\r\nend');

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.model.nodes.map((node) => node.nativeId)).toEqual(['Orders', 'Events']);
    expect(result.model.nodes.flatMap((node) => node.occurrences)).toHaveLength(2);
  });

  it('fails closed for an out-of-context direction statement', () => {
    expect(parseFlowchartSource('flowchart TD\ndirection LR\nOrders --> Events')).toMatchObject({
      kind: 'unsupported',
      reason: 'unsupported_flowchart_statement',
    });
  });

  it('fails closed when a direction statement is embedded in a semicolon-delimited line', () => {
    expect(parseFlowchartSource('flowchart TD\nsubgraph Platform\nOrders --> Events; direction LR\nend')).toMatchObject({
      kind: 'unsupported',
      reason: 'unsupported_flowchart_statement',
    });
    expect(parseFlowchartSource('flowchart TD\nsubgraph Platform\ndirection LR; Orders --> Events\nend')).toMatchObject({
      kind: 'unsupported',
      reason: 'unsupported_flowchart_statement',
    });
  });

  it('fails closed for malformed subgraph direction syntax', () => {
    expect(parseFlowchartSource('flowchart TD\nsubgraph Platform\ndirection LEFT\nOrders --> Events\nend')).toMatchObject({
      kind: 'unsupported',
      reason: 'unsupported_flowchart_statement',
    });
  });

  it('ignores a complete style directive without creating a node or locator', () => {
    const result = parseFlowchartSource([
      'flowchart TD',
      '  style Orders fill:#f96,stroke:#333,stroke-width:2px',
      '  Orders[Orders API] --> Events[Events]',
    ].join('\n'));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    expect(result.model.nodes.map((node) => node.nativeId)).toEqual(['Orders', 'Events']);
    expect(result.model.edges).toMatchObject([{ endpointNativeIds: ['Orders', 'Events'] }]);
    expect(result.model.nodes.some((node) => node.nativeId === 'style')).toBe(false);
  });

  it('fails closed for a Mermaid family outside the Flowchart-node v1 boundary', () => {
    expect(parseFlowchartSource('sequenceDiagram\n  Alice->>Bob: hello')).toEqual({
      kind: 'unsupported',
      reason: 'not_a_flowchart',
    });
  });

  it('fails closed for newer node-shape syntax that this slice does not model', () => {
    expect(parseFlowchartSource('flowchart TD\n  A@{ shape: rect } --> B')).toEqual({
      kind: 'unsupported',
      reason: 'unsupported_edge_endpoint',
    });
  });

  it('fails closed for an incomplete style directive', () => {
    expect(parseFlowchartSource('flowchart TD\n  style Orders fill:#f96,\n  Orders --> Events')).toEqual({
      kind: 'unsupported',
      reason: 'unsupported_flowchart_statement',
    });
  });
});
