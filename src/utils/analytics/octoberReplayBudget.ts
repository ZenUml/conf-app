// Temporary Session Replay budget for the October 2026 UTC billing month.
// Keep the start boundary explicit so other dates retain their original policy.
const OCTOBER_START_UTC = Date.UTC(2026, 9, 1);
const NOVEMBER_START_UTC = Date.UTC(2026, 10, 1);

export function isOctoberReplayBudgetActive(now = Date.now()): boolean {
  return now >= OCTOBER_START_UTC && now < NOVEMBER_START_UTC;
}
