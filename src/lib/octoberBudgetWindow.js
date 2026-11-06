// Shared by the browser analytics bundle and Forge's Node-executed export path.
const OCTOBER_START_UTC = Date.UTC(2026, 9, 1);
const NOVEMBER_START_UTC = Date.UTC(2026, 10, 1);

export function isOctoberBillingBudgetActive(now = Date.now()) {
  return now >= OCTOBER_START_UTC && now < NOVEMBER_START_UTC;
}
