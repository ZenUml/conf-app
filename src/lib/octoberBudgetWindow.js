// Shared by the browser analytics bundle and Forge's Node-executed export path.
const OCTOBER_START_UTC = Date.UTC(2026, 9, 1);
const NOVEMBER_START_UTC = Date.UTC(2026, 10, 1);
const DECEMBER_START_UTC = Date.UTC(2026, 11, 1);

// Session replay budget: October 2026 only. Exceeding the replay cap stops
// recording rather than billing, so replay returns to its flag-driven rates.
export function isOctoberBillingBudgetActive(now = Date.now()) {
  return now >= OCTOBER_START_UTC && now < NOVEMBER_START_UTC;
}

// Billable event budget: started October 2026 and stays in force. Tracked
// events over the plan allowance are billed per thousand; the 7 days to
// 2026-10-30 ran at ~1.23M/month WITH this budget against a 1M allowance,
// and reverting it would roughly double that.
export function isEventBudgetActive(now = Date.now()) {
  return now >= OCTOBER_START_UTC;
}

// Session replay budget: November 2026 only. Lowers the authoring and
// fullscreen replay rates (see trackAnalyticsEvent.ts); from 2026-12-01 UTC
// the normal rates return without a deploy.
export function isNovemberReplayBudgetActive(now = Date.now()) {
  return now >= NOVEMBER_START_UTC && now < DECEMBER_START_UTC;
}
