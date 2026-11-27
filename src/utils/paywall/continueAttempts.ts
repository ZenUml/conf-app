import { markerKey, readJsonMarker, writeJsonMarker } from '@/utils/storage/marker'

// Lowered from 15 to 3 on 2026-08-16. Existing users keep whatever balance is
// already in localStorage — getOrCreateContinueAttempts only applies this default
// when no valid record exists, so the change reaches new user/space pairs only.
export const DEFAULT_CONTINUE_ATTEMPTS = 3
export const CONTINUE_ATTEMPTS_STORAGE_SOURCE = 'local_storage'

export interface ContinueAttemptsIdentity {
  clientDomain: string
  spaceKey: string
  userAccountId: string
}

export interface ContinueAttemptsState {
  remainingAttempts: number
  firstTriggeredAt: string
  lastUsedAt: string | null
  exhaustedAt: string | null
}

export function continueAttemptsKey(identity: ContinueAttemptsIdentity): string {
  return markerKey('paywallContinueAttempts', identity.clientDomain, identity.spaceKey, identity.userAccountId)
}

function initialState(now: Date): ContinueAttemptsState {
  return {
    remainingAttempts: DEFAULT_CONTINUE_ATTEMPTS,
    firstTriggeredAt: now.toISOString(),
    lastUsedAt: null,
    exhaustedAt: null,
  }
}

function parseState(raw: unknown): ContinueAttemptsState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const parsed = raw as Partial<ContinueAttemptsState>
  if (
    typeof parsed.remainingAttempts !== 'number' ||
    !Number.isFinite(parsed.remainingAttempts) ||
    parsed.remainingAttempts < 0 ||
    typeof parsed.firstTriggeredAt !== 'string'
  ) {
    return null
  }
  return {
    remainingAttempts: Math.floor(parsed.remainingAttempts),
    firstTriggeredAt: parsed.firstTriggeredAt,
    lastUsedAt: typeof parsed.lastUsedAt === 'string' ? parsed.lastUsedAt : null,
    exhaustedAt: typeof parsed.exhaustedAt === 'string' ? parsed.exhaustedAt : null,
  }
}

export function getOrCreateContinueAttempts(
  identity: ContinueAttemptsIdentity,
  now = new Date()
): ContinueAttemptsState {
  const key = continueAttemptsKey(identity)
  const existing = readJsonMarker(key, parseState)
  if (existing) return existing

  const created = initialState(now)
  writeJsonMarker(key, created)
  return created
}

export function useContinueAttempt(
  identity: ContinueAttemptsIdentity,
  now = new Date()
): ContinueAttemptsState {
  const key = continueAttemptsKey(identity)
  const current = getOrCreateContinueAttempts(identity, now)
  const remainingAttempts = Math.max(0, current.remainingAttempts - 1)
  const next: ContinueAttemptsState = {
    ...current,
    remainingAttempts,
    lastUsedAt: now.toISOString(),
    exhaustedAt: remainingAttempts === 0 ? (current.exhaustedAt || now.toISOString()) : null,
  }
  // best-effort write; return next so the in-memory state reflects the decrement
  writeJsonMarker(key, next)
  return next
}
