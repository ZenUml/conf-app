import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateMermaidSyntax } from '@/utils/mermaid/validate';
import { locateFlowchartNodeOccurrences } from './jisonFlowchartLocatorAdapter';
import { mermaid112JisonParserFactory } from './mermaid112JisonParserFactory';
import { parseFlowchartSource } from './mermaidFlowchart';
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

  it('records pinned Jison position evidence while preserving domain Locator values for CRLF source with Unicode and repeated occurrences', async () => {
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
    expect(result.parserEvidence).toEqual(expect.objectContaining({ kind: 'jison_verified', verifiedOccurrenceCount: 7 }));
    expect(result.model).toEqual(handwritten.model);
    const occurrences = result.model.nodes.find(({ nativeId }) => nativeId === 'A')?.occurrences ?? [];
    expect(occurrences).toHaveLength(2);
    expect(occurrences.map(({ span }) => sliceUtf8ByteSpan(source, span))).toEqual(['A[Start 😀]', 'A']);
  });

  it('falls back as one complete handwritten model for an unmodelled preprocessing form', async () => {
    validate.mockResolvedValue({ valid: true, error: null, location: null });
    const source = '%% existing Mermaid comment\nflowchart TD\n  A[Start] --> B[End]';
    const handwritten = parseFlowchartSource(source);
    expect(handwritten.kind).toBe('ok');

    const result = await validateMermaidFlowchart(source);

    expect(result).toMatchObject({
      kind: 'ok',
      parserEvidence: {
        kind: 'jison_rejected',
        reason: 'unsupported_preprocessing:directive_or_comment',
      },
    });
    if (result.kind !== 'ok' || handwritten.kind !== 'ok') return;
    expect(result.model).toEqual(handwritten.model);
  });

  it('falls back when the version-pinned factory gate fails', async () => {
    validate.mockResolvedValue({ valid: true, error: null, location: null });

    const result = await validateMermaidFlowchart('flowchart TD\n  A --> B', {
      createJisonFactory: () => {
        throw new Error('simulated artifact hash mismatch');
      },
    });

    expect(result).toMatchObject({
      kind: 'ok',
      parserEvidence: { kind: 'jison_rejected', reason: 'factory_contract_failure' },
    });
  });

  it('rejects incorrect Jison span evidence without mixing it into the domain Locator', async () => {
    validate.mockResolvedValue({ valid: true, error: null, location: null });
    const source = 'flowchart TD\n  A[Start] --> B[End]';
    const handwritten = parseFlowchartSource(source);
    expect(handwritten.kind).toBe('ok');

    const result = await validateMermaidFlowchart(source, {
      locateJisonEvidence: (rawSource, factory) => {
        const actual = locateFlowchartNodeOccurrences(rawSource, factory);
        if (actual.kind !== 'ok') return actual;
        return {
          ...actual,
          occurrences: actual.occurrences.map((occurrence, index) => index === 0
            ? { ...occurrence, span: occurrence.statementSpan }
            : occurrence),
        };
      },
      createJisonFactory: mermaid112JisonParserFactory,
    });

    expect(result).toMatchObject({
      kind: 'ok',
      parserEvidence: { kind: 'jison_rejected', reason: 'canonical_occurrence_mismatch' },
    });
    if (result.kind !== 'ok' || handwritten.kind !== 'ok') return;
    expect(result.model).toEqual(handwritten.model);
  });
});
