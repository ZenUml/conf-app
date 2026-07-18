import type { MixpanelServiceEvent } from './mixpanelService';
import {
  COUNT_FIELDS,
  type MacroCounts,
  type SpaceMetrics,
} from '../metrics-cache/snapshot/common';

interface AnalyticsRunContext {
  runId: string;
  capturedAt: string;
  installationId: string;
  productType: string;
  environmentType: string;
}

export interface SnapshotCompletedInput extends AnalyticsRunContext {
  durationMs: number;
  spaceCount: number;
  contentCount: number;
  changedSpaceCount: number;
  zeroedSpaceCount: number;
  counts: MacroCounts;
  typeRequestCount: number;
  chunkCount: number;
}

export interface SnapshotSpaceChangedInput extends AnalyticsRunContext {
  spaceKey: string;
  reason: 'new' | 'changed' | 'zeroed';
  previous?: SpaceMetrics;
  current: SpaceMetrics;
}

export interface SnapshotFailedInput extends AnalyticsRunContext {
  durationMs: number;
  failureStage: string;
  failureReason: string;
  completedTypes: string[];
  processedContents: number;
  processedSpaces: number;
  chunkCount: number;
}

function eventTime(capturedAt: string): number {
  const millis = Date.parse(capturedAt);
  if (!Number.isFinite(millis)) throw new Error('Invalid snapshot capturedAt');
  return Math.floor(millis / 1000);
}

function baseEvent(
  context: AnalyticsRunContext,
  event: MixpanelServiceEvent['event'],
  insertSuffix: string,
  properties: MixpanelServiceEvent['properties'],
): MixpanelServiceEvent {
  return {
    event,
    distinctId: context.installationId,
    insertId: `${context.runId}:${insertSuffix}`,
    time: eventTime(context.capturedAt),
    properties: {
      feature_area: 'macro_count',
      surface: 'scheduled_job',
      run_id: context.runId,
      product_type: context.productType,
      environment_type: context.environmentType,
      ...properties,
    },
  };
}

export function completedSnapshotEvent(input: SnapshotCompletedInput): MixpanelServiceEvent {
  return baseEvent(input, 'macro_count_snapshot_completed', 'completed', {
    captured_at: input.capturedAt,
    duration_ms: input.durationMs,
    space_count: input.spaceCount,
    content_count: input.contentCount,
    changed_space_count: input.changedSpaceCount,
    zeroed_space_count: input.zeroedSpaceCount,
    sequence_count: input.counts.sequence,
    graph_count: input.counts.graph,
    openapi_count: input.counts.openapi,
    mermaid_count: input.counts.mermaid,
    plantuml_count: input.counts.plantuml,
    unknown_count: input.counts.unknown,
    type_request_count: input.typeRequestCount,
    chunk_count: input.chunkCount,
  });
}
export function changedSpaceEvent(input: SnapshotSpaceChangedInput): MixpanelServiceEvent {
  const counts: Record<string, number> = {
    previous_total: input.previous?.total ?? 0,
    current_total: input.current.total,
    delta_total: input.current.total - (input.previous?.total ?? 0),
  };
  for (const field of COUNT_FIELDS) {
    counts[`previous_${field}_count`] = input.previous?.[field] ?? 0;
    counts[`current_${field}_count`] = input.current[field];
  }
  return baseEvent(input, 'macro_count_space_changed', `space:${input.spaceKey}`, {
    space_key: input.spaceKey,
    change_reason: input.reason,
    ...counts,
  });
}

export function failedSnapshotEvent(input: SnapshotFailedInput): MixpanelServiceEvent {
  return baseEvent(input, 'macro_count_snapshot_failed', 'failed', {
    duration_ms: input.durationMs,
    failure_stage: input.failureStage,
    failure_reason: input.failureReason,
    completed_type_count: input.completedTypes.length,
    last_completed_type: input.completedTypes.at(-1),
    processed_contents: input.processedContents,
    processed_spaces: input.processedSpaces,
    chunk_count: input.chunkCount,
  });
}
