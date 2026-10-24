import { describe, expect, it } from "vitest";
import { isOctoberReplayBudgetActive } from "./octoberReplayBudget";

describe("October 2026 Replay budget window", () => {
  it("starts at October 1 UTC and expires exactly at November 1 UTC", () => {
    expect(isOctoberReplayBudgetActive(Date.parse("2026-09-30T23:59:59.999Z"))).toBe(false);
    expect(isOctoberReplayBudgetActive(Date.parse("2026-10-01T00:00:00.000Z"))).toBe(true);
    expect(isOctoberReplayBudgetActive(Date.parse("2026-10-31T23:59:59.999Z"))).toBe(true);
    expect(isOctoberReplayBudgetActive(Date.parse("2026-11-01T00:00:00.000Z"))).toBe(false);
  });
});
