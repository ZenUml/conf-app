import { prepareSourceDiffRelocation, type SourceDiffLocator } from '../../src/domain/architectureTokens/sourceDiffRelocation.ts'
import { utf8ByteSpanFor, type Utf8ByteSpan } from '../../src/domain/architectureTokens/utf8Locator.ts'

type ScenarioId =
  | 'utf8_insertion'
  | 'replacement'
  | 'invalid_locator'
  | 'empty_locator'
  | 'duplicate_locator'

type Scenario = Readonly<{
  oldSource: string
  newSource: string
  locators: readonly SourceDiffLocator[]
}>

type ProductOutcome = Readonly<{
  status: string
  relocationEvidence: string
  result: string
}>

const unchangedSource = 'flowchart TD\nA[Orders API]'

const scenarios: Readonly<Record<ScenarioId, Scenario>> = {
  utf8_insertion: {
    oldSource: 'flowchart TD\nA[服务🙂] --> B',
    newSource: '%% title\nflowchart TD\nA[服务🙂] --> B',
    locators: [{
      locatorId: 'node-a-occurrence-0',
      span: spanForFragment('flowchart TD\nA[服务🙂] --> B', 'A[服务🙂]'),
    }],
  },
  replacement: {
    oldSource: 'flowchart TD\nA[Orders API] --> B',
    newSource: 'flowchart TD\nA[Payments API] --> B',
    locators: [{
      locatorId: 'node-a-occurrence-0',
      span: spanForFragment('flowchart TD\nA[Orders API] --> B', 'A[Orders API]'),
    }],
  },
  invalid_locator: {
    oldSource: unchangedSource,
    newSource: unchangedSource,
    locators: [{ locatorId: 'node-a-occurrence-0', span: { startByte: -1, endByte: 2 } }],
  },
  empty_locator: {
    oldSource: unchangedSource,
    newSource: unchangedSource,
    locators: [{ locatorId: 'node-a-occurrence-0', span: { startByte: 13, endByte: 13 } }],
  },
  duplicate_locator: {
    oldSource: 'flowchart TD\nA[Orders API]\nB[Events]',
    newSource: 'flowchart TD\nA[Orders API]\nB[Events]',
    locators: [
      { locatorId: 'node-occurrence-0', span: spanForFragment('flowchart TD\nA[Orders API]\nB[Events]', 'A[Orders API]') },
      { locatorId: 'node-occurrence-0', span: spanForFragment('flowchart TD\nA[Orders API]\nB[Events]', 'B[Events]') },
    ],
  },
}

const readerFacingScenarioIds: Readonly<Record<string, ScenarioId>> = {
  'Insert UTF-8 text before an unchanged node': 'utf8_insertion',
  'Replace text inside the saved locator': 'replacement',
  'Saved locator is outside the source bytes': 'invalid_locator',
  'Saved locator has no source bytes': 'empty_locator',
  'Two saved locators reuse one occurrence key': 'duplicate_locator',
}

/**
 * Executable product-document fixture for Source Binding Engine Stage 1.
 * It calls the production source-diff relocation preparation directly and
 * deliberately exposes evidence only: it has no identity or binding decision.
 */
export class ArchitectureTokenSourceDiffFixture {
  private current: ProductOutcome = {
    status: 'not_run',
    relocationEvidence: 'not_run',
    result: 'not_run',
  }

  evaluateScenario(row: Record<'Scenario', string>): void {
    const scenario = scenarios[asScenarioId(row.Scenario)]
    const preparation = prepareSourceDiffRelocation({
      oldSource: scenario.oldSource,
      newSource: scenario.newSource,
      oldLocators: scenario.locators,
    })
    const relocation = preparation.relocations[0]

    if (relocation) {
      this.current = {
        status: 'relocation_evidence_only',
        relocationEvidence: `${formatSpan(relocation.oldSpan)} → ${formatSpan(relocation.newSpan)} · confidence ${relocation.confidence.toFixed(1)} · unchanged UTF-8 text`,
        result: 'Exact relocation evidence only — no identity confirmation or binding transfer',
      }
      return
    }

    const reasons = [...new Set(preparation.unresolved.map((unresolved) => unresolved.reason))]
    const duplicateCount = preparation.unresolved.filter((unresolved) => unresolved.reason === 'duplicate_locator_id').length
    const reason = reasons.length === 1 && reasons[0] === 'duplicate_locator_id'
      ? `duplicate_locator_id (${duplicateCount} locators)`
      : reasons.join(', ')
    this.current = {
      status: 'unresolved',
      relocationEvidence: `No exact relocation: ${reason}`,
      result: 'Unresolved — no identity confirmation or binding transfer',
    }
  }

  status(): string { return this.current.status }
  relocationEvidence(): string { return this.current.relocationEvidence }
  result(): string { return this.current.result }
}

function asScenarioId(value: string): ScenarioId {
  const scenarioId = readerFacingScenarioIds[value]
  if (!scenarioId) throw new Error(`Unknown source-diff scenario: ${value}`)
  return scenarioId
}

function spanForFragment(source: string, fragment: string): Utf8ByteSpan {
  const start = source.indexOf(fragment)
  if (start < 0) throw new Error(`Fixture source has no fragment ${fragment}`)
  return utf8ByteSpanFor(source, start, start + fragment.length)
}

function formatSpan(span: Utf8ByteSpan): string {
  return `bytes ${span.startByte}–${span.endByte}`
}
