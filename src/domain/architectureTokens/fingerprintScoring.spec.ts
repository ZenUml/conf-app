import { describe, expect, it } from 'vitest';
import { fingerprintStaticFlowchartNode, type StaticFlowchartNodeFingerprint } from './flowchartStaticFingerprint';
import { scoreFingerprintCandidates } from './fingerprintScoring';
import { parseFlowchartSource } from './mermaidFlowchart';
import { assessExactNativeIdNodeCandidates } from './nativeIdCandidate';
import { prepareSourceDiffRelocation } from './sourceDiffRelocation';

describe('scoreFingerprintCandidates', () => {
  it('reports transparent static component scores without accepting a same-ID candidate', () => {
    const oldSource = 'flowchart TD\nA[Orders API] --> B[Database]';
    const newSource = 'flowchart TD\nA[Payments API] --> B[Database]';
    const old = parseFlowchartSource(oldSource);
    const newer = parseFlowchartSource(newSource);
    if (old.kind !== 'ok' || newer.kind !== 'ok') throw new Error('fixture must parse');

    const relocation = prepareSourceDiffRelocation({
      oldSource,
      newSource,
      oldLocators: old.model.nodes.flatMap((node) => node.occurrences.map((occurrence, index) => ({
        locatorId: `${node.nativeId}:${index}`,
        span: occurrence.span,
      }))),
    });
    const candidateAssessment = assessExactNativeIdNodeCandidates({
      oldNodes: old.model.nodes,
      newNodes: newer.model.nodes,
      sourceDiffRelocations: relocation.relocations,
    });
    const result = scoreFingerprintCandidates({
      candidateAssessment,
      oldFingerprints: fingerprintFacts(old.model.nodes),
      newFingerprints: fingerprintFacts(newer.model.nodes),
    });

    expect(result.scored).toEqual(expect.arrayContaining([
      expect.objectContaining({
        candidate: expect.objectContaining({ old: { nativeId: 'A', kind: 'node' } }),
        score: 0.85,
        components: expect.arrayContaining([
          { signal: 'native_id', weight: 0.35, value: 1, weightedScore: 0.35, evidence: 'exact' },
          { signal: 'kind', weight: 0.2, value: 1, weightedScore: 0.2, evidence: 'exact' },
          { signal: 'normalized_label', weight: 0.15, value: 0, weightedScore: 0, evidence: 'different' },
          { signal: 'shape', weight: 0.1, value: 1, weightedScore: 0.1, evidence: 'exact' },
          { signal: 'neighborhood', weight: 0.15, value: 1, weightedScore: 0.15, evidence: 'raw_native_id_jaccard' },
          { signal: 'container_path', weight: 0.05, value: 1, weightedScore: 0.05, evidence: 'exact' },
        ]),
        statementContextEvidence: 'different',
        sourceDiffRelocationEvidence: 'absent',
        nextRequiredGate: 'global_assignment',
      }),
    ]));
    expect(result.unresolved).toEqual([]);
  });

  it('fails closed when an exact-ID candidate lacks required static fingerprint evidence', () => {
    const old = parseFlowchartSource('flowchart TD\nA[Orders API]');
    const newer = parseFlowchartSource('flowchart TD\nA[Orders API]');
    if (old.kind !== 'ok' || newer.kind !== 'ok') throw new Error('fixture must parse');
    const candidateAssessment = assessExactNativeIdNodeCandidates({
      oldNodes: old.model.nodes,
      newNodes: newer.model.nodes,
      sourceDiffRelocations: [],
    });

    const result = scoreFingerprintCandidates({
      candidateAssessment,
      oldFingerprints: [],
      newFingerprints: fingerprintFacts(newer.model.nodes),
    });

    expect(result.scored).toEqual([]);
    expect(result.unresolved).toEqual([{
      old: { kind: 'node', nativeId: 'A' },
      reason: 'missing_old_static_fingerprint',
    }]);
  });

  it('fails closed when static fingerprint evidence is ambiguous', () => {
    const old = parseFlowchartSource('flowchart TD\nA[Orders API]');
    const newer = parseFlowchartSource('flowchart TD\nA[Orders API]');
    if (old.kind !== 'ok' || newer.kind !== 'ok') throw new Error('fixture must parse');
    const candidateAssessment = assessExactNativeIdNodeCandidates({
      oldNodes: old.model.nodes,
      newNodes: newer.model.nodes,
      sourceDiffRelocations: [],
    });
    const oldFacts = fingerprintFacts(old.model.nodes);

    const result = scoreFingerprintCandidates({
      candidateAssessment,
      oldFingerprints: [...oldFacts, ...oldFacts],
      newFingerprints: fingerprintFacts(newer.model.nodes),
    });

    expect(result.scored).toEqual([]);
    expect(result.unresolved).toEqual([{
      old: { kind: 'node', nativeId: 'A' },
      reason: 'ambiguous_old_static_fingerprint',
    }]);
  });
});

function fingerprintFacts(nodes: readonly Parameters<typeof fingerprintStaticFlowchartNode>[0][]): readonly Readonly<{
  nativeId: string;
  fingerprint: StaticFlowchartNodeFingerprint;
}>[] {
  return nodes.map((node) => ({ nativeId: node.nativeId, fingerprint: fingerprintStaticFlowchartNode(node) }));
}
