import { describe, expect, it } from 'vitest';
import {
  analyzeHistoricalPair,
  analyzeHistoricalPairRow,
  analyzeCurrentBody,
  auditStaticLocators,
  assertReadOnlySql,
  deriveUniqueExactNodeSpanRelocations,
  idShape,
  newMetrics,
  newHistoricalMetrics,
  parseStoredBody,
} from './architecture-token-shadow.mjs';
import { parseFlowchartSource } from '../src/domain/architectureTokens/mermaidFlowchart';
import { sliceUtf8ByteSpan, utf8ByteSpanFor } from '../src/domain/architectureTokens/utf8Locator';
import { fingerprintStaticFlowchartNode } from '../src/domain/architectureTokens/flowchartStaticFingerprint';
import { prepareSourceDiffRelocation } from '../src/domain/architectureTokens/sourceDiffRelocation';
import { assessExactNativeIdNodeCandidates } from '../src/domain/architectureTokens/nativeIdCandidate';
import { scoreFingerprintCandidates } from '../src/domain/architectureTokens/fingerprintScoring';
import { assignMaximumWeightCandidates } from '../src/domain/architectureTokens/globalAssignment';
import { assessStructuralTopology } from '../src/domain/architectureTokens/structuralTopologyAssessment';
import { assessSplitMergePatterns } from '../src/domain/architectureTokens/splitMergeAssessment';
import { classifyDeleteRecreateConfidence } from '../src/domain/architectureTokens/deleteRecreatePolicy';

describe('Architecture Token shadow experiment helpers', () => {
  it('only accepts a single read-only query', () => {
    expect(assertReadOnlySql('SELECT * FROM CustomContent')).toBe('SELECT * FROM CustomContent');
    expect(assertReadOnlySql('WITH prior AS (SELECT 1) SELECT * FROM prior')).toContain('WITH prior');
    expect(() => assertReadOnlySql('SELECT 1; DELETE FROM CustomContent')).toThrow('read-only');
    expect(() => assertReadOnlySql('UPDATE CustomContent SET body = body')).toThrow('read-only');
    expect(() => assertReadOnlySql('WITH x AS (SELECT 1) INSERT INTO x VALUES (1)')).toThrow('read-only');
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

  it('counts static fingerprint facts separately from locator eligibility', async () => {
    const metrics = newMetrics();
    await analyzeCurrentBody(JSON.stringify({ mermaidCode: 'flowchart TD\nGateway --> Service[User Service]' }), metrics, {
      parseFlowchartSource,
      sliceUtf8ByteSpan,
      fingerprintStaticFlowchartNode,
      validateMermaid: async () => ({ ok: true }),
    });

    expect(metrics.locatorEligibility).toEqual({ eligible: 1 });
    expect(metrics.primaryLocators).toBe(2);
    expect(metrics.staticFingerprintFacts).toEqual({ syntax: 2, structural: 2 });
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

  it('runs the staged pair pipeline without producing identity or transfer decisions', async () => {
    const domain = {
      parseFlowchartSource,
      sliceUtf8ByteSpan,
      fingerprintStaticFlowchartNode,
      prepareSourceDiffRelocation,
      assessExactNativeIdNodeCandidates,
      scoreFingerprintCandidates,
      assignMaximumWeightCandidates,
      assessStructuralTopology,
      assessSplitMergePatterns,
      classifyDeleteRecreateConfidence,
      validateMermaid: async () => ({ ok: true }),
    };
    const result = await analyzeHistoricalPair({
      oldSource: 'flowchart TD\nA[Old label] --> B',
      newSource: 'flowchart TD\nA[New label] --> B',
      oldVersionNumber: 4,
      newVersionNumber: 5,
      domain,
    });
    if (result.kind !== 'ok') throw new Error('fixture must be eligible');
    expect(result.transfer).toBeNull();
    expect(result).not.toHaveProperty('decisions');
    expect(result.nativeIds.candidates).toHaveLength(2);
    expect(result.scoring.scored[0].score).toBe(0.85);
    expect(result.assignment.selected).toHaveLength(2);
    expect(result.policy.outcomes).toHaveLength(2);
    expect(result.policy.outcomes.every((outcome) => outcome.outcome !== 'orphaned')).toBe(true);
  });

  it('aggregates only deidentified evidence for a current/prior fixture pair', async () => {
    const metrics = newHistoricalMetrics();
    const domain = {
      parseFlowchartSource,
      sliceUtf8ByteSpan,
      fingerprintStaticFlowchartNode,
      prepareSourceDiffRelocation,
      assessExactNativeIdNodeCandidates,
      scoreFingerprintCandidates,
      assignMaximumWeightCandidates,
      assessStructuralTopology,
      assessSplitMergePatterns,
      classifyDeleteRecreateConfidence,
      validateMermaid: async () => ({ ok: true }),
    };
    const body = (code: string) => JSON.stringify({ mermaidCode: code });
    const result = await analyzeHistoricalPairRow({
      priorBody: body('flowchart TD\nA[Orders] --> B'),
      currentBody: body('flowchart TD\n%% note\nA[Payments] --> B'),
      priorVersionNumber: 7,
      currentVersionNumber: 8,
    }, metrics, domain);

    expect(result.transfer).toBeNull();
    expect(metrics.pairRows).toBe(1);
    expect(metrics.pairFunnel.static_eligible_pair).toBe(1);
    expect(metrics.pairFunnel.stage1_source_diff_prepared).toBe(1);
    expect(metrics.pairFunnel.stage7_confidence_policy_assessed).toBe(1);
    expect(metrics.revisionDistance).toEqual({ adjacent: 1 });
    expect(metrics).not.toHaveProperty('contentId');
    expect(metrics).not.toHaveProperty('nativeIds');
  });
});
