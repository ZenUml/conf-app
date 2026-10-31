import { callRemote } from '@/utils/requestUtil'
import { FULLSCREEN_RECOVERY_POLICY_VERSION } from '../../shared/fullscreenRecovery'
import type {
  RecoveryActivateInput,
  RecoveryRequestInput,
  RecoveryResult,
  RecoverySnapshot,
} from '../../shared/fullscreenRecovery'

const endpoint = '/api/fullscreen-recovery'
const states = new Set(['disabled', 'not_requested', 'pending_activation', 'active', 'expired', 'unavailable'])

function requireResult(value: unknown): RecoveryResult {
  if (!value || typeof value !== 'object' || !('snapshot' in value)) throw new Error('Invalid Fullscreen recovery response')
  const result = value as RecoveryResult
  if (!result.snapshot || !states.has(result.snapshot.state) ||
      result.snapshot.policyVersion !== FULLSCREEN_RECOVERY_POLICY_VERSION ||
      !Number.isFinite(Date.parse(result.snapshot.serverNow))) {
    throw new Error('Invalid Fullscreen recovery snapshot')
  }
  return result
}

function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => { timeout = setTimeout(() => reject(new Error('Fullscreen recovery request timed out')), milliseconds) }),
  ]).finally(() => clearTimeout(timeout))
}

/** Forge remote requests carry the FIT used by the server to identify this viewer. */
export async function getFullscreenRecovery(spaceKey?: string): Promise<RecoverySnapshot> {
  return requireResult(await bounded(callRemote(spaceKey ? `${endpoint}?spaceKey=${encodeURIComponent(spaceKey)}` : endpoint, 'GET'), 8000)).snapshot
}

export async function requestFullscreenRecovery(input: RecoveryRequestInput): Promise<RecoveryResult> {
  return requireResult(await bounded(callRemote(endpoint, 'POST', input), 15000))
}

export async function activateFullscreenRecovery(input: RecoveryActivateInput): Promise<RecoveryResult> {
  return requireResult(await bounded(callRemote(endpoint, 'POST', input), 15000))
}
