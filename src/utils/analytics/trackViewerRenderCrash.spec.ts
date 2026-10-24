import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trackViewerRenderCrash } from './trackViewerRenderCrash';
import { trackAnalyticsEvent } from './trackAnalyticsEvent';

vi.mock('./trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));

describe('trackViewerRenderCrash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fires viewer_load_failed with failure_stage render_crash when in display mode', () => {
    trackViewerRenderCrash('mermaid', true, new Error('boom'));

    expect(trackAnalyticsEvent).toHaveBeenCalledWith('viewer_load_failed', {
      feature_area: 'macro',
      surface: 'viewer',
      macro_type: 'mermaid',
      failure_reason: 'boom',
      failure_stage: 'render_crash',
    });
  });

  it('extracts the message from an Error instance', () => {
    trackViewerRenderCrash('sequence', true, new TypeError('cannot read x of undefined'));

    const [, props] = vi.mocked(trackAnalyticsEvent).mock.calls[0];
    expect(props.failure_reason).toBe('cannot read x of undefined');
  });

  it('passes a string error straight through as failure_reason', () => {
    trackViewerRenderCrash('graph', true, 'plain string failure');

    const [, props] = vi.mocked(trackAnalyticsEvent).mock.calls[0];
    expect(props.failure_reason).toBe('plain string failure');
  });

  it('stringifies a non-Error, non-string thrown value', () => {
    trackViewerRenderCrash('openapi', true, { weird: 'object' });

    const [, props] = vi.mocked(trackAnalyticsEvent).mock.calls[0];
    expect(props.failure_reason).toBe('[object Object]');
  });

  it('does not fire when not in display mode (editor-preview crash)', () => {
    trackViewerRenderCrash('mermaid', false, new Error('editor preview crash'));

    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
  });
});
