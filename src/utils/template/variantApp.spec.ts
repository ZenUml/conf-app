import { afterEach, describe, expect, it, vi } from "vitest";
import { liteAppIdentity } from "./variantApp";

afterEach(() => vi.unstubAllEnvs());

describe("liteAppIdentity", () => {
  it("returns the Lite Forge app and sequence-family macro identity", () => {
    vi.stubEnv("PRODUCT_TYPE", "lite");

    expect(liteAppIdentity()).toEqual({
      appId: "8ad26115-211f-4216-971b-0540f606303d",
      macroKey: "zenuml-sequence-macro-lite",
    });
  });

  it("refuses to run in another product variant", () => {
    vi.stubEnv("PRODUCT_TYPE", "full");

    expect(() => liteAppIdentity()).toThrow(/Lite-only/);
  });
});
