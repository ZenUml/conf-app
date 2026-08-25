import { fingerprintStaticFlowchartNode } from '../../src/domain/architectureTokens/flowchartStaticFingerprint.ts'
import { parseFlowchartSource } from '../../src/domain/architectureTokens/mermaidFlowchart.ts'
import { assessExactNativeIdNodeCandidates } from '../../src/domain/architectureTokens/nativeIdCandidate.ts'
import { scoreFingerprintCandidates, type StaticFingerprintFact } from '../../src/domain/architectureTokens/fingerprintScoring.ts'
import { prepareSourceDiffRelocation } from '../../src/domain/architectureTokens/sourceDiffRelocation.ts'

type ScenarioId =
  | 'exact_static_match'
  | 'same_id_renamed_label'
  | 'missing_static_facts'
  | 'ambiguous_static_facts'

type Scenario = Readonly<{
  oldSource: string
  newSource: string
  fingerprintFacts: 'complete' | 'missing_old' | 'ambiguous_old'
}>

type ProductOutcome = Readonly<{
  status: string
  candidateEvidence: string
  scoreBreakdown: string
  unweightedEvidence: string
  result: string
}>

const scenarios: Readonly<Record<ScenarioId, Scenario>> = {
  exact_static_match: {
    oldSource: 'flowchart TD\nA[Orders API] --> B[Database]',
    newSource: '%% deployment view\nflowchart TD\nA[Orders API] --> B[Database]',
    fingerprintFacts: 'complete',
  },
  same_id_renamed_label: {
    oldSource: 'flowchart TD\nA[Orders API] --> B[Database]',
    newSource: 'flowchart TD\nA[Payments API] --> B[Database]',
    fingerprintFacts: 'complete',
  },
  missing_static_facts: {
    oldSource: 'flowchart TD\nA[Orders API] --> B[Database]',
    newSource: '%% same diagram, new revision\nflowchart TD\nA[Orders API] --> B[Database]',
    fingerprintFacts: 'missing_old',
  },
  ambiguous_static_facts: {
    oldSource: 'flowchart TD\nA[Orders API] --> B[Database]',
    newSource: '%% same diagram, new revision\nflowchart TD\nA[Orders API] --> B[Database]',
    fingerprintFacts: 'ambiguous_old',
  },
}

const readerFacingScenarioIds: Readonly<Record<string, ScenarioId>> = {
  'Exact static facts agree after an independent source relocation': 'exact_static_match',
  'Same native ID but the node label is renamed': 'same_id_renamed_label',
  'Required static facts are missing': 'missing_static_facts',
  'Duplicate static facts make the score ambiguous': 'ambiguous_static_facts',
}

/**
 * Executable product-document fixture for Source Binding Engine Stage 3.
 * Every stage is called through the real parser/domain APIs. The returned
 * score is evidence only; this fixture never confirms identity or transfers a
 * binding.
 */
export class ArchitectureTokenFingerprintScoringFixture {
  private current: ProductOutcome = {
    status: 'not_run',
    candidateEvidence: 'not_run',
    scoreBreakdown: 'not_run',
    unweightedEvidence: 'not_run',
    result: 'not_run',
  }

  evaluateScenario(row: Record<'Scenario', string>): void {
    const scenario = scenarios[asScenarioId(row.Scenario)]
    const oldResult = parseFlowchartSource(scenario.oldSource)
    const newResult = parseFlowchartSource(scenario.newSource)
    if (oldResult.kind !== 'ok') throw new Error(`Old fixture source must parse: ${oldResult.reason}`)
    if (newResult.kind !== 'ok') throw new Error(`New fixture source must parse: ${newResult.reason}`)

    const oldNode = oldResult.model.nodes.find((node) => node.nativeId === 'A')
    if (!oldNode) throw new Error('Fixture old source must contain node A')

    const sourceDiff = prepareSourceDiffRelocation({
      oldSource: scenario.oldSource,
      newSource: scenario.newSource,
      oldLocators: oldNode.occurrences.map((occurrence, index) => ({
        locatorId: `A:occurrence-${index}`,
        span: occurrence.span,
      })),
    })
    const candidateAssessment = assessExactNativeIdNodeCandidates({
      oldNodes: oldResult.model.nodes,
      newNodes: newResult.model.nodes,
      sourceDiffRelocations: sourceDiff.relocations,
    })
    const stage2Candidate = candidateAssessment.candidates.find((candidate) => candidate.old.nativeId === 'A')
    if (!stage2Candidate) throw new Error('Stage 2 fixture must produce an exact native-ID candidate for A')

    const completeOldFacts = fingerprintFacts(oldResult.model.nodes)
    const completeNewFacts = fingerprintFacts(newResult.model.nodes)
    const oldFacts = scenario.fingerprintFacts === 'missing_old'
      ? []
      : scenario.fingerprintFacts === 'ambiguous_old'
        ? duplicateFactForNativeId(completeOldFacts, 'A')
        : completeOldFacts
    const scoring = scoreFingerprintCandidates({
      candidateAssessment,
      oldFingerprints: oldFacts,
      newFingerprints: completeNewFacts,
    })
    const scored = scoring.scored.find((candidate) => candidate.candidate.old.nativeId === 'A')
    const unresolved = scoring.unresolved.find((item) => item.old.nativeId === 'A')

    this.current = {
      status: scored ? 'scored' : 'unresolved',
      candidateEvidence: `Stage 2 candidate: node ${stage2Candidate.old.nativeId} → node ${stage2Candidate.new.nativeId} · exact native ID and kind (node) · next gate ${stage2Candidate.nextRequiredGate}`,
      scoreBreakdown: scored
        ? formatScoreBreakdown(scored)
        : `No score · ${unresolved?.reason ?? 'missing_stage3_result'} · fail closed`,
      unweightedEvidence: scored
        ? `Statement context: ${scored.statementContextEvidence} · source-diff relocation: ${scored.sourceDiffRelocationEvidence} · next gate: ${scored.nextRequiredGate}`
        : `Statement context: not scored until fingerprints exist · source-diff relocation: ${stage2Candidate.sourceDiffRelocations.length > 0 ? 'present' : 'absent'} · next gate: global_assignment`,
      result: scored
        ? `Scored evidence ${scored.score.toFixed(2)} — evidence only; no identity confirmation or binding transfer; next gate ${scored.nextRequiredGate}`
        : `Unresolved — ${unresolved?.reason ?? 'missing_stage3_result'} · fail closed; no identity confirmation or binding transfer`,
    }
  }

  status(): string { return this.current.status }
  candidateEvidence(): string { return this.current.candidateEvidence }
  scoreBreakdown(): string { return this.current.scoreBreakdown }
  unweightedEvidence(): string { return this.current.unweightedEvidence }
  result(): string { return this.current.result }
}

function fingerprintFacts(nodes: readonly Parameters<typeof fingerprintStaticFlowchartNode>[0][]): readonly StaticFingerprintFact[] {
  return nodes.map((node) => ({
    nativeId: node.nativeId,
    fingerprint: fingerprintStaticFlowchartNode(node),
  }))
}

function duplicateFactForNativeId(facts: readonly StaticFingerprintFact[], nativeId: string): readonly StaticFingerprintFact[] {
  const duplicate = facts.find((fact) => fact.nativeId === nativeId)
  if (!duplicate) throw new Error(`Fixture must contain static fact ${nativeId}`)
  return [...facts, duplicate]
}

function formatScoreBreakdown(scored: Readonly<{
  candidate: Readonly<{ old: Readonly<{ nativeId: string }> }>
  score: number
  components: readonly Readonly<{
    signal: string
    weight: number
    weightedScore: number
    evidence: string
  }>[]
  availableWeight: number
}>): string {
  return `Score ${scored.candidate.old.nativeId}: ${scored.score.toFixed(2)} · ${scored.components.map((component) => `${component.signal} ${component.weightedScore.toFixed(2)}/${component.weight.toFixed(2)} (${component.evidence})`).join(' · ')} · available weight ${scored.availableWeight.toFixed(2)}`
}

function asScenarioId(value: string): ScenarioId {
  const scenarioId = readerFacingScenarioIds[value]
  if (!scenarioId) throw new Error(`Unknown fingerprint-scoring scenario: ${value}`)
  return scenarioId
}
