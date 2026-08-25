import { describe, expect, it } from 'vitest';
import { parseFlowchartSource } from './mermaidFlowchart';
import { sliceUtf8ByteSpan } from './utf8Locator';

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

  it('fails closed for a Mermaid family outside the Flowchart-node v1 boundary', () => {
    expect(parseFlowchartSource('sequenceDiagram\n  Alice->>Bob: hello')).toEqual({
      kind: 'unsupported',
      reason: 'not_a_flowchart',
    });
  });
});
