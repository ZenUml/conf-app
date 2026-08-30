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
