import { describe, expect, it } from 'vitest';
import { fullscreenClosePayload, fullscreenCloseReason, fullscreenSessionFromContext, fullscreenSessionProperties, isFullscreenSignal } from './bridge';

describe('fullscreen session bridge', () => {
  const session = { id: 'session-1', startedAt: 123, entryPoint: 'export' as const };
  it('reads session context without inventing missing values', () => {
    expect(fullscreenSessionFromContext({ extension: { modal: { fullscreenLifecycle: session } } })).toEqual(session);
    expect(fullscreenSessionFromContext({ extension: { modal: {} } })).toBeUndefined();
    expect(fullscreenSessionProperties(session)).toEqual({ fullscreen_session_id: 'session-1', fullscreen_started_at_ms: 123, entry_point: 'export' });
  });
  it('rejects events from a different session and unknown phases', () => {
    expect(isFullscreenSignal({ sessionId: 'session-1', phase: 'diagram', ready: true }, 'session-1')).toBe(true);
    expect(isFullscreenSignal({ sessionId: 'session-2', phase: 'diagram', ready: true }, 'session-1')).toBe(false);
    expect(isFullscreenSignal({ sessionId: 'session-1', phase: 'invalid', ready: true }, 'session-1')).toBe(false);
  });
  it('accepts explicit close reasons only for the matching session', () => {
    const payload = fullscreenClosePayload(session, 'export_dismissed');
    expect(fullscreenCloseReason(payload, session.id)).toBe('export_dismissed');
    expect(fullscreenCloseReason(payload, 'another-session')).toBe('unknown');
    expect(fullscreenCloseReason(undefined, session.id)).toBe('unknown');
  });
});
