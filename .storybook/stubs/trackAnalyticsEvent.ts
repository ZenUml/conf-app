import type { AnalyticsEventName } from '@/utils/analytics/catalog'
import type { AnalyticsProperties } from '@/utils/analytics/types'

/**
 * Storybook renders outside Forge and intentionally has no Mixpanel token.
 * Keep component interactions deterministic without sending or queueing events.
 */
export function trackAnalyticsEvent(
  _eventName: AnalyticsEventName,
  _properties: AnalyticsProperties = {},
): void {}

export async function _awaitableTrackAnalyticsEvent(
  _eventName: AnalyticsEventName,
  _properties: AnalyticsProperties,
): Promise<void> {}

export async function trackAnalyticsEventBeforeUnload(
  _eventName: AnalyticsEventName,
  _properties: AnalyticsProperties,
): Promise<void> {}

export function _resetForTesting(): void {}

export const SESSION_REPLAY_CONFIG_TIMEOUT_MS = 3000

/** No recorder in Storybook, so there is never a replay id. */
export async function getSessionReplayId(
  _timeoutMs = 500,
  _intervalMs = 50,
): Promise<string | undefined> {
  return undefined
}

export async function registerAnalyticsSuperProperties(
  _properties: Pick<AnalyticsProperties, 'feedback_token' | 'viewer_replay_id'>,
): Promise<void> {}
