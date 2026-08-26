import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateMermaidSyntax } from '@/utils/mermaid/validate';
import { extractFlowchartNodeOccurrenceEvidence } from './jisonFlowchartLocatorAdapter';
import { mermaid112JisonParserFactory } from './mermaid112JisonParserFactory';
import { parseFlowchartSource, type CanonicalFlowchart } from './mermaidFlowchart';
import { sliceUtf8ByteSpan } from './utf8Locator';
import { validateMermaidFlowchart } from './validateMermaidFlowchart';

vi.mock('@/utils/mermaid/validate', () => ({
  validateMermaidSyntax: vi.fn(),
}));

const validate = vi.mocked(validateMermaidSyntax);

describe('validateMermaidFlowchart', () => {
  beforeEach(() => validate.mockReset());

  it('uses Mermaid public syntax validation before accepting the owned Flowchart model', async () => {
    validate.mockResolvedValue({ valid: false, error: 'Parse error', location: null });

    await expect(validateMermaidFlowchart('flowchart LR\n  A -->')).resolves.toEqual({
      kind: 'invalid',
      error: 'Parse error',
    });
    expect(validate).toHaveBeenCalledWith('flowchart LR\n  A -->');
  });

  it('returns the node-only canonical model only after Mermaid accepts the source', async () => {
    validate.mockResolvedValue({ valid: true, error: null, location: null });

    await expect(validateMermaidFlowchart('flowchart LR\n  A --> B')).resolves.toEqual(expect.objectContaining({
      kind: 'ok',
      model: expect.objectContaining({ kind: 'flowchart' }),
    }));
  });

  it('makes pinned Jison the preferred source-position evidence while Locator retains its domain value', async () => {
    validate.mockResolvedValue({ valid: true, error: null, location: null });
    const source = [
      'flowchart TD',
      '  A[Start 😀] --> B{Check}',
      '  A --> C[Child]',
      '  C --> D --> E[End]',
    ].join('\r\n');

    const result = await validateMermaidFlowchart(source);

    expect(result.kind).toBe('ok');
    const handwritten = parseFlowchartSource(source);
    if (result.kind !== 'ok' || handwritten.kind !== 'ok') return;
    expect(result.locatorEvidence).toEqual(expect.objectContaining({ kind: 'jison_preferred', occurrenceCount: 7 }));
    expect(locatorIndependentFacts(result.model)).toEqual(locatorIndependentFacts(handwritten.model));
    const occurrences = result.model.nodes.find(({ nativeId }) => nativeId === 'A')?.occurrences ?? [];
    expect(occurrences).toHaveLength(2);
    expect(occurrences.map(({ span }) => sliceUtf8ByteSpan(source, span))).toEqual(['A[Start 😀]', 'A']);
    // The public model remains the Locator, but its preferred provider has
    // supplied the syntax-derived statement position for this occurrence.
    const legacyA = handwritten.model.nodes.find(({ nativeId }) => nativeId === 'A')?.occurrences[0];
    expect(occurrences[0].statementSpan.startByte).toBe(occurrences[0].span.startByte);
    expect(legacyA?.statementSpan.startByte).toBeLessThan(occurrences[0].statementSpan.startByte);
  });

  it('keeps a Mermaid-accepted source valid when the preferred evidence provider rejects entity preprocessing', async () => {
    validate.mockResolvedValue({ valid: true, error: null, location: null });
    const source = 'flowchart TD\nA[#amp;] --> B';
    const handwritten = parseFlowchartSource(source);
    expect(handwritten.kind).toBe('ok');

    const result = await validateMermaidFlowchart(source);

    expect(result).toMatchObject({
      kind: 'ok',
      locatorEvidence: {
        kind: 'legacy_handwritten',
        reason: 'unsupported_preprocessing:entity_encoding',
      },
    });
    if (result.kind !== 'ok' || handwritten.kind !== 'ok') return;
    expect(result.model).toEqual(handwritten.model);
  });

  it('uses parser-derived evidence after removing an ordinary Mermaid comment with a mapped raw source', async () => {
    validate.mockResolvedValue({ valid: true, error: null, location: null });
    const source = '%% explanatory comment\r\nflowchart TD\r\n  A[Start 😀] --> B[End]';

    const result = await validateMermaidFlowchart(source);

    expect(result).toMatchObject({
      kind: 'ok',
      locatorEvidence: { kind: 'jison_preferred' },
    });
    if (result.kind !== 'ok') return;
    const occurrence = result.model.nodes.find(({ nativeId }) => nativeId === 'A')?.occurrences[0];
    expect(occurrence && sliceUtf8ByteSpan(source, occurrence.span)).toBe('A[Start 😀]');
  });

  it('uses parser-derived evidence after mapping Mermaid close-brace whitespace normalization', async () => {
    validate.mockResolvedValue({ valid: true, error: null, location: null });
    const source = 'flowchart TD\r\n  B{Check}    \r\n  A[Start] --> B';

    const result = await validateMermaidFlowchart(source);

    expect(result).toMatchObject({
      kind: 'ok',
      locatorEvidence: { kind: 'jison_preferred' },
    });
    if (result.kind !== 'ok') return;
    const occurrence = result.model.nodes.find(({ nativeId }) => nativeId === 'A')?.occurrences[0];
    expect(occurrence && sliceUtf8ByteSpan(source, occurrence.span)).toBe('A[Start]');
  });

  it('does not let source-position provider selection change Mermaid validity', async () => {
    validate.mockResolvedValue({ valid: true, error: null, location: null });
    const source = 'flowchart TD\n  A --> B';
    const preferred = await validateMermaidFlowchart(source);

    const legacy = await validateMermaidFlowchart(source, {
      createJisonEvidenceFactory: () => {
        throw new Error('simulated artifact hash mismatch');
      },
    });

    expect(preferred).toMatchObject({ kind: 'ok' });
    expect(legacy).toMatchObject({
      kind: 'ok',
      locatorEvidence: { kind: 'legacy_handwritten', reason: 'factory_contract_failure' },
    });
    if (preferred.kind !== 'ok' || legacy.kind !== 'ok') return;
    expect(locatorIndependentFacts(legacy.model)).toEqual(locatorIndependentFacts(preferred.model));
  });

  it('rejects incorrect Jison span evidence without mixing it into the domain Locator', async () => {
    validate.mockResolvedValue({ valid: true, error: null, location: null });
    const source = 'flowchart TD\n  A[Start] --> B[End]';
    const handwritten = parseFlowchartSource(source);
    expect(handwritten.kind).toBe('ok');

    const result = await validateMermaidFlowchart(source, {
      extractJisonOccurrenceEvidence: (rawSource, factory) => {
        const actual = extractFlowchartNodeOccurrenceEvidence(rawSource, factory);
        if (actual.kind !== 'ok') return actual;
        return {
          ...actual,
          occurrences: actual.occurrences.map((occurrence, index) => index === 0
            ? { ...occurrence, span: occurrence.statementSpan }
            : occurrence),
        };
      },
      createJisonEvidenceFactory: mermaid112JisonParserFactory,
    });

    expect(result).toMatchObject({
      kind: 'ok',
      locatorEvidence: { kind: 'legacy_handwritten', reason: 'canonical_occurrence_mismatch' },
    });
    if (result.kind !== 'ok' || handwritten.kind !== 'ok') return;
    expect(result.model).toEqual(handwritten.model);
  });
});

function locatorIndependentFacts(model: CanonicalFlowchart) {
  return {
    kind: model.kind,
    direction: model.direction,
    nodes: model.nodes.map((node) => ({
      nativeId: node.nativeId,
      label: node.label,
      shape: node.shape,
      containerPath: node.containerPath,
      incidentNativeIds: node.incidentNativeIds,
      statementContexts: node.statementContexts,
      occurrenceRoles: node.occurrences.map((occurrence) => occurrence.role),
    })),
    edges: model.edges.map((edge) => edge.endpointNativeIds),
    subgraphs: model.subgraphs.map((subgraph) => ({
      nativeId: subgraph.nativeId,
      title: subgraph.title,
      containerPath: subgraph.containerPath,
    })),
  };
}
