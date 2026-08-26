/**
 * Confluence-first v1 state for Architecture Token source binding.
 *
 * This module deliberately owns only the `metadata.architectureTokenBindingV1`
 * namespace. It is a browser-safe strict codec: malformed or oversized data is
 * rejected so a normal diagram save cannot silently overwrite binding evidence.
 */

export const ARCHITECTURE_TOKEN_BINDING_MAX_BYTES = 32 * 1024;
export const ARCHITECTURE_TOKEN_BINDING_NAMESPACE = 'architectureTokenBindingV1' as const;

export interface ArchitectureTokenBindingStateV1 {
  readonly schemaVersion: 'architectureTokenBindingV1';
  readonly sourceType: 'mermaid_flowchart';
  readonly currentRevisionId: string;
  readonly revisions: readonly SourceRevisionRecord[];
  readonly elements: readonly DiagramElementRecord[];
  readonly revisionElements: readonly RevisionElementRecord[];
  readonly bindings: readonly TokenBindingRecord[];
  readonly audit: readonly BindingAuditRecord[];
}

export interface SourceRevisionRecord {
  readonly sourceRevisionId: string;
  readonly sourceId: string;
  readonly parentSourceRevisionId?: string;
  readonly normalizedSourceSha256: string;
  readonly parserVersion: string;
  readonly validationStatus: 'valid' | 'invalid' | 'unsupported';
  readonly capturedAt: string;
}

export interface DiagramElementRecord {
  readonly diagramElementId: string;
  readonly kind: 'node';
  readonly createdInRevisionId: string;
  readonly lifecycleStatus: 'active' | 'unresolved' | 'orphaned' | 'retired';
}

export interface RevisionLocatorRecord {
  readonly locatorId: string;
  readonly sourceRevisionId: string;
  readonly diagramElementId: string;
  readonly locatorKind: 'utf8_byte_span';
  readonly spanStartByte: number;
  readonly spanEndByte: number;
  readonly statementSpanStartByte: number;
  readonly statementSpanEndByte: number;
  readonly occurrenceRole: 'declaration' | 'edge_endpoint';
  readonly occurrenceIndex: number;
  readonly nativeId?: string;
}

export interface StoredStaticFingerprint {
  readonly fingerprintVersion: 'flowchart_node_static_v1';
  readonly nativeId: string;
  readonly normalizedLabel: string | null;
  readonly shape: string | null;
  readonly containerPath: readonly string[];
  readonly statementContexts: readonly string[];
  readonly neighborNativeIds: readonly string[];
}

export interface RevisionElementRecord {
  readonly sourceRevisionId: string;
  readonly diagramElementId: string;
  readonly primaryLocatorId: string;
  readonly locators: readonly RevisionLocatorRecord[];
  readonly fingerprint: StoredStaticFingerprint;
  readonly provenance: Readonly<{
    extraction: 'static_source_ingestion';
    parserVersion: string;
    policyVersion: string;
    recordedAt: string;
  }>;
}

export interface TokenBindingRecord {
  readonly tokenBindingId: string;
  readonly diagramElementId: string;
  readonly logicalTokenId: string;
  readonly tokenId?: string;
  readonly status: 'confirmed' | 'unresolved' | 'orphaned' | 'retired';
  readonly confirmationMethod: 'user' | 'reconciliation';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provenance: Readonly<{
    source: 'user_confirmation' | 'reconciliation';
    recordedAt: string;
  }>;
}

export interface BindingAuditRecord {
  readonly auditId: string;
  readonly kind: 'static_ingestion' | 'reconciliation' | 'binding_action';
  readonly sourceRevisionId: string;
  readonly outcome: 'accepted' | 'rejected' | 'unresolved';
  readonly reasons: readonly string[];
  readonly algorithmVersion: string;
  readonly recordedAt: string;
}

export type ArchitectureTokenBindingStateResult<T> =
  | Readonly<{ kind: 'ok'; value: T; byteLength: number }>
  | Readonly<{ kind: 'rejected'; reason: 'invalid_metadata' | 'invalid_state' | 'oversize_state' }>;

const encoder = new TextEncoder();

export function encodeArchitectureTokenBindingState(value: unknown): ArchitectureTokenBindingStateResult<string> {
  if (!isBindingState(value)) return { kind: 'rejected', reason: 'invalid_state' };
  const encoded = JSON.stringify(value);
  const byteLength = encoder.encode(encoded).byteLength;
  if (byteLength > ARCHITECTURE_TOKEN_BINDING_MAX_BYTES) return { kind: 'rejected', reason: 'oversize_state' };
  return { kind: 'ok', value: encoded, byteLength };
}

export function readArchitectureTokenBindingState(metadata: unknown): ArchitectureTokenBindingStateResult<ArchitectureTokenBindingStateV1 | null> {
  if (!isRecord(metadata)) return { kind: 'rejected', reason: 'invalid_metadata' };
  if (!Object.prototype.hasOwnProperty.call(metadata, ARCHITECTURE_TOKEN_BINDING_NAMESPACE)) {
    return { kind: 'ok', value: null, byteLength: 0 };
  }
  const raw = metadata[ARCHITECTURE_TOKEN_BINDING_NAMESPACE];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { kind: 'rejected', reason: 'invalid_state' };
    }
  }
  const encoded = encodeArchitectureTokenBindingState(parsed);
  if (encoded.kind !== 'ok') return encoded;
  return { kind: 'ok', value: parsed as ArchitectureTokenBindingStateV1, byteLength: encoded.byteLength };
}

export function mergeArchitectureTokenBindingMetadata(
  metadata: unknown,
  state: unknown,
): ArchitectureTokenBindingStateResult<Record<string, unknown>> {
  if (metadata !== undefined && !isRecord(metadata)) return { kind: 'rejected', reason: 'invalid_metadata' };
  const encoded = encodeArchitectureTokenBindingState(state);
  if (encoded.kind !== 'ok') return encoded;
  return {
    kind: 'ok',
    value: {
      ...(metadata ?? {}),
      [ARCHITECTURE_TOKEN_BINDING_NAMESPACE]: JSON.parse(encoded.value) as ArchitectureTokenBindingStateV1,
    },
    byteLength: encoded.byteLength,
  };
}

function isBindingState(value: unknown): value is ArchitectureTokenBindingStateV1 {
  if (!hasExactKeys(value, ['schemaVersion', 'sourceType', 'currentRevisionId', 'revisions', 'elements', 'revisionElements', 'bindings', 'audit'])) return false;
  const state = value as ArchitectureTokenBindingStateV1;
  if (state.schemaVersion !== 'architectureTokenBindingV1' || state.sourceType !== 'mermaid_flowchart' || !isIdentifier(state.currentRevisionId)) return false;
  if (!Array.isArray(state.revisions) || !Array.isArray(state.elements) || !Array.isArray(state.revisionElements) || !Array.isArray(state.bindings) || !Array.isArray(state.audit)) return false;
  if (!state.revisions.every(isSourceRevision) || !state.elements.every(isElement) || !state.revisionElements.every(isRevisionElement) || !state.bindings.every(isBinding) || !state.audit.every(isAudit)) return false;

  const revisionIds = ids(state.revisions, (item) => item.sourceRevisionId);
  const elementIds = ids(state.elements, (item) => item.diagramElementId);
  const bindingIds = ids(state.bindings, (item) => item.tokenBindingId);
  if (!revisionIds || !elementIds || !bindingIds || !revisionIds.has(state.currentRevisionId)) return false;
  // The current custom-content body is deliberately bounded. A parent may live
  // only in Confluence version history, so it need not be duplicated here.
  if (!state.elements.every((element) => revisionIds.has(element.createdInRevisionId))) return false;
  if (!state.revisionElements.every((entry) => validateRevisionElementReferences(entry, revisionIds, elementIds))) return false;
  if (!state.bindings.every((binding) => elementIds.has(binding.diagramElementId))) return false;
  return state.audit.every((audit) => revisionIds.has(audit.sourceRevisionId));
}

function isSourceRevision(value: unknown): value is SourceRevisionRecord {
  if (!hasExactKeys(value, ['sourceRevisionId', 'sourceId', 'normalizedSourceSha256', 'parserVersion', 'validationStatus', 'capturedAt'], ['parentSourceRevisionId'])) return false;
  const item = value as SourceRevisionRecord;
  return isIdentifier(item.sourceRevisionId)
    && isIdentifier(item.sourceId)
    && (item.parentSourceRevisionId === undefined || isIdentifier(item.parentSourceRevisionId))
    && /^[a-f0-9]{64}$/i.test(item.normalizedSourceSha256)
    && isIdentifier(item.parserVersion)
    && ['valid', 'invalid', 'unsupported'].includes(item.validationStatus)
    && isTimestamp(item.capturedAt);
}

function isElement(value: unknown): value is DiagramElementRecord {
  if (!hasExactKeys(value, ['diagramElementId', 'kind', 'createdInRevisionId', 'lifecycleStatus'])) return false;
  const item = value as DiagramElementRecord;
  return isIdentifier(item.diagramElementId)
    && item.kind === 'node'
    && isIdentifier(item.createdInRevisionId)
    && ['active', 'unresolved', 'orphaned', 'retired'].includes(item.lifecycleStatus);
}

function isRevisionElement(value: unknown): value is RevisionElementRecord {
  if (!hasExactKeys(value, ['sourceRevisionId', 'diagramElementId', 'primaryLocatorId', 'locators', 'fingerprint', 'provenance'])) return false;
  const item = value as RevisionElementRecord;
  return isIdentifier(item.sourceRevisionId)
    && isIdentifier(item.diagramElementId)
    && isIdentifier(item.primaryLocatorId)
    && Array.isArray(item.locators)
    && item.locators.length > 0
    && item.locators.every(isLocator)
    && isFingerprint(item.fingerprint)
    && isRevisionProvenance(item.provenance);
}

function validateRevisionElementReferences(
  entry: RevisionElementRecord,
  revisionIds: ReadonlySet<string>,
  elementIds: ReadonlySet<string>,
): boolean {
  if (!revisionIds.has(entry.sourceRevisionId) || !elementIds.has(entry.diagramElementId)) return false;
  const locatorIds = ids(entry.locators, (locator) => locator.locatorId);
  return locatorIds !== null
    && locatorIds.has(entry.primaryLocatorId)
    && entry.locators.every((locator) => locator.sourceRevisionId === entry.sourceRevisionId && locator.diagramElementId === entry.diagramElementId);
}

function isLocator(value: unknown): value is RevisionLocatorRecord {
  if (!hasExactKeys(value, ['locatorId', 'sourceRevisionId', 'diagramElementId', 'locatorKind', 'spanStartByte', 'spanEndByte', 'statementSpanStartByte', 'statementSpanEndByte', 'occurrenceRole', 'occurrenceIndex'], ['nativeId'])) return false;
  const item = value as RevisionLocatorRecord;
  return isIdentifier(item.locatorId)
    && isIdentifier(item.sourceRevisionId)
    && isIdentifier(item.diagramElementId)
    && item.locatorKind === 'utf8_byte_span'
    && isByteSpan(item.spanStartByte, item.spanEndByte)
    && isByteSpan(item.statementSpanStartByte, item.statementSpanEndByte)
    && item.statementSpanStartByte <= item.spanStartByte
    && item.spanEndByte <= item.statementSpanEndByte
    && ['declaration', 'edge_endpoint'].includes(item.occurrenceRole)
    && isNonNegativeInteger(item.occurrenceIndex)
    && (item.nativeId === undefined || isIdentifier(item.nativeId));
}

function isFingerprint(value: unknown): value is StoredStaticFingerprint {
  if (!hasExactKeys(value, ['fingerprintVersion', 'nativeId', 'normalizedLabel', 'shape', 'containerPath', 'statementContexts', 'neighborNativeIds'])) return false;
  const item = value as StoredStaticFingerprint;
  return item.fingerprintVersion === 'flowchart_node_static_v1'
    && isIdentifier(item.nativeId)
    && isNullableString(item.normalizedLabel)
    && isNullableString(item.shape)
    && isStringArray(item.containerPath)
    && isStringArray(item.statementContexts)
    && isStringArray(item.neighborNativeIds);
}

function isRevisionProvenance(value: unknown): value is RevisionElementRecord['provenance'] {
  if (!hasExactKeys(value, ['extraction', 'parserVersion', 'policyVersion', 'recordedAt'])) return false;
  const item = value as RevisionElementRecord['provenance'];
  return item.extraction === 'static_source_ingestion'
    && isIdentifier(item.parserVersion)
    && isIdentifier(item.policyVersion)
    && isTimestamp(item.recordedAt);
}

function isBinding(value: unknown): value is TokenBindingRecord {
  if (!hasExactKeys(value, ['tokenBindingId', 'diagramElementId', 'logicalTokenId', 'status', 'confirmationMethod', 'createdAt', 'updatedAt', 'provenance'], ['tokenId'])) return false;
  const item = value as TokenBindingRecord;
  return isIdentifier(item.tokenBindingId)
    && isIdentifier(item.diagramElementId)
    && isIdentifier(item.logicalTokenId)
    && (item.tokenId === undefined || isIdentifier(item.tokenId))
    && ['confirmed', 'unresolved', 'orphaned', 'retired'].includes(item.status)
    && ['user', 'reconciliation'].includes(item.confirmationMethod)
    && isTimestamp(item.createdAt)
    && isTimestamp(item.updatedAt)
    && isBindingProvenance(item.provenance);
}

function isBindingProvenance(value: unknown): value is TokenBindingRecord['provenance'] {
  if (!hasExactKeys(value, ['source', 'recordedAt'])) return false;
  const item = value as TokenBindingRecord['provenance'];
  return ['user_confirmation', 'reconciliation'].includes(item.source) && isTimestamp(item.recordedAt);
}

function isAudit(value: unknown): value is BindingAuditRecord {
  if (!hasExactKeys(value, ['auditId', 'kind', 'sourceRevisionId', 'outcome', 'reasons', 'algorithmVersion', 'recordedAt'])) return false;
  const item = value as BindingAuditRecord;
  return isIdentifier(item.auditId)
    && ['static_ingestion', 'reconciliation', 'binding_action'].includes(item.kind)
    && isIdentifier(item.sourceRevisionId)
    && ['accepted', 'rejected', 'unresolved'].includes(item.outcome)
    && isStringArray(item.reasons)
    && item.reasons.length > 0
    && isIdentifier(item.algorithmVersion)
    && isTimestamp(item.recordedAt);
}

function hasExactKeys(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ids<T>(items: readonly T[], select: (item: T) => string): Set<string> | null {
  const values = new Set<string>();
  for (const item of items) {
    const id = select(item);
    if (values.has(id)) return null;
    values.add(id);
  }
  return values;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isByteSpan(start: unknown, end: unknown): boolean {
  return isNonNegativeInteger(start) && isNonNegativeInteger(end) && start <= end;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
