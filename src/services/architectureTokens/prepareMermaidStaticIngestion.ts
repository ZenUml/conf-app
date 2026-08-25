import { type Diagram, DiagramType } from '@/model/Diagram/Diagram';
import {
  mergeArchitectureTokenBindingMetadata,
  readArchitectureTokenBindingState,
  type ArchitectureTokenBindingStateV1,
  type DiagramElementRecord,
  type RevisionElementRecord,
} from '@/domain/architectureTokens/architectureTokenBindingState';
import { fingerprintStaticFlowchartNode } from '@/domain/architectureTokens/flowchartStaticFingerprint';
import type { CanonicalFlowchart, CanonicalNode, NodeOccurrence } from '@/domain/architectureTokens/mermaidFlowchart';
import { sha256NormalizedSource } from '@/domain/architectureTokens/sourceRevision';
import {
  validateMermaidFlowchart,
  type FlowchartLocatorEvidence,
  type ValidatedFlowchartResult,
} from '@/domain/architectureTokens/validateMermaidFlowchart';
import { reconcileBoundMermaidSourceChange } from './reconcileBoundMermaidSourceChange';

const PARSER_VERSION = 'mermaid-flowchart-canonical-v1';
const POLICY_VERSION = 'architecture-token-binding-v1';

export class ArchitectureTokenStaticIngestionError extends Error {
  constructor(readonly reason: 'invalid_state' | 'oversize_state' | 'invalid_metadata' | 'source_change_requires_reconciliation') {
    super(`Architecture Token static ingestion refused: ${reason}`);
    this.name = 'ArchitectureTokenStaticIngestionError';
  }
}

export type MermaidStaticIngestionOutcome =
  | Readonly<{ kind: 'not_applicable' }>
  | Readonly<{ kind: 'captured'; sourceRevisionState: 'captured' }>
  | Readonly<{ kind: 'unchanged'; sourceRevisionState: 'unchanged' }>
  | Readonly<{ kind: 'invalid'; sourceRevisionState: 'invalid' }>
  | Readonly<{ kind: 'unsupported'; sourceRevisionState: 'unsupported' }>
  | Readonly<{ kind: 'reconciled'; sourceRevisionState: 'reconciled'; bindingOutcome: 'accepted' | 'unresolved' }>;

export type MermaidStaticIngestionDependencies = Readonly<{
  validate?: (source: string) => Promise<ValidatedFlowchartResult>;
  createId?: () => string;
  now?: () => string;
}>;

/**
 * Captures only the current, valid Flowchart revision before Diagram persistence.
 * A changed, already-bound source is delegated to the separate reconciliation
 * seam. It receives only an in-memory load-time source snapshot, and persists
 * no binding transfer unless the stronger exact-relocation gate is met.
 */
export async function prepareMermaidStaticIngestion(
  diagram: Diagram,
  dependencies: MermaidStaticIngestionDependencies = {},
): Promise<MermaidStaticIngestionOutcome> {
  if (diagram.diagramType !== DiagramType.Mermaid) return { kind: 'not_applicable' };

  const decoded = readArchitectureTokenBindingState(diagram.metadata ?? {});
  if (decoded.kind !== 'ok') throw new ArchitectureTokenStaticIngestionError(decoded.reason);

  const validation = await (dependencies.validate ?? validateMermaidFlowchart)(diagram.mermaidCode ?? '');
  if (validation.kind === 'invalid') return { kind: 'invalid', sourceRevisionState: 'invalid' };
  if (validation.kind === 'unsupported') return { kind: 'unsupported', sourceRevisionState: 'unsupported' };

  const sourceHash = await sha256NormalizedSource(diagram.mermaidCode ?? '');
  const existing = decoded.value;
  const current = existing?.revisions.find((revision) => revision.sourceRevisionId === existing.currentRevisionId);
  if (current?.normalizedSourceSha256 === sourceHash) return { kind: 'unchanged', sourceRevisionState: 'unchanged' };
  if (existing && existing.bindings.length > 0) {
    if (typeof diagram.architectureTokenBindingLoadedSource !== 'string') {
      throw new ArchitectureTokenStaticIngestionError('source_change_requires_reconciliation');
    }
    const reconciliation = await reconcileBoundMermaidSourceChange({
      previousState: existing,
      previousSource: diagram.architectureTokenBindingLoadedSource,
      nextSource: diagram.mermaidCode ?? '',
      nextValidation: validation,
      dependencies,
    });
    if (reconciliation.kind === 'unavailable') {
      throw new ArchitectureTokenStaticIngestionError('source_change_requires_reconciliation');
    }
    const merged = mergeArchitectureTokenBindingMetadata(diagram.metadata ?? {}, reconciliation.state);
    if (merged.kind !== 'ok') throw new ArchitectureTokenStaticIngestionError(merged.reason);
    diagram.metadata = merged.value;
    return {
      kind: 'reconciled',
      sourceRevisionState: 'reconciled',
      bindingOutcome: reconciliation.outcome,
    };
  }

  const createId = dependencies.createId ?? (() => crypto.randomUUID());
  const now = dependencies.now ?? (() => new Date().toISOString());
  const state = buildCurrentRevisionState(
    validation.model,
    validation.locatorEvidence.kind,
    sourceHash,
    current?.sourceId ?? `source-${createId()}`,
    createId,
    now,
  );
  const merged = mergeArchitectureTokenBindingMetadata(diagram.metadata ?? {}, state);
  if (merged.kind !== 'ok') throw new ArchitectureTokenStaticIngestionError(merged.reason);
  diagram.metadata = merged.value;
  return { kind: 'captured', sourceRevisionState: 'captured' };
}

export function buildCurrentRevisionState(
  model: CanonicalFlowchart,
  locatorEvidence: FlowchartLocatorEvidence['kind'],
  normalizedSourceSha256: string,
  sourceId: string,
  createId: () => string,
  now: () => string,
): ArchitectureTokenBindingStateV1 {
  const recordedAt = now();
  const sourceRevisionId = `revision-${createId()}`;
  const elements: DiagramElementRecord[] = [];
  const revisionElements: RevisionElementRecord[] = [];

  for (const node of model.nodes) {
    const diagramElementId = `element-${createId()}`;
    const locators = node.occurrences.map((occurrence, occurrenceIndex) => locatorFor(
      occurrence,
      occurrenceIndex,
      sourceRevisionId,
      diagramElementId,
      node.nativeId,
      createId,
    ));
    const primaryLocatorId = locators[indexOfPrimaryOccurrence(node)]?.locatorId;
    if (!primaryLocatorId) throw new ArchitectureTokenStaticIngestionError('invalid_state');
    const facts = fingerprintStaticFlowchartNode(node);
    elements.push({
      diagramElementId,
      kind: 'node',
      createdInRevisionId: sourceRevisionId,
      lifecycleStatus: 'active',
    });
    revisionElements.push({
      sourceRevisionId,
      diagramElementId,
      primaryLocatorId,
      locators,
      fingerprint: {
        fingerprintVersion: facts.fingerprintVersion,
        nativeId: facts.syntax.nativeId,
        normalizedLabel: facts.syntax.normalizedLabel,
        shape: facts.syntax.shape,
        containerPath: facts.structural.containerPath,
        statementContexts: facts.structural.statementContexts,
        neighborNativeIds: facts.structural.incidentNeighborNativeIds,
      },
      provenance: {
        extraction: 'static_source_ingestion',
        parserVersion: PARSER_VERSION,
        policyVersion: POLICY_VERSION,
        recordedAt,
      },
    });
  }

  return {
    schemaVersion: 'architectureTokenBindingV1',
    sourceType: 'mermaid_flowchart',
    currentRevisionId: sourceRevisionId,
    revisions: [{
      sourceRevisionId,
      sourceId,
      normalizedSourceSha256,
      parserVersion: PARSER_VERSION,
      validationStatus: 'valid',
      capturedAt: recordedAt,
    }],
    elements,
    revisionElements,
    bindings: [],
    audit: [{
      auditId: `audit-${createId()}`,
      kind: 'static_ingestion',
      sourceRevisionId,
      outcome: 'accepted',
      reasons: ['public_syntax_valid', 'flowchart_nodes_located', locatorEvidenceReason(locatorEvidence)],
      algorithmVersion: POLICY_VERSION,
      recordedAt,
    }],
  };
}

function locatorFor(
  occurrence: NodeOccurrence,
  occurrenceIndex: number,
  sourceRevisionId: string,
  diagramElementId: string,
  nativeId: string,
  createId: () => string,
) {
  return {
    locatorId: `locator-${createId()}`,
    sourceRevisionId,
    diagramElementId,
    locatorKind: 'utf8_byte_span' as const,
    spanStartByte: occurrence.span.startByte,
    spanEndByte: occurrence.span.endByte,
    statementSpanStartByte: occurrence.statementSpan.startByte,
    statementSpanEndByte: occurrence.statementSpan.endByte,
    occurrenceRole: occurrence.role,
    occurrenceIndex,
    nativeId,
  };
}

function indexOfPrimaryOccurrence(node: CanonicalNode): number {
  return node.occurrences.findIndex((occurrence) => occurrence.role === node.primaryOccurrence.role
    && occurrence.span.startByte === node.primaryOccurrence.span.startByte
    && occurrence.span.endByte === node.primaryOccurrence.span.endByte);
}

function locatorEvidenceReason(locatorEvidence: 'jison_preferred' | 'legacy_handwritten'): 'jison_preferred' | 'legacy_handwritten' {
  return locatorEvidence;
}
