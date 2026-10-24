import { describe, expect, it } from 'vitest';
import type { AnalyticsEventName as FrontendAnalyticsEventName } from '../../src/utils/analytics/catalog';
import {
  CANONICAL_EVENT_NAME_LIST,
  type AnalyticsEventName as BackendAnalyticsEventName,
} from '../../functions/service/analyticsTypes';

const eventNames = [
  'macro_count_snapshot_completed',
  'macro_count_space_changed',
  'macro_count_snapshot_failed',
] as const satisfies readonly FrontendAnalyticsEventName[] & readonly BackendAnalyticsEventName[];

describe('daily macro count analytics vocabulary', () => {
  it('registers all three backend event names', () => {
    const canonicalNames = new Set(CANONICAL_EVENT_NAME_LIST);
    expect(eventNames.every((name) => canonicalNames.has(name))).toBe(true);
  });
});
