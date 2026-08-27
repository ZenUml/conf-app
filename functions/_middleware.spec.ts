import { beforeEach, describe, it, expect, vi } from "vitest";
import authenticate from "./utils/authenticate";
import {
  AUTHENTICATED_PATHS,
  authMiddleware,
  redactedRequestUrlForLogging,
} from "./_middleware";

vi.mock("./utils/authenticate", () => ({
  default: vi.fn(),
}));

describe("_middleware", () => {
  beforeEach(() => {
    vi.mocked(authenticate).mockReset();
    vi.mocked(authenticate).mockResolvedValue(new Response(null, { status: 200 }));
  });

  it("adds /deeplink-ticket to AUTHENTICATED_PATHS; /d and /i stay public", () => {
    expect(AUTHENTICATED_PATHS).toContain("/deeplink-ticket");
    expect(AUTHENTICATED_PATHS).toContain("/architecture-tokens");
    expect(AUTHENTICATED_PATHS.some((p) => p === "/d" || p === "/i")).toBe(false);
  });

  it("authenticates both diagram impact endpoints", async () => {
    for (const path of ["/api/diagram-impact", "/api/diagram-impact/view"]) {
      const next = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
      await authMiddleware({
        request: new Request(`https://example.test${path}`),
        next,
        env: {},
        data: {},
      } as never);
    }
    expect(AUTHENTICATED_PATHS).toContain("/api/diagram-impact");
    expect(authenticate).toHaveBeenCalledTimes(2);
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

  it("answers deeplink-ticket CORS preflight without requiring a Forge token", async () => {
    const next = vi.fn();
    const response = await authMiddleware({
      request: new Request("https://conf-stg-full.zenuml.com/deeplink-ticket", {
        method: "OPTIONS",
        headers: {
          origin: "https://full-stg.atlassian.net",
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,content-type",
        },
      }),
      next,
      env: {},
      data: {},
    } as never);

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toContain("Authorization");
    expect(authenticate).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("adds CORS headers to authenticated deeplink-ticket responses", async () => {
    const response = await authMiddleware({
      request: new Request("https://conf-stg-full.zenuml.com/deeplink-ticket", {
        method: "POST",
        headers: { authorization: "Bearer test" },
      }),
      next: vi.fn().mockResolvedValue(new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      })),
      env: {},
      data: {},
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("adds CORS headers to deeplink-ticket authentication errors", async () => {
    vi.mocked(authenticate).mockResolvedValue(new Response('{"error":"Unauthorized"}', {
      status: 401,
      headers: { "content-type": "application/json" },
    }));

    const response = await authMiddleware({
      request: new Request("https://conf-stg-full.zenuml.com/deeplink-ticket", { method: "POST" }),
      next: vi.fn(),
      env: {},
      data: {},
    } as never);

    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});
