import { describe, expect, it } from 'vitest';
import {
  analyzePair,
  auditStaticLocators,
  assertReadOnlySql,
  deriveUniqueExactNodeSpanRelocations,
  idShape,
  parseStoredBody,
} from './architecture-token-shadow.mjs';
import { parseFlowchartSource } from '../src/domain/architectureTokens/mermaidFlowchart';
import { sliceUtf8ByteSpan, utf8ByteSpanFor } from '../src/domain/architectureTokens/utf8Locator';
import { fingerprintFlowchartNode, reconcileFlowchartNodes } from '../src/domain/architectureTokens/reconcileFlowchartNodes';

describe('Architecture Token shadow experiment helpers', () => {
  it('only accepts a single read-only query', () => {
    expect(assertReadOnlySql('SELECT * FROM CustomContent')).toBe('SELECT * FROM CustomContent');
    expect(() => assertReadOnlySql('SELECT 1; DELETE FROM CustomContent')).toThrow('read-only');
    expect(() => assertReadOnlySql('UPDATE CustomContent SET body = body')).toThrow('read-only');
  });

  it('extracts only expected stored body shapes', () => {
    const diagram = JSON.stringify({ diagramType: 'Mermaid', mermaidCode: 'flowchart TD\nA --> B' });
    expect(parseStoredBody(JSON.stringify({ raw: { value: diagram } }))).toEqual({ kind: 'ok', code: 'flowchart TD\nA --> B' });
    expect(parseStoredBody(JSON.stringify({ mermaidCode: 'flowchart TD\nA --> B' }))).toEqual({ kind: 'ok', code: 'flowchart TD\nA --> B' });
    expect(parseStoredBody('not json')).toEqual({ kind: 'invalid_body_json' });
    expect(parseStoredBody(JSON.stringify({ raw: { value: '{}' } }))).toEqual({ kind: 'missing_mermaid_code' });
  });

  it('labels ID shapes without treating them as identity quality', () => {
    expect(idShape('123')).toBe('numeric_only');
    expect(idShape('A')).toBe('very_short');
    expect(idShape('orders_api')).toBe('identifier_like');
  });

  it('audits source-derived UTF-8 locators for Flowchart node occurrences only', () => {
    const source = [
      'flowchart TD',
      'subgraph Platform[Platform]',
      '  A[服务 API] -->|publishes| B[Events]',
      'end',
      '  C[Standalone]',
    ].join('\n');
    const parsed = parseFlowchartSource(source);
    if (parsed.kind !== 'ok') throw new Error('fixture must parse');

    const audit = auditStaticLocators({
      source,
      model: parsed.model,
      parseFlowchartSource,
      sliceUtf8ByteSpan,
    });

    expect(audit.kind).toBe('ok');
    if (audit.kind !== 'ok') return;
    expect(audit.locators.map((locator) => ({
      nativeId: locator.nativeId,
      role: locator.role,
      fragment: sliceUtf8ByteSpan(source, locator.span),
    }))).toEqual([
      { nativeId: 'A', role: 'edge_endpoint', fragment: 'A[服务 API]' },
      { nativeId: 'B', role: 'edge_endpoint', fragment: 'B[Events]' },
      { nativeId: 'C', role: 'declaration', fragment: 'C[Standalone]' },
    ]);
  });

  it('fails closed when a locator is changed to a label span', () => {
    const source = 'flowchart TD\nA[A] --> B';
    const parsed = parseFlowchartSource(source);
    if (parsed.kind !== 'ok') throw new Error('fixture must parse');
    const labelStart = source.lastIndexOf('A]');
    const labelSpan = utf8ByteSpanFor(source, labelStart, labelStart + 1);
    const tampered = {
      ...parsed.model,
      nodes: parsed.model.nodes.map((node) => node.nativeId !== 'A' ? node : {
        ...node,
        occurrences: node.occurrences.map((occurrence, index) => index === 0 ? {
          ...occurrence,
          span: labelSpan,
        } : occurrence),
      }),
    };

    const audit = auditStaticLocators({
      source,
      model: tampered,
      parseFlowchartSource,
      sliceUtf8ByteSpan,
    });
    expect(audit.kind).toBe('unsafe');
    if (audit.kind !== 'unsafe') return;
    expect(audit.reasons).toContain('locator_not_syntax_derived');
  });

  it('round-trips a reserved word only in its edge-endpoint syntax role', () => {
    const source = 'flowchart TD\nA --> end';
    const parsed = parseFlowchartSource(source);
    if (parsed.kind !== 'ok') throw new Error('fixture must parse');

    expect(auditStaticLocators({
      source,
      model: parsed.model,
      parseFlowchartSource,
      sliceUtf8ByteSpan,
    })).toMatchObject({ kind: 'ok' });
  });

  it('derives relocation evidence only where an exact node span is unique', () => {
    const oldSource = 'flowchart TD\nA[入口] --> B';
    const newSource = 'flowchart TD\nA[入口] --> B\nC';
    const old = parseFlowchartSource(oldSource);
    const newer = parseFlowchartSource(newSource);
    if (old.kind !== 'ok' || newer.kind !== 'ok') throw new Error('fixture must parse');
    expect(deriveUniqueExactNodeSpanRelocations(oldSource, old.model.nodes, newSource, newer.model.nodes, sliceUtf8ByteSpan))
      .toEqual(expect.arrayContaining([{ diagramElementId: 'shadow-0', newNativeId: 'A' }]));
  });

  it('keeps same-ID delete/recreate as a confirmation candidate without relocation evidence', async () => {
    const domain = {
      parseFlowchartSource,
      sliceUtf8ByteSpan,
      fingerprintFlowchartNode,
      reconcileFlowchartNodes,
      validateMermaid: async () => ({ ok: true }),
    };
    const result = await analyzePair({
      oldSource: 'flowchart TD\nA[Old label]',
      newSource: 'flowchart TD\nA[Old label]',
      domain,
    });
    if (result.kind !== 'ok') throw new Error('fixture must be eligible');
    expect(result.decisions[0]).toMatchObject({ status: 'confirmed_automatic' });
    expect(result.sameNativeIdCandidates).toBe(1);

    const old = parseFlowchartSource('flowchart TD\nA[Old label]');
    const newer = parseFlowchartSource('flowchart TD\nA[Old label]');
    if (old.kind !== 'ok' || newer.kind !== 'ok') throw new Error('fixture must parse');
    expect(reconcileFlowchartNodes({
      oldElements: [{ diagramElementId: 'shadow-0', fingerprint: fingerprintFlowchartNode(old.model.nodes[0]) }],
      newNodes: newer.model.nodes,
      relocatedPairs: [],
    }).decisions[0]).toMatchObject({ status: 'needs_confirmation', reasons: ['native_id_is_insufficient'] });
  });
});
