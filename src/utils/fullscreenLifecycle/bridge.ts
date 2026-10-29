import type { FullscreenPhase } from './timing';

export const FULLSCREEN_LIFECYCLE_EVENT = 'zenuml_fullscreen_lifecycle';
export type FullscreenSession = { id: string; startedAt: number; entryPoint: 'page_view' | 'export' };
export type FullscreenSignal = { sessionId: string; phase: FullscreenPhase; ready: boolean };

export function fullscreenClosePayload(session: FullscreenSession | undefined, reason: 'return_inline' | 'export_dismissed') {
  return session ? { fullscreenLifecycleClose: { sessionId: session.id, reason } } : {};
}

export function fullscreenCloseReason(payload: unknown, sessionId: string): 'return_inline' | 'export_dismissed' | 'unknown' {
  const close = (payload as { fullscreenLifecycleClose?: { sessionId?: unknown; reason?: unknown } } | null)?.fullscreenLifecycleClose;
  return close?.sessionId === sessionId && (close.reason === 'return_inline' || close.reason === 'export_dismissed') ? close.reason : 'unknown';
}

/** Read only the context passed to this modal; older opens can lack it. */
export function fullscreenSessionFromContext(context: unknown): FullscreenSession | undefined {
  const modal = (context as { extension?: { modal?: { fullscreenLifecycle?: unknown } } } | undefined)?.extension?.modal;
  const session = modal?.fullscreenLifecycle as Partial<FullscreenSession> | undefined;
  if (!session || typeof session.id !== 'string' || !session.id || typeof session.startedAt !== 'number' || !Number.isFinite(session.startedAt) || (session.entryPoint !== 'page_view' && session.entryPoint !== 'export')) return undefined;
  return { id: session.id, startedAt: session.startedAt, entryPoint: session.entryPoint };
}

export function fullscreenSessionProperties(session?: FullscreenSession) {
  return session ? { fullscreen_session_id: session.id, fullscreen_started_at_ms: session.startedAt, entry_point: session.entryPoint } : {};
}

export function isFullscreenSignal(value: unknown, sessionId: string): value is FullscreenSignal {
  const s = value as Partial<FullscreenSignal> | null;
  return !!s && s.sessionId === sessionId && typeof s.ready === 'boolean' &&
    ['request', 'expired', 'diagram', 'loading', 'unknown'].includes(String(s.phase));
}

/** Bridge events are best effort: telemetry must not prevent rendering. */
export async function publishFullscreenSignal(session: FullscreenSession | undefined, phase: FullscreenPhase, ready = false): Promise<void> {
  if (!session) return;
  try {
    const { events } = await import('@forge/bridge');
    await events.emit(FULLSCREEN_LIFECYCLE_EVENT, { sessionId: session.id, phase, ready });
  } catch (error) {
    console.warn('[fullscreen lifecycle] bridge event unavailable', error);
  }
}
