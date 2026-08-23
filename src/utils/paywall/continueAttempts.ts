// 3, down from 15 (paywall-rhythm W1, 2026-08-10 -> 2026-08-16). Default-on
// telemetry showed 15 is not a decision point: an active editor burned 7
// continues in 30 minutes dismissing the modal like a cookie banner, while
// monthly-cadence editors would take a year to exhaust it. Three attempts
// keep the escape hatch and make the last one carry a real choice (see
// UpgradePrompt's commitment beat). Existing users keep whatever balance is
// already in localStorage — getOrCreateContinueAttempts only applies this
// default when no valid record exists, so the change reaches new user/space
// pairs only.
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

function normalizeKeyPart(value: string): string {
  return encodeURIComponent(value || 'unknown')
}

export function continueAttemptsKey(identity: ContinueAttemptsIdentity): string {
  return [
    'paywallContinueAttempts',
    normalizeKeyPart(identity.clientDomain),
    normalizeKeyPart(identity.spaceKey),
    normalizeKeyPart(identity.userAccountId),
  ].join(':')
}

function initialState(now: Date): ContinueAttemptsState {
  return {
    remainingAttempts: DEFAULT_CONTINUE_ATTEMPTS,
    firstTriggeredAt: now.toISOString(),
    lastUsedAt: null,
    exhaustedAt: null,
  }
}

function parseState(raw: string | null): ContinueAttemptsState | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ContinueAttemptsState>
    if (
      typeof parsed.remainingAttempts !== 'number' ||
      !Number.isFinite(parsed.remainingAttempts) ||
      parsed.remainingAttempts < 0 ||
      typeof parsed.firstTriggeredAt !== 'string'
    ) {
      return null
    }
    return {
      // Clamp pre-existing states written under the old 15-attempt regime down
      // to the current allowance. Never grants more than the user already had;
      // a state that was exhausted stays exhausted.
      remainingAttempts: Math.min(Math.floor(parsed.remainingAttempts), DEFAULT_CONTINUE_ATTEMPTS),
      firstTriggeredAt: parsed.firstTriggeredAt,
      lastUsedAt: typeof parsed.lastUsedAt === 'string' ? parsed.lastUsedAt : null,
      exhaustedAt: typeof parsed.exhaustedAt === 'string' ? parsed.exhaustedAt : null,
    }
  } catch {
    return null
  }
}

function writeState(key: string, state: ContinueAttemptsState): void {
  localStorage.setItem(key, JSON.stringify(state))
}

export function getOrCreateContinueAttempts(
  identity: ContinueAttemptsIdentity,
  now = new Date()
): ContinueAttemptsState {
  const key = continueAttemptsKey(identity)
  try {
    const existing = parseState(localStorage.getItem(key))
    if (existing) return existing

    const created = initialState(now)
    writeState(key, created)
    return created
  } catch {
    return initialState(now)
  }
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
  try {
    writeState(key, next)
  } catch {
    // best-effort write; return next so the in-memory state reflects the decrement
  }
  return next
}
