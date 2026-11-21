import { describe, expect, it } from 'vitest';
import type { AnalyticsEventName as FrontendAnalyticsEventName } from '../../src/utils/analytics/catalog';
import {
  CANONICAL_EVENT_NAME_LIST,
  type AnalyticsEventName as BackendAnalyticsEventName,
} from '../../functions/service/analyticsTypes';

const serverEvents = [
  'bundle_checkout_redirected',
  'bundle_checkout_continued',
] as const satisfies readonly FrontendAnalyticsEventName[] & readonly BackendAnalyticsEventName[];

const clientEvents = ['bundle_checkout_open_result'] as const satisfies readonly FrontendAnalyticsEventName[];

describe('bundle checkout analytics vocabulary', () => {
  it('registers the server-sent handoff events in the backend list', () => {
    const canonical = new Set<string>(CANONICAL_EVENT_NAME_LIST);
    expect(serverEvents.every((name) => canonical.has(name))).toBe(true);
  });

  it('keeps the client-only open result out of the backend list', () => {
    const canonical = new Set<string>(CANONICAL_EVENT_NAME_LIST);
    expect(clientEvents.some((name) => canonical.has(name))).toBe(false);
  });
});
