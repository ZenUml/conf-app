import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reportOrphanObserved, reportOrphanMacroRepaired, type ProbeResult } from './orphanTelemetry';
import { trackEvent } from '@/utils/window';

vi.mock('@/utils/window', () => ({
  trackEvent: vi.fn(),
}));

function probeOk(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    recoverable: false,
    candidateCount: 0,
    pageChildrenTotal: 0,
    ...overrides,
  } as ProbeResult;
}

describe('reportOrphanObserved', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fires customcontent_orphan_observed with the supplied probe result and recovery_used=false by default', () => {
    reportOrphanObserved(
      '5553291265',
      '3916300417',
      'graph',
      probeOk({ recoverable: true, candidateCount: 1, pageChildrenTotal: 1, candidateIds: ['5553291585'] }),
    );

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
        page_children_total: 1,
        recovery_used: false,
      }),
    );
  });

  it('reports recovery_used=true with the recovered_id when the caller applied recovery', () => {
    reportOrphanObserved(
      '5553291265',
      '3916300417',
      'graph',
      probeOk({ recoverable: true, candidateCount: 1, pageChildrenTotal: 1, candidateIds: ['5553291585'] }),
      { recoveryUsed: true, recoveredId: '5553291585' },
    );

    expect(trackEvent).toHaveBeenCalledWith(
      '3916300417',
      'customcontent_orphan_observed',
      'warning',
      expect.objectContaining({
        recovery_used: true,
        recovered_id: '5553291585',
      }),
    );
  });

  it('records probe failure details when the probe could not run', () => {
    reportOrphanObserved(
      '5553291265',
      '3916300417',
      'sequence',
      probeOk({ recoverable: 'probe_failed', probeError: 'network down' }),
    );

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

  it('reports probe_skipped_no_page_id when pageId is missing', () => {
    reportOrphanObserved(undefined, '3916300417', 'openapi', probeOk());

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
  });

  it('reports probe_skipped_no_page_id when probeResult is missing', () => {
    reportOrphanObserved('5553291265', '3916300417', 'embed', undefined);

    expect(trackEvent).toHaveBeenCalledWith(
      '3916300417',
      'customcontent_orphan_observed',
      'warning',
      expect.objectContaining({
        recoverable: 'probe_skipped_no_page_id',
        recovery_used: false,
      }),
    );
  });

  it('never throws even if trackEvent throws under it', () => {
    vi.mocked(trackEvent).mockImplementationOnce(() => { throw new Error('boom'); });
    expect(() => reportOrphanObserved('p', 'o', 'graph', probeOk())).not.toThrow();
  });
});

describe('reportOrphanMacroRepaired', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fires customcontent_orphan_macro_repaired with old/new ids and diagram_kind', () => {
    reportOrphanMacroRepaired('5553291265', '3916300417', '5553291585', 'graph');

    expect(trackEvent).toHaveBeenCalledWith(
      '3916300417',
      'customcontent_orphan_macro_repaired',
      'info',
      expect.objectContaining({
        diagram_kind: 'graph',
        page_id: '5553291265',
        old_custom_content_id: '3916300417',
        new_custom_content_id: '5553291585',
      }),
    );
  });

  it('omits page_id when it is undefined', () => {
    reportOrphanMacroRepaired(undefined, '3916300417', '5553291585', 'sequence');

    expect(trackEvent).toHaveBeenCalledWith(
      '3916300417',
      'customcontent_orphan_macro_repaired',
      'info',
      expect.not.objectContaining({ page_id: expect.anything() }),
    );
  });

  it('never throws even if trackEvent throws under it', () => {
    vi.mocked(trackEvent).mockImplementationOnce(() => { throw new Error('boom'); });
    expect(() => reportOrphanMacroRepaired('p', 'o', 'n', 'graph')).not.toThrow();
  });
});
