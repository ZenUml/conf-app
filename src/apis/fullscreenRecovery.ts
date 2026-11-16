import { callRemote } from '@/utils/requestUtil'
import { RECOVERY_FEATURE_DEFINITIONS } from '../../shared/fullscreenRecovery'
import type {
  RecoveryFeature,
  RecoveryActivateInput,
  RecoveryRequestInput,
  RecoveryResult,
  RecoverySnapshot,
} from '../../shared/fullscreenRecovery'

const endpoint = '/api/fullscreen-recovery'
const states = new Set(['disabled', 'not_requested', 'pending_activation', 'active', 'expired', 'unavailable'])

function requireResult(value: unknown, feature: RecoveryFeature = 'fullscreen'): RecoveryResult {
  if (!value || typeof value !== 'object' || !('snapshot' in value)) throw new Error('Invalid Fullscreen recovery response')
  const result = value as RecoveryResult
  if (!result.snapshot || !states.has(result.snapshot.state) ||
      result.snapshot.policyVersion !== RECOVERY_FEATURE_DEFINITIONS[feature].policyVersion ||
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

/**
 * Forge remote requests carry the FIT used by the server to identify this viewer.
 * `fullscreen` sends no feature on the wire, so the request is what older clients send.
 */
export async function getFullscreenRecovery(spaceKey?: string, feature: RecoveryFeature = 'fullscreen'): Promise<RecoverySnapshot> {
  const query = [
    spaceKey ? `spaceKey=${encodeURIComponent(spaceKey)}` : '',
    feature !== 'fullscreen' ? `feature=${encodeURIComponent(feature)}` : '',
  ].filter(Boolean).join('&')
  const url = query ? `${endpoint}?${query}` : endpoint
  return requireResult(await bounded(callRemote(url, 'GET'), 8000), feature).snapshot
}

/** The input carries `feature` only for features other than `fullscreen`. */
export async function requestFullscreenRecovery(input: RecoveryRequestInput): Promise<RecoveryResult> {
  return requireResult(await bounded(callRemote(endpoint, 'POST', input), 15000), input.feature)
}

export async function activateFullscreenRecovery(input: RecoveryActivateInput): Promise<RecoveryResult> {
  return requireResult(await bounded(callRemote(endpoint, 'POST', input), 15000), input.feature)
}
