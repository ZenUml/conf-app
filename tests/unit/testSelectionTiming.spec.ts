import { describe, expect, it } from 'vitest';
import { attachWorkflowTiming } from '../../scripts/test-selection/timing.mjs';

const job = (name: string, created_at: string, started_at: string, completed_at: string) => ({ name, created_at, started_at, completed_at });
describe('E2E workflow timings', () => {
  it('reports queue separately from the E2E critical path', () => {
    const evidence = { metrics: { planned_test_count: 2 } };
    const result = attachWorkflowTiming(evidence, [
      job('E2E: Lite / shard 1/2', '2026-01-01T00:00:00Z', '2026-01-01T00:00:10Z', '2026-01-01T00:01:10Z'),
      job('E2E: Lite / shard 2/2', '2026-01-01T00:00:05Z', '2026-01-01T00:00:25Z', '2026-01-01T00:00:55Z'),
      job('E2E: Lite render / shard 1/1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:30Z'),
    ], 'E2E: Lite');
    expect(result.metrics).toMatchObject({ queue_critical_path_ms: 20_000, queue_total_ms: 30_000, e2e_critical_path_ms: 60_000, workflow_timing_source: 'github-actions-jobs-api' });
  });

  it('does not invent queue data when a shard timestamp is absent', () => {
    const result = attachWorkflowTiming({ metrics: {} }, [{ name: 'E2E: Lite / shard 1/1', created_at: '2026-01-01T00:00:00Z', started_at: null, completed_at: null }], 'E2E: Lite');
    expect(result.metrics).toMatchObject({ queue_critical_path_ms: null, e2e_critical_path_ms: null });
  });
});
