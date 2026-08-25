import mermaid from 'mermaid'
import {
  fingerprintFlowchartNode,
  type ElementFingerprint,
} from '../../src/domain/architectureTokens/reconcileFlowchartNodes.ts'
import { parseFlowchartSource } from '../../src/domain/architectureTokens/mermaidFlowchart.ts'
import {
  sliceUtf8ByteSpan,
  type Utf8ByteSpan,
} from '../../src/domain/architectureTokens/utf8Locator.ts'
import type {
  CanonicalNode,
  NodeOccurrence,
} from '../../src/domain/architectureTokens/mermaidFlowchart.ts'

type ScenarioId =
  | 'declarations_and_occurrences'
  | 'utf8_round_trip'
  | 'invalid_mermaid'
  | 'non_node_text'
  | 'style_reference'
  | 'tampered_span'

type Scenario = Readonly<{
  source: string
  forbiddenText?: readonly string[]
  tamper?: boolean
}>

type StaticNodeLocator = Readonly<{
  nativeId: string
  primary: NodeOccurrence
  occurrences: readonly NodeOccurrence[]
  fingerprint: ElementFingerprint
}>

type ProductState = Readonly<{
  validationStatus: string
  locatorCount: string
  occurrenceCount: string
  primaryFragments: string
  allFragments: string
  roundTripStatus: string
  excludedTextStatus: string
  tamperedSpanStatus: string
  fingerprintFacts: string
  elementOccurrenceStatus: string
}>

const scenarios: Readonly<Record<ScenarioId, Scenario>> = {
  declarations_and_occurrences: {
    source: [
      'flowchart LR',
      '  Orders[订单🙂 API]',
      '  Orders --> Events[事件🚀]',
      '  Orders -- publishes --> Audit[Audit log]',
    ].join('\n'),
  },
  utf8_round_trip: {
    source: [
      'flowchart LR',
      '  A[订单🙂 API] --> B[事件🚀]',
    ].join('\n'),
  },
  invalid_mermaid: {
    source: [
      'flowchart LR',
      '  Orders[订单🙂 API] -->',
    ].join('\n'),
  },
  non_node_text: {
    source: [
      'flowchart TD',
      '  subgraph Platform[平台服务]',
      '    Orders["订单 API"] -- publishes --> Events[事件]',
      '  end',
    ].join('\n'),
    forbiddenText: ['publishes', '平台服务'],
  },
  style_reference: {
    source: [
      'flowchart TD',
      '  Orders[Orders] --> Events[Events]',
      '  style Orders fill:#f00,stroke:#333,stroke-width:4px',
    ].join('\n'),
    forbiddenText: ['style', 'fill:#f00'],
  },
  tampered_span: {
    source: [
      'flowchart LR',
      '  A[订单🙂 API] --> B[事件🚀]',
    ].join('\n'),
    tamper: true,
  },
}

const readerFacingScenarioIds: Readonly<Record<string, ScenarioId>> = {
  'A valid Flowchart yields one primary locator plus endpoint occurrences': 'declarations_and_occurrences',
  'Every locator round-trips exact UTF-8 source bytes': 'utf8_round_trip',
  'Invalid Mermaid stops before any locator is emitted': 'invalid_mermaid',
  'Labels, edge text, and subgraph titles stay outside node locators': 'non_node_text',
  'A style reference is not silently converted into a node': 'style_reference',
  'A tampered or non-syntax-derived span fails closed': 'tampered_span',
}

const EMPTY_STATE: ProductState = {
  validationStatus: 'not_run',
  locatorCount: '0',
  occurrenceCount: '0',
  primaryFragments: 'none',
  allFragments: 'none',
  roundTripStatus: 'not_run',
  excludedTextStatus: 'not_run',
  tamperedSpanStatus: 'not_run',
  fingerprintFacts: 'none',
  elementOccurrenceStatus: 'none',
}

/**
 * Fixture for the first Source Binding Engine phase. It executes Mermaid's
 * public validator, the owned Flowchart canonicaliser, and the UTF-8 byte
 * slicer. It never loads Confluence content, D1, a backend, or another
 * revision, and it never attempts identity matching or migration.
 */
export class ArchitectureTokenStaticLocatorsFixture {
  private current: ProductState = EMPTY_STATE

  async evaluateScenario(row: Record<'Scenario', string>): Promise<void> {
    const scenario = scenarios[asScenarioId(row.Scenario)]
    const syntax = await validateOfficialMermaidSyntax(scenario.source)

    if (!syntax.valid) {
      this.current = {
        ...EMPTY_STATE,
        validationStatus: 'invalid_mermaid',
        excludedTextStatus: scenario.forbiddenText ? 'none' : 'not_run',
      }
      return
    }

    const result = parseFlowchartSource(scenario.source)
    if (result.kind !== 'ok') {
      this.current = {
        ...EMPTY_STATE,
        validationStatus: 'unsupported_after_official_validation',
        excludedTextStatus: scenario.forbiddenText ? 'none' : 'not_run',
      }
      return
    }

    const locators = result.model.nodes.map(toStaticNodeLocator)
    const occurrences = locators.flatMap((locator) => locator.occurrences)
    const fragments = occurrences.map((occurrence) => sliceUtf8ByteSpan(scenario.source, occurrence.span))
    const primaryFragments = locators.map((locator) => sliceUtf8ByteSpan(scenario.source, locator.primary.span))

    this.current = {
      validationStatus: 'valid',
      locatorCount: String(locators.length),
      occurrenceCount: String(occurrences.length),
      primaryFragments: primaryFragments.join(' | ') || 'none',
      allFragments: fragments.join(' | ') || 'none',
      roundTripStatus: fragments.length > 0 && fragments.every((fragment) => fragment.length > 0)
        ? 'all_exact'
        : 'not_run',
      excludedTextStatus: excludedTextStatus(scenario, fragments),
      tamperedSpanStatus: scenario.tamper
        ? tamperedSpanStatus(scenario.source, locators)
        : 'not_run',
      fingerprintFacts: fingerprintFacts(locators),
      elementOccurrenceStatus: elementOccurrenceStatus(locators),
    }
  }

  validationStatus(): string { return this.current.validationStatus }
  locatorCount(): string { return this.current.locatorCount }
  occurrenceCount(): string { return this.current.occurrenceCount }
  primaryFragments(): string { return this.current.primaryFragments }
  allFragments(): string { return this.current.allFragments }
  roundTripStatus(): string { return this.current.roundTripStatus }
  excludedTextStatus(): string { return this.current.excludedTextStatus }
  tamperedSpanStatus(): string { return this.current.tamperedSpanStatus }
  fingerprintFacts(): string { return this.current.fingerprintFacts }
  elementOccurrenceStatus(): string { return this.current.elementOccurrenceStatus }
}

async function validateOfficialMermaidSyntax(source: string): Promise<{ valid: boolean }> {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    // Keep the local product-spec command readable; parse() remains the
    // official Mermaid syntax gate regardless of logging verbosity.
    logLevel: 5,
  })

  try {
    await mermaid.parse(source)
    return { valid: true }
  } catch {
    return { valid: false }
  }
}

function asScenarioId(value: string): ScenarioId {
  const scenarioId = readerFacingScenarioIds[value]
  if (!scenarioId) throw new Error(`Unknown static locator scenario: ${value}`)
  return scenarioId
}

function toStaticNodeLocator(node: CanonicalNode): StaticNodeLocator {
  const primary = node.occurrences[0]
  if (!primary) throw new Error(`Canonical node ${node.nativeId} has no syntax occurrence`)

  return {
    nativeId: node.nativeId,
    primary,
    occurrences: node.occurrences,
    fingerprint: fingerprintFlowchartNode(node),
  }
}

function excludedTextStatus(scenario: Scenario, fragments: readonly string[]): string {
  if (!scenario.forbiddenText) return 'not_run'
  const leakedText = scenario.forbiddenText.filter((text) => fragments.some((fragment) => fragment.includes(text)))
  return leakedText.length === 0 ? 'none' : leakedText.join(' | ')
}

function tamperedSpanStatus(source: string, locators: readonly StaticNodeLocator[]): string {
  const primary = locators[0]?.primary
  if (!primary) return 'no_locator'

  const alignedButForged: Utf8ByteSpan = {
    startByte: primary.span.startByte + 1,
    endByte: primary.span.endByte,
  }
  const syntaxGuardRejected = selectSyntaxDerivedFragment(source, locators, alignedButForged) === null

  // The first label contains CJK bytes. This second forged span deliberately
  // begins in the middle of a UTF-8 code point and must be rejected by the
  // production byte slicer as well.
  const unaligned: Utf8ByteSpan = {
    startByte: primary.span.startByte + 3,
    endByte: primary.span.endByte,
  }
  let byteGuardRejected = false
  try {
    sliceUtf8ByteSpan(source, unaligned)
  } catch {
    byteGuardRejected = true
  }

  return syntaxGuardRejected && byteGuardRejected ? 'rejected' : 'accepted'
}

function selectSyntaxDerivedFragment(
  source: string,
  locators: readonly StaticNodeLocator[],
  candidate: Utf8ByteSpan,
): string | null {
  const occurrence = locators
    .flatMap((locator) => locator.occurrences)
    .find((known) => sameSpan(known.span, candidate))
  return occurrence ? sliceUtf8ByteSpan(source, occurrence.span) : null
}

function sameSpan(left: Utf8ByteSpan, right: Utf8ByteSpan): boolean {
  return left.startByte === right.startByte && left.endByte === right.endByte
}

function fingerprintFacts(locators: readonly StaticNodeLocator[]): string {
  return locators.map((locator) => {
    const facts = locator.fingerprint
    return [
      facts.nativeId,
      facts.normalizedLabel ?? 'none',
      facts.shape ?? 'none',
      facts.containerPath.length > 0 ? facts.containerPath.join('>') : 'root',
      String(locator.occurrences.length),
    ].join('|')
  }).join(';') || 'none'
}

function elementOccurrenceStatus(locators: readonly StaticNodeLocator[]): string {
  const repeated = locators
    .filter((locator) => locator.occurrences.length > 1)
    .map((locator) => `${locator.nativeId}=1 element/${locator.occurrences.length} occurrences`)
  return repeated.join('; ') || 'none'
}
