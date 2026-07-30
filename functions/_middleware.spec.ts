import { describe, it, expect } from "vitest";
import { AUTHENTICATED_PATHS, redactedRequestUrlForLogging } from "./_middleware";

describe("_middleware", () => {
  it("adds /deeplink-ticket to AUTHENTICATED_PATHS; /d and /i stay public", () => {
    expect(AUTHENTICATED_PATHS).toContain("/deeplink-ticket");
    expect(AUTHENTICATED_PATHS.some((p) => p === "/d" || p === "/i")).toBe(false);
  });

  it("redacts /d and /i request URLs before logging (client-privacy policy)", () => {
    expect(redactedRequestUrlForLogging("https://conf-lite.zenuml.com/d/bc8bb5b3-09d2-4932-b68c-9b56fab8e34a/425987?t=abc.def"))
      .toBe("https://conf-lite.zenuml.com/d [redacted]");
    expect(redactedRequestUrlForLogging("https://conf-lite.zenuml.com/i/abc.def"))
      .toBe("https://conf-lite.zenuml.com/i [redacted]");
  });

  it("logs other paths verbatim (unchanged behavior)", () => {
    const url = "https://conf-lite.zenuml.com/diagramly/chat";
    expect(redactedRequestUrlForLogging(url)).toBe(url);
  });
});
