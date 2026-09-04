import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reportOrphanObserved, reportOrphanMacroRepaired, type ProbeResult } from './orphanTelemetry';
import { trackEvent } from '@/utils/window';

vi.mock('@/utils/window', () => ({
  trackEvent: vi.fn(),
}));

function fakeProbe(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    recoverable: overrides.recoverable ?? false,
    candidateCount: overrides.candidateCount ?? 0,
    pageChildrenTotal: overrides.pageChildrenTotal ?? 0,
    ...(overrides.candidateIds && { candidateIds: overrides.candidateIds }),
    ...(overrides.truncated && { truncated: true }),
    ...(overrides.probeError && { probeError: overrides.probeError }),
  };
}

describe('reportOrphanObserved', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fires customcontent_orphan_observed with probe result and recovery_used=false by default', () => {
    const probe = fakeProbe({ recoverable: true, candidateCount: 1, pageChildrenTotal: 3 });

    reportOrphanObserved('5553291265', '3916300417', 'graph', probe);

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith(
      '3916300417',
      'customcontent_orphan_observed',
      'warning',
      expect.objectContaining({
        diagram_kind: 'graph',
        page_id: '5553291265',
        recoverable: 'true',
        candidate_count: 1,
        page_children_total: 3,
        recovery_used: false,
      }),
    );
  });

  it('sets recovery_used=true and recovered_id when recovery was applied', () => {
    const probe = fakeProbe({ recoverable: true, candidateCount: 1, candidateIds: ['abc'] });

    reportOrphanObserved('page1', 'orphan1', 'sequence', probe, {
      recoveryUsed: true,
      recoveredId: 'abc',
    });

    expect(trackEvent).toHaveBeenCalledWith(
      'orphan1',
      'customcontent_orphan_observed',
      'warning',
      expect.objectContaining({
        recovery_used: true,
        recovered_id: 'abc',
      }),
    );
  });

  it('records probe failure details when the probe could not run', () => {
    const probe = fakeProbe({ recoverable: 'probe_failed', probeError: 'network down' });

    reportOrphanObserved('5553291265', '3916300417', 'sequence', probe);

    expect(trackEvent).toHaveBeenCalledWith(
      '3916300417',
      'customcontent_orphan_observed',
      'warning',
      expect.objectContaining({
        recoverable: 'probe_failed',
        probe_error: 'network down',
        recovery_used: false,
      }),
    );
  });

  it('reports probe_skipped_no_page_id and omits page_id when pageId is missing', () => {
    const probe = fakeProbe();

    reportOrphanObserved(undefined, '3916300417', 'openapi', probe);

    expect(trackEvent).toHaveBeenCalledWith(
      '3916300417',
      'customcontent_orphan_observed',
      'warning',
      expect.objectContaining({
        diagram_kind: 'openapi',
        recoverable: 'probe_skipped_no_page_id',
        recovery_used: false,
      }),
    );
    const call = vi.mocked(trackEvent).mock.calls[0];
    expect(call[3]).not.toHaveProperty('page_id');
  });

  it('reports probe_skipped_no_probe_result and keeps page_id when probeResult is undefined', () => {
    reportOrphanObserved('page1', 'orphan1', 'embed', undefined);

    expect(trackEvent).toHaveBeenCalledWith(
      'orphan1',
      'customcontent_orphan_observed',
      'warning',
      expect.objectContaining({
        recoverable: 'probe_skipped_no_probe_result',
        page_id: 'page1',
        recovery_used: false,
      }),
    );
  });

});

describe('reportOrphanMacroRepaired', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fires customcontent_orphan_macro_repaired with old/new ids', () => {
    reportOrphanMacroRepaired('page1', 'old-id', 'new-id', 'graph');

    expect(trackEvent).toHaveBeenCalledWith(
      'old-id',
      'customcontent_orphan_macro_repaired',
      'info',
      expect.objectContaining({
        diagram_kind: 'graph',
        page_id: 'page1',
        old_custom_content_id: 'old-id',
        new_custom_content_id: 'new-id',
      }),
    );
  });

  it('omits page_id when pageId is undefined', () => {
    reportOrphanMacroRepaired(undefined, 'old-id', 'new-id', 'sequence');

    const call = vi.mocked(trackEvent).mock.calls[0];
    expect(call[3]).not.toHaveProperty('page_id');
  });

});
