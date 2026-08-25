import { describe, expect, it } from 'vitest';
import { fingerprintStaticFlowchartNode } from './flowchartStaticFingerprint';
import { parseFlowchartSource } from './mermaidFlowchart';

describe('fingerprintStaticFlowchartNode', () => {
  it('derives normalized syntax facts from one canonical node without comparing revisions', () => {
    const parsed = parseFlowchartSource('flowchart TD\nAPI [ " User   Service " ]');
    if (parsed.kind !== 'ok') throw new Error('fixture must parse');

    expect(fingerprintStaticFlowchartNode(parsed.model.nodes[0])).toMatchObject({
      fingerprintVersion: 'flowchart_node_static_v1',
      provenance: 'single_revision_static',
      syntax: {
        kind: 'node',
        nativeId: 'API',
        normalizedLabel: 'user service',
        shape: 'square',
        canonicalSyntaxKey: '{"fingerprintVersion":"flowchart_node_static_v1","kind":"node","nativeId":"API","shape":"square","normalizedLabel":"user service"}',
      },
    });
  });

  it('records only single-revision structural facts already present in the canonical model', () => {
    const parsed = parseFlowchartSource([
      'flowchart TD',
      'subgraph Outer[Outer]',
      'subgraph Cloud[Cloud]',
      '  Gateway[Gateway] --> Service[User Service] --> Store[(Store)]',
      'end',
      'end',
    ].join('\n'));
    if (parsed.kind !== 'ok') throw new Error('fixture must parse');
    const service = parsed.model.nodes.find((node) => node.nativeId === 'Service');
    if (!service) throw new Error('fixture must include Service');

    expect(fingerprintStaticFlowchartNode(service)).toMatchObject({
      provenance: 'single_revision_static',
      structural: {
        containerPath: ['outer', 'cloud'],
        statementContexts: ['gateway[gateway] --> service[user service] --> store[(store)]'],
        incidentNeighborNativeIds: ['gateway', 'store'],
      },
    });
  });
});
