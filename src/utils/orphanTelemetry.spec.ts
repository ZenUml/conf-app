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

  // #148: the direct by-id fetch detail rides on the event so a failed fetch
  // can be told apart (403 vs 5xx vs thrown vs malformed). #1014: a fetch
  // that failed WITHOUT proving the content absent is not an orphan, so it
  // goes out as customcontent_fetch_unavailable, not customcontent_orphan_observed.
  describe('direct-fetch detail (#148)', () => {
    function lastProps() {
      return vi.mocked(trackEvent).mock.calls[0][3] as Record<string, unknown>;
    }

    it('reports a structured 403 as other_error / 403 / FORBIDDEN / structured', () => {
      reportOrphanObserved('page1', 'orphan1', 'sequence', undefined, {
        recoveryUsed: false,
        directFetch: {
          directFetchStatus: 'other_error',
          directFetchHttpStatus: 403,
          directFetchErrorCode: 'FORBIDDEN',
          directFetchErrorClass: 'structured',
        },
      });

      expect(vi.mocked(trackEvent).mock.calls[0][1]).toBe('customcontent_fetch_unavailable');
      expect(lastProps()).toMatchObject({
        direct_fetch_status: 'other_error',
        direct_fetch_http_status: 403,
        direct_fetch_error_code: 'FORBIDDEN',
        direct_fetch_error_class: 'structured',
      });
    });

    it('reports a thrown fetch with class thrown and no http status / code', () => {
      reportOrphanObserved('page1', 'orphan1', 'sequence', undefined, {
        directFetch: { directFetchStatus: 'other_error', directFetchErrorClass: 'thrown' },
      });

      expect(lastProps()).toMatchObject({ direct_fetch_status: 'other_error', direct_fetch_error_class: 'thrown' });
      expect(lastProps()).not.toHaveProperty('direct_fetch_http_status');
      expect(lastProps()).not.toHaveProperty('direct_fetch_error_code');
    });

    it('reports a malformed body with class malformed', () => {
      reportOrphanObserved('page1', 'orphan1', 'graph', undefined, {
        directFetch: { directFetchStatus: 'other_error', directFetchErrorClass: 'malformed' },
      });

      expect(lastProps()).toMatchObject({ direct_fetch_error_class: 'malformed' });
    });

    it('keeps the probe fields unchanged next to a strict-404 direct fetch', () => {
      const probe = fakeProbe({ recoverable: true, candidateCount: 1, pageChildrenTotal: 3 });

      reportOrphanObserved('page1', 'orphan1', 'sequence', probe, {
        recoveryUsed: false,
        directFetch: {
          directFetchStatus: 'not_found',
          directFetchHttpStatus: 404,
          directFetchErrorCode: 'NOT_FOUND',
          directFetchErrorClass: 'structured',
        },
      });

      expect(lastProps()).toMatchObject({
        recoverable: 'true',
        candidate_count: 1,
        page_children_total: 3,
        recovery_used: false,
        direct_fetch_status: 'not_found',
        direct_fetch_http_status: 404,
        direct_fetch_error_code: 'NOT_FOUND',
        direct_fetch_error_class: 'structured',
      });
    });

    it('adds no direct_fetch_* keys when no detail is supplied', () => {
      reportOrphanObserved('page1', 'orphan1', 'sequence', undefined);

      expect(Object.keys(lastProps()).filter((k) => k.startsWith('direct_fetch_'))).toEqual([]);
    });
  });

});

describe('reportOrphanObserved — transient fetch failure is not an orphan (#1014)', () => {
  beforeEach(() => vi.clearAllMocks());

  const rateLimited = {
    directFetchStatus: 'other_error' as const,
    directFetchHttpStatus: 429,
    directFetchErrorClass: 'thrown' as const,
  };

  it('emits customcontent_fetch_unavailable, not customcontent_orphan_observed, on a 429', () => {
    reportOrphanObserved('page1', 'cc1', 'sequence', undefined, {
      recoveryUsed: false,
      directFetch: rateLimited,
    });

    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).not.toHaveBeenCalledWith(
      expect.anything(), 'customcontent_orphan_observed', expect.anything(), expect.anything(),
    );
    expect(trackEvent).toHaveBeenCalledWith(
      'cc1',
      'customcontent_fetch_unavailable',
      'warning',
      {
        diagram_kind: 'sequence',
        page_id: 'page1',
        direct_fetch_status: 'other_error',
        direct_fetch_http_status: 429,
        direct_fetch_error_class: 'thrown',
      },
    );
  });

  it('emits customcontent_fetch_unavailable without page_id when the 429 happened with no page id', () => {
    reportOrphanObserved(undefined, 'cc1', 'graph', undefined, { directFetch: rateLimited });

    expect(vi.mocked(trackEvent).mock.calls[0][1]).toBe('customcontent_fetch_unavailable');
    expect(vi.mocked(trackEvent).mock.calls[0][3]).not.toHaveProperty('page_id');
  });

  it('still reports a confirmed 404 with no page id as an orphan (probe_skipped_no_page_id)', () => {
    reportOrphanObserved(undefined, 'cc1', 'openapi', undefined, {
      directFetch: { directFetchStatus: 'not_found', directFetchHttpStatus: 404 },
    });

    expect(trackEvent).toHaveBeenCalledWith(
      'cc1',
      'customcontent_orphan_observed',
      'warning',
      expect.objectContaining({ recoverable: 'probe_skipped_no_page_id', direct_fetch_status: 'not_found' }),
    );
  });

  it('still reports a recovered orphan as an orphan', () => {
    reportOrphanObserved('page1', 'cc1', 'sequence', fakeProbe({ recoverable: true, candidateCount: 1 }), {
      recoveryUsed: true,
      recoveredId: 'cc2',
      directFetch: { directFetchStatus: 'not_found', directFetchHttpStatus: 404 },
    });

    expect(vi.mocked(trackEvent).mock.calls[0][1]).toBe('customcontent_orphan_observed');
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
