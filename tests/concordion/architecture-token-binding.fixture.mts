import { parseFlowchartSource, type CanonicalNode } from '../../src/domain/architectureTokens/mermaidFlowchart.ts'
import {
  fingerprintFlowchartNode,
  reconcileFlowchartNodes,
  type RevisionElement,
} from '../../src/domain/architectureTokens/reconcileFlowchartNodes.ts'

type ScenarioId =
  | 'safe_relocation'
  | 'same_id_recreated'
  | 'split'
  | 'merge'
  | 'removed'
  | 'unsupported'

type Scenario = Readonly<{
  oldSource: string
  newSource: string
  oldNativeIds: readonly string[]
  relocatedNativeIds?: readonly string[]
}>

type ProductOutcome = Readonly<{
  status: string
  transfer: boolean
  reason: string
}>

const scenarios: Readonly<Record<ScenarioId, Scenario>> = {
  safe_relocation: {
    oldSource: 'flowchart TD\nOrders[Orders API] --> Events[Events]',
    newSource: 'flowchart TD\n%% deployment view\nOrders[Orders API] --> Events[Events]',
    oldNativeIds: ['Orders'],
    relocatedNativeIds: ['Orders'],
  },
  same_id_recreated: {
    oldSource: 'flowchart TD\nOrders[Orders API] --> Events[Events]',
    newSource: 'flowchart TD\nOrders[Recreated Orders API] --> Events[Events]',
    oldNativeIds: ['Orders'],
  },
  split: {
    oldSource: 'flowchart TD\nOrders[Orders API] --> Gateway[Gateway]',
    newSource: 'flowchart TD\nOrdersRead[Orders API] --> Gateway[Gateway]\nOrdersWrite[Orders API] --> Gateway[Gateway]',
    oldNativeIds: ['Orders'],
  },
  merge: {
    oldSource: 'flowchart TD\nOrdersRead[Orders API] --> Gateway[Gateway]\nOrdersWrite[Orders API] --> Gateway[Gateway]',
    newSource: 'flowchart TD\nOrders[Orders API] --> Gateway[Gateway]',
    oldNativeIds: ['OrdersRead', 'OrdersWrite'],
  },
  removed: {
    oldSource: 'flowchart TD\nOrders[Orders API] --> Events[Events]',
    newSource: 'flowchart TD\nEvents[Events]',
    oldNativeIds: ['Orders'],
  },
  unsupported: {
    oldSource: 'flowchart TD\nOrders[Orders API] --> Events[Events]',
    newSource: 'flowchart TD\nOrders@{ shape: rect } --> Events[Events]',
    oldNativeIds: ['Orders'],
  },
}

const readerFacingScenarioIds: Readonly<Record<string, ScenarioId>> = {
  'Move an unchanged Orders API node': 'safe_relocation',
  'Delete and recreate a node with the same Mermaid ID': 'same_id_recreated',
  'Split one node into two nodes': 'split',
  'Merge two nodes into one node': 'merge',
  'Remove a node without a replacement': 'removed',
  'Use syntax this release does not support': 'unsupported',
}

/**
 * Fixture for the executable user-facing Flowchart binding safety contract.
 * It has no Confluence, backend, or D1 dependency: the public-domain parser
 * and fail-closed reconciler are the system under specification.
 */
export class ArchitectureTokenBindingFixture {
  private current: ProductOutcome = {
    status: 'not_run',
    transfer: false,
    reason: 'not_run',
  }

  evaluateScenario(row: Record<'Scenario', string>): void {
    const scenario = scenarios[asScenarioId(row.Scenario)]
    const oldModel = parseSupported(scenario.oldSource)
    const newResult = parseFlowchartSource(scenario.newSource)
    if (newResult.kind !== 'ok') {
      this.current = {
        status: 'unsupported_source',
        transfer: false,
        reason: newResult.reason,
      }
      return
    }

    const oldElements = scenario.oldNativeIds.map((nativeId) => toRevisionElement(oldModel.nodes, nativeId))
    const decisions = reconcileFlowchartNodes({
      oldElements,
      newNodes: newResult.model.nodes,
      relocatedPairs: (scenario.relocatedNativeIds ?? []).map((nativeId) => ({
        diagramElementId: `element-${nativeId}`,
        newNativeId: nativeId,
      })),
    }).decisions
    const statuses = [...new Set(decisions.map((decision) => decision.status))]
    const reasons = [...new Set(decisions.flatMap((decision) => decision.reasons))].sort()
    this.current = {
      status: statuses.length === 1 ? statuses[0] : 'mixed',
      transfer: decisions.length > 0 && decisions.every((decision) => decision.status === 'confirmed_automatic'),
      reason: reasons.join(', '),
    }
  }

  status(): string { return this.current.status }
  bindingTransferred(): boolean { return this.current.transfer }
  reason(): string { return this.current.reason }
}

function asScenarioId(value: string): ScenarioId {
  const scenarioId = readerFacingScenarioIds[value]
  if (!scenarioId) throw new Error(`Unknown Architecture Tokens scenario: ${value}`)
  return scenarioId
}

function parseSupported(source: string) {
  const result = parseFlowchartSource(source)
  if (result.kind !== 'ok') throw new Error(`Fixture source must be supported: ${result.reason}`)
  return result.model
}

function toRevisionElement(nodes: readonly CanonicalNode[], nativeId: string): RevisionElement {
  const node = nodes.find((candidate) => candidate.nativeId === nativeId)
  if (!node) throw new Error(`Fixture source has no node ${nativeId}`)
  return {
    diagramElementId: `element-${nativeId}`,
    fingerprint: fingerprintFlowchartNode(node),
  }
}
