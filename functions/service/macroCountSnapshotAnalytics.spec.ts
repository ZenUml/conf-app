import { describe, expect, it } from 'vitest';
import {
  changedSpaceEvent,
  completedSnapshotEvent,
  failedSnapshotEvent,
} from './macroCountSnapshotAnalytics';

const run = {
  runId: 'run-1',
  capturedAt: '2026-07-18T00:00:00.000Z',
  installationId: 'installation-1',
  productType: 'lite',
  environmentType: 'STAGING',
};
const counts = {
  total: 3,
  sequence: 1,
  graph: 1,
  openapi: 1,
  mermaid: 0,
  plantuml: 0,
  unknown: 0,
};

describe('macro count snapshot analytics builders', () => {
  it('builds deterministic completed and changed insert IDs', () => {
    const completed = completedSnapshotEvent({
      ...run,
      durationMs: 100,
      spaceCount: 1,
      contentCount: 3,
      changedSpaceCount: 1,
      zeroedSpaceCount: 0,
      counts,
      typeRequestCount: 2,
      chunkCount: 3,
    });
    const changed = changedSpaceEvent({
      ...run,
      spaceKey: 'ENG',
      reason: 'new',
      current: { space: 'ENG', ...counts, isLite: true, lastUpdated: run.capturedAt },
    });

    expect(completed.insertId).toBe('run-1:completed');
    expect(changed.insertId).toBe('run-1:space:ENG');
    expect(changed.properties).toMatchObject({ previous_total: 0, current_total: 3, delta_total: 3 });
  });

  it('keeps failed analytics scalar and privacy-safe', () => {
    const event = failedSnapshotEvent({
      ...run,
      durationMs: 50,
      failureStage: 'scan',
      failureReason: 'confluence_5xx',
      completedTypes: ['type-1'],
      processedContents: 20,
      processedSpaces: 2,
      chunkCount: 1,
    });

    expect(event.insertId).toBe('run-1:failed');
    expect(JSON.stringify(event)).not.toMatch(/contentId|pageId|logicalIdHash|title|raw/i);
    expect(Object.values(event.properties).every((value) => (
      value == null || ['string', 'number', 'boolean'].includes(typeof value)
    ))).toBe(true);
  });
});
