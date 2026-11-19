import { describe, expect, it, vi } from "vitest";
import { handle, isAllowedCountry } from "./index";

const FORGE_ORIGIN = "https://abc123.cdn.prod.atlassian-dev.net";

function req(path: string, init: RequestInit & { country?: string } = {}) {
  const r = new Request(`https://stats.zenuml.com${path}`, init);
  Object.defineProperty(r, "cf", { value: { country: init.country } });
  return r;
}

describe("isAllowedCountry", () => {
  it.each([
    ["AU", true],
    ["US", true],
    ["DE", false],
    ["NO", false],
    ["GB", false],
    ["CH", false],
    ["XX", false],
    ["T1", false],
    [undefined, false],
    ["", false],
  ])("%s -> %s", (country, expected) => {
    expect(isAllowedCountry(country as string | undefined)).toBe(expected);
  });
});

describe("handle", () => {
  it("answers allow with CORS for a Forge iframe origin", async () => {
    const res = await handle(req("/clarity/allow", { headers: { Origin: FORGE_ORIGIN }, country: "AU" }));
    expect(await res.json()).toEqual({ allow: true });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(FORGE_ORIGIN);
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  it("answers allow:false for an EEA visitor", async () => {
    const res = await handle(req("/clarity/allow", { country: "FR" }));
    expect(await res.json()).toEqual({ allow: false });
  });

  it("gives no CORS grant to another origin", async () => {
    const res = await handle(req("/clarity/allow", { headers: { Origin: "https://evil.example" }, country: "AU" }));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("forwards collect with content headers only", async () => {
    const upstream = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const res = await handle(
      req("/clarity/collect?x=1", {
        method: "POST",
        body: "payload",
        country: "US",
        headers: {
          Origin: FORGE_ORIGIN,
          "Content-Type": "application/x-clarity-gzip",
          Cookie: "a=b",
          "User-Agent": "UA",
        },
      }),
      upstream as unknown as typeof fetch,
    );
    expect(res.status).toBe(200);
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe("https://s.clarity.ms/collect?x=1");
    const sent = init.headers as Headers;
    expect(sent.get("content-type")).toBe("application/x-clarity-gzip");
    expect(sent.get("cookie")).toBeNull();
    expect(sent.get("user-agent")).toBeNull();
  });

  it("drops collect from a blocked country without calling upstream", async () => {
    const upstream = vi.fn();
    const res = await handle(req("/clarity/collect", { method: "POST", body: "p", country: "DE" }), upstream as any);
    expect(res.status).toBe(204);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("404s the retired Statsig routes", async () => {
    const res = await handle(req("/v1/rgstr", { method: "POST", body: "p", country: "US" }));
    expect(res.status).toBe(404);
  });
});
