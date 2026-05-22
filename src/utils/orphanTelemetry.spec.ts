import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reportOrphanObserved } from './orphanTelemetry';
import { trackEvent } from '@/utils/window';

vi.mock('@/utils/window', () => ({
  trackEvent: vi.fn(),
}));

function fakeApWrapper(overrides: Partial<{ recoverable: boolean | 'probe_failed'; candidateCount: number; pageChildrenTotal: number; truncated: boolean; probeError: string }> = {}) {
  const probeOrphanRecovery = vi.fn().mockResolvedValue({
    recoverable: overrides.recoverable ?? false,
    candidateCount: overrides.candidateCount ?? 0,
    pageChildrenTotal: overrides.pageChildrenTotal ?? 0,
    ...(overrides.truncated && { truncated: true }),
    ...(overrides.probeError && { probeError: overrides.probeError }),
  });
  return { probeOrphanRecovery } as any;
}

describe('reportOrphanObserved', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fires customcontent_orphan_observed with the probe result', async () => {
    const apWrapper = fakeApWrapper({ recoverable: true, candidateCount: 1, pageChildrenTotal: 3 });

    await reportOrphanObserved(apWrapper, '5553291265', '3916300417', 'graph');

    expect(apWrapper.probeOrphanRecovery).toHaveBeenCalledWith('5553291265', '3916300417');
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
      }),
    );
  });

  it('records probe failure details when the probe could not run', async () => {
    const apWrapper = fakeApWrapper({ recoverable: 'probe_failed', probeError: 'network down' });

    await reportOrphanObserved(apWrapper, '5553291265', '3916300417', 'sequence');

    expect(trackEvent).toHaveBeenCalledWith(
      '3916300417',
      'customcontent_orphan_observed',
      'warning',
      expect.objectContaining({
        recoverable: 'probe_failed',
        probe_error: 'network down',
      }),
    );
  });

  it('skips the probe and reports probe_skipped_no_page_id when pageId is missing', async () => {
    const apWrapper = fakeApWrapper();

    await reportOrphanObserved(apWrapper, undefined, '3916300417', 'openapi');

    expect(apWrapper.probeOrphanRecovery).not.toHaveBeenCalled();
    expect(trackEvent).toHaveBeenCalledWith(
      '3916300417',
      'customcontent_orphan_observed',
      'warning',
      expect.objectContaining({
        diagram_kind: 'openapi',
        recoverable: 'probe_skipped_no_page_id',
      }),
    );
  });

  it('never throws even if probeOrphanRecovery rejects', async () => {
    const apWrapper = {
      probeOrphanRecovery: vi.fn().mockRejectedValue(new Error('boom')),
    } as any;

    await expect(reportOrphanObserved(apWrapper, '1', '2', 'embed')).resolves.toBeUndefined();
  });
});
