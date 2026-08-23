import { Transaction } from '@codemirror/state';
import type { Text } from '@codemirror/state';
import { diffChars, diffLines } from 'diff';
import { trackAnalyticsEvent } from './trackAnalyticsEvent';
import { readCopyAttribution } from './copyAttribution';
import type { CopyAttributionMarker } from './copyAttribution';
import type { AnalyticsProperties } from './types';
import type {
  ContentDeltaBucket,
  EditorInputMethod,
  EditorReplaceScope,
  AnalyticsEventName,
  MacroTypeValue,
} from './catalog';

export type GlobalReplaceObservation = {
  kind: 'global_replace';
  replace_scope: EditorReplaceScope;
  replaced_coverage_ratio: number;
  editable_chars_before: number;
  inserted_chars: number;
  input_method: EditorInputMethod;
  content_delta_ratio: number;
  content_delta_bucket: ContentDeltaBucket;
};

export type EditorMutationAnalysis =
  | GlobalReplaceObservation
  | { kind: 'local_edit'; input_method: EditorInputMethod }
  | null;

function inputMethod(userEvent: string): EditorInputMethod {
  if (userEvent.includes('paste')) return 'paste';
  if (userEvent === 'undo' || userEvent.startsWith('undo.')) return 'undo';
  if (userEvent === 'redo' || userEvent.startsWith('redo.')) return 'redo';
  if (userEvent.startsWith('delete')) return 'delete';
  if (userEvent.includes('drop')) return 'drop';
  if (userEvent === 'input.type' || userEvent.startsWith('input.type.')) return 'typing';
  return 'unknown';
}

function editableRange(doc: Text, macroType: MacroTypeValue): { from: number; to: number } {
  if (macroType !== 'plantuml' || doc.lines < 2) {
    return { from: 0, to: doc.length };
  }

  const first = doc.line(1);
  const last = doc.line(doc.lines);
  if (!/^\s*@startuml\s*$/.test(first.text) || !/^\s*@enduml\s*$/.test(last.text)) {
    return { from: 0, to: doc.length };
  }

  const from = first.to + 1;
  return { from, to: Math.max(from, last.from - 1) };
}

const CHARACTER_DIFF_LIMIT = 50_000;

export function calculateContentDelta(
  before: string,
  after: string,
): { ratio: number; bucket: ContentDeltaBucket } {
  if (before === after) return { ratio: 0, bucket: 'none' };

  // Character diff is the useful semantic signal for normal diagrams. For
  // unusually large documents, line diff caps browser work and intentionally
  // degrades precision instead of putting editor responsiveness at risk.
  const parts = before.length + after.length > CHARACTER_DIFF_LIMIT
    ? diffLines(before, after)
    : diffChars(before, after);
  const changedChars = parts.reduce(
    (total, part) => total + (part.added || part.removed ? part.value.length : 0),
    0,
  );
  const denominator = before.length + after.length;
  const ratio = Number(Math.min(1, changedChars / Math.max(1, denominator)).toFixed(6));
  const bucket: ContentDeltaBucket = ratio === 0
    ? 'none'
    : ratio <= 0.05
      ? 'tiny'
      : ratio <= 0.2
        ? 'small'
        : ratio <= 0.5
          ? 'medium'
          : 'large';
  return { ratio, bucket };
}

export function analyzeEditorTransaction(
  transaction: Transaction,
  macroType: MacroTypeValue,
): EditorMutationAnalysis {
  if (!transaction.docChanged) return null;

  const userEvent = transaction.annotation(Transaction.userEvent);
  if (!userEvent) return null;

  const editable = editableRange(transaction.startState.doc, macroType);
  const editableCharsBefore = editable.to - editable.from;
  if (editableCharsBefore === 0) return null;

  const changedRanges: Array<{ from: number; to: number }> = [];
  let insertedChars = 0;
  transaction.changes.iterChanges((fromA, toA, fromB, toB) => {
    changedRanges.push({ from: fromA, to: toA });
    insertedChars += toB - fromB;
  });

  changedRanges.sort((a, b) => a.from - b.from);
  let coveredChars = 0;
  let unionFrom = -1;
  let unionTo = -1;
  for (const range of changedRanges) {
    const from = Math.max(editable.from, range.from);
    const to = Math.min(editable.to, range.to);
    if (to <= from) continue;
    if (unionFrom < 0) {
      unionFrom = from;
      unionTo = to;
    } else if (from <= unionTo) {
      unionTo = Math.max(unionTo, to);
    } else {
      coveredChars += unionTo - unionFrom;
      unionFrom = from;
      unionTo = to;
    }
  }
  if (unionFrom >= 0) coveredChars += unionTo - unionFrom;

  const coverage = coveredChars / editableCharsBefore;
  if (coverage < 0.95) {
    return { kind: 'local_edit', input_method: inputMethod(userEvent) };
  }

  const newEditable = editableRange(transaction.newDoc, macroType);
  const contentDelta = calculateContentDelta(
    transaction.startState.doc.sliceString(editable.from, editable.to),
    transaction.newDoc.sliceString(newEditable.from, newEditable.to),
  );

  return {
    kind: 'global_replace',
    replace_scope: coverage === 1 ? 'full' : 'near_full',
    replaced_coverage_ratio: coverage,
    editable_chars_before: editableCharsBefore,
    inserted_chars: insertedChars,
    input_method: inputMethod(userEvent),
    content_delta_ratio: contentDelta.ratio,
    content_delta_bucket: contentDelta.bucket,
  };
}

type EditorMutationSessionConfig = {
  initialCode: string;
  macroType: MacroTypeValue;
  operationMode: 'create' | 'edit';
  customContentId?: string | number | null;
  journeyId: string | null;
  sessionId: string;
  openedAt: number;
};

type EditorMutationSessionDependencies = {
  now: () => number;
  track: (event: AnalyticsEventName, properties: AnalyticsProperties) => void;
  readAttribution: typeof readCopyAttribution;
};

type ActiveEditorMutationSession = EditorMutationSessionConfig & {
  initialEditableCode: string;
  latestCode: string;
  lastReplacementCode: string | null;
  replaceCount: number;
  postReplaceLocalEditCount: number;
  lastAttribution: CopyAttributionMarker | null;
  dependencies: EditorMutationSessionDependencies;
};

let activeSession: ActiveEditorMutationSession | null = null;

function editableText(code: string, macroType: MacroTypeValue): string {
  if (macroType !== 'plantuml') return code;
  const lines = code.split('\n');
  if (
    lines.length >= 2
    && /^\s*@startuml\s*$/.test(lines[0])
    && /^\s*@enduml\s*$/.test(lines[lines.length - 1])
  ) {
    return lines.slice(1, -1).join('\n');
  }
  return code;
}

export function startEditorMutationSession(
  config: EditorMutationSessionConfig,
  dependencies: Partial<EditorMutationSessionDependencies> = {},
): void {
  activeSession = null;
  if (
    config.operationMode !== 'edit'
    || !['sequence', 'mermaid', 'plantuml'].includes(config.macroType)
  ) return;

  activeSession = {
    ...config,
    initialEditableCode: editableText(config.initialCode, config.macroType),
    latestCode: config.initialCode,
    lastReplacementCode: null,
    replaceCount: 0,
    postReplaceLocalEditCount: 0,
    lastAttribution: null,
    dependencies: {
      now: dependencies.now ?? Date.now,
      track: dependencies.track ?? trackAnalyticsEvent,
      readAttribution: dependencies.readAttribution ?? readCopyAttribution,
    },
  };
}

export function recordEditorTransaction(transaction: Transaction): void {
  if (!activeSession || !transaction.docChanged) return;

  activeSession.latestCode = transaction.newDoc.toString();
  const analysis = analyzeEditorTransaction(transaction, activeSession.macroType);
  if (!analysis) return;
  if (analysis.kind === 'local_edit') {
    if (activeSession.replaceCount > 0) activeSession.postReplaceLocalEditCount += 1;
    return;
  }

  activeSession.replaceCount += 1;
  activeSession.lastReplacementCode = editableText(
    transaction.newDoc.toString(),
    activeSession.macroType,
  );
  const now = activeSession.dependencies.now();
  const attribution = activeSession.dependencies.readAttribution(
    activeSession.customContentId,
    now,
  );
  if (attribution) activeSession.lastAttribution = attribution;

  activeSession.dependencies.track('editor_global_replace_observed', {
    feature_area: 'macro',
    surface: 'editor',
    macro_type: activeSession.macroType,
    operation_mode: 'edit',
    journey_id: activeSession.journeyId,
    session_id: activeSession.sessionId,
    replace_index: activeSession.replaceCount,
    ms_since_editor_open: Math.max(0, now - activeSession.openedAt),
    replace_scope: analysis.replace_scope,
    replaced_coverage_ratio: analysis.replaced_coverage_ratio,
    editable_chars_before: analysis.editable_chars_before,
    inserted_chars: analysis.inserted_chars,
    input_method: analysis.input_method,
    content_delta_ratio: analysis.content_delta_ratio,
    content_delta_bucket: analysis.content_delta_bucket,
    ...(attribution ? {
      copy_id: attribution.copy_id,
      copy_source: attribution.copy_source,
      copy_job: attribution.copy_job,
      ms_since_copy: Math.max(0, now - attribution.copied_at),
    } : {}),
  });
}

export function getEditorMutationSummary(): Partial<AnalyticsProperties> {
  if (!activeSession) return {};

  const currentEditable = editableText(activeSession.latestCode, activeSession.macroType);
  const netDelta = calculateContentDelta(activeSession.initialEditableCode, currentEditable);
  const lastReplaceDelta = activeSession.lastReplacementCode == null
    ? null
    : calculateContentDelta(activeSession.lastReplacementCode, currentEditable);
  return {
    journey_id: activeSession.journeyId,
    session_id: activeSession.sessionId,
    had_global_replace: activeSession.replaceCount > 0,
    global_replace_count: activeSession.replaceCount,
    post_replace_local_edit_count: activeSession.postReplaceLocalEditCount,
    net_delta_from_open_bucket: netDelta.bucket,
    ...(lastReplaceDelta ? { delta_from_last_replace_bucket: lastReplaceDelta.bucket } : {}),
    ...(activeSession.lastAttribution ? {
      last_copy_id: activeSession.lastAttribution.copy_id,
      last_copy_source: activeSession.lastAttribution.copy_source,
      last_copy_job: activeSession.lastAttribution.copy_job,
    } : {}),
  };
}

export function trackEditorMutationLifecycleEvent(
  event: 'macro_edit_cancelled' | 'macro_save_failed',
  failureReason?: string,
): boolean {
  if (!activeSession) return false;
  activeSession.dependencies.track(event, {
    feature_area: 'macro',
    surface: 'editor',
    macro_type: activeSession.macroType,
    operation_mode: 'edit',
    ...getEditorMutationSummary(),
    ...(failureReason ? { failure_reason: failureReason.substring(0, 200) } : {}),
  });
  return true;
}

export function resetEditorMutationSession(): void {
  activeSession = null;
}
