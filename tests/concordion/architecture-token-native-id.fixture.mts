import { parseFlowchartSource } from '../../src/domain/architectureTokens/mermaidFlowchart.ts'
import { assessExactNativeIdNodeCandidates } from '../../src/domain/architectureTokens/nativeIdCandidate.ts'
import { prepareSourceDiffRelocation } from '../../src/domain/architectureTokens/sourceDiffRelocation.ts'

type ScenarioId =
  | 'same_id_relocated'
  | 'same_id_changed_label'
  | 'absent_exact_id'
  | 'duplicate_id'

type Scenario = Readonly<{
  oldSource: string
  newSource: string
  duplicateNewNodes?: boolean
}>

type ProductOutcome = Readonly<{
  status: string
  nativeIdEvidence: string
  sourceDiffEvidence: string
  result: string
}>

const scenarios: Readonly<Record<ScenarioId, Scenario>> = {
  same_id_relocated: {
    oldSource: 'flowchart TD\nA[Orders API]',
    newSource: '%% deployment view\nflowchart TD\nA[Orders API]',
  },
  same_id_changed_label: {
    oldSource: 'flowchart TD\nA[Orders API]',
    newSource: 'flowchart TD\nA[Payments API]',
  },
  absent_exact_id: {
    oldSource: 'flowchart TD\nA[Orders API]',
    newSource: 'flowchart TD\nB[Orders API]',
  },
  duplicate_id: {
    oldSource: 'flowchart TD\nA[Orders API]',
    newSource: 'flowchart TD\nA[Orders API]\nA[Orders API]',
    duplicateNewNodes: true,
  },
}

const readerFacingScenarioIds: Readonly<Record<string, ScenarioId>> = {
  'Same node ID survives unchanged': 'same_id_relocated',
  'Same ID remains but the label changes': 'same_id_changed_label',
  'The old node ID is absent': 'absent_exact_id',
  'Duplicate native-ID candidate facts are supplied': 'duplicate_id',
}

/**
 * Executable product-document fixture for Source Binding Engine Stage 2.
 * It calls the production parser, source-diff preparation, and exact native-ID
 * assessor directly. The assessor returns candidates only; it never transfers
 * a binding or confirms logical identity.
 */
export class ArchitectureTokenNativeIdFixture {
  private current: ProductOutcome = {
    status: 'not_run',
    nativeIdEvidence: 'not_run',
    sourceDiffEvidence: 'not_run',
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
    const oldNodes = [oldNode]
    const sourceDiff = prepareSourceDiffRelocation({
      oldSource: scenario.oldSource,
      newSource: scenario.newSource,
      oldLocators: oldNode.occurrences.map((occurrence, index) => ({
        locatorId: `A:occurrence-${index}`,
        span: occurrence.span,
      })),
    })

    const parsedNewNodes = scenario.duplicateNewNodes && newResult.model.nodes[0]
      ? [newResult.model.nodes[0], newResult.model.nodes[0]]
      : newResult.model.nodes
    const assessment = assessExactNativeIdNodeCandidates({
      oldNodes,
      newNodes: parsedNewNodes,
      sourceDiffRelocations: sourceDiff.relocations,
    })
    const candidate = assessment.candidates[0]
    const unmatched = assessment.unmatched[0]
    const sourceDiffEvidence = candidate?.sourceDiffRelocations[0]
      ? `Exact relocation evidence: confidence ${candidate.sourceDiffRelocations[0].confidence.toFixed(1)} · source_diff_unchanged`
      : sourceDiff.relocations[0] && unmatched
        ? `Exact relocation evidence: confidence ${sourceDiff.relocations[0].confidence.toFixed(1)} · source_diff_unchanged`
        : `No relocation evidence: ${sourceDiff.unresolved[0]?.reason ?? 'not_available'}`

    if (candidate) {
      this.current = {
        status: 'candidate_only',
        nativeIdEvidence: `Candidate: node ${candidate.old.nativeId} → node ${candidate.new.nativeId} · exact native ID and kind (node) · next gate ${candidate.nextRequiredGate}`,
        sourceDiffEvidence,
        result: candidate.sourceDiffRelocations.length > 0
          ? 'Candidate only — no identity confirmation or binding transfer'
          : 'Candidate only — changed label has no relocation evidence; no identity confirmation or binding transfer',
      }
      return
    }

    if (!unmatched) throw new Error('Stage 2 fixture expected either a candidate or unmatched result')
    this.current = {
      status: 'unmatched',
      nativeIdEvidence: `Unmatched old node ${unmatched.old.nativeId} · ${unmatched.reason}`,
      sourceDiffEvidence,
      result: unmatched.reason === 'duplicate_native_id_candidate'
        ? 'Unmatched — duplicate native-ID candidate; fail closed; no identity confirmation or binding transfer'
        : 'Unmatched — no exact native ID; no identity confirmation or binding transfer',
    }
  }

  status(): string { return this.current.status }
  nativeIdEvidence(): string { return this.current.nativeIdEvidence }
  sourceDiffEvidence(): string { return this.current.sourceDiffEvidence }
  result(): string { return this.current.result }
}

function asScenarioId(value: string): ScenarioId {
  const scenarioId = readerFacingScenarioIds[value]
  if (!scenarioId) throw new Error(`Unknown native-ID scenario: ${value}`)
  return scenarioId
}
