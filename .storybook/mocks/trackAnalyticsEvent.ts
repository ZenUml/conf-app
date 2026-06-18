import type { AnalyticsEventName } from '@/utils/analytics/catalog'
import type { AnalyticsProperties } from '@/utils/analytics/types'

export async function _awaitableTrackAnalyticsEvent(
  _eventName: AnalyticsEventName,
  _properties: AnalyticsProperties,
): Promise<void> {}

export function trackAnalyticsEvent(
  _eventName: AnalyticsEventName,
  _properties: AnalyticsProperties,
): void {}

export function _resetForTesting(): void {}
