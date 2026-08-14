import { describe, it, expect, vi } from "vitest";

vi.mock("./utils/sentry", () => ({
  captureError: vi.fn(),
}));

import { onRequest } from "./activation-prepared";

type Bind = { args: unknown[] };

function makeDB(row: Record<string, unknown> | null) {
  const binds: Bind[] = [];
  const runs: { sql: string; args: unknown[] }[] = [];
  return {
    binds,
    runs,
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => {
        binds.push({ args });
        return {
          first: async () => row,
          run: async () => {
            runs.push({ sql, args });
            return { success: true };
          },
        };
      }),
    })),
  } as any;
}

function makeRequest(url: string, method = "GET", body?: unknown): Request {
  return new Request(url, {
    method,
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

const forgeData = {
  forgeContext: { cloudId: "cloud-1", forgeAppId: "app-uuid-1" },
} as any;

const validPostBody = {
  pageId: "123456",
  diagramType: "sequence",
  diagramSource: "A->B: hi",
  title: "Order flow",
};

describe("activation-prepared", () => {
  it("rejects unsupported methods with 405", async () => {
    const res = await onRequest({
      request: makeRequest("https://backend.example/activation-prepared?pageId=1", "DELETE"),
      env: { DB: makeDB(null) },
      data: forgeData,
    });
    expect(res.status).toBe(405);
  });

  it("rejects GET when forgeContext.cloudId is missing", async () => {
    const res = await onRequest({
      request: makeRequest("https://backend.example/activation-prepared?pageId=123456"),
      env: { DB: makeDB(null) },
      data: {} as any,
    });
    expect(res.status).toBe(401);
  });

  it("rejects POST when forgeContext.cloudId is missing", async () => {
    const res = await onRequest({
      request: makeRequest("https://backend.example/activation-prepared", "POST", validPostBody),
      env: { DB: makeDB(null) },
      data: {} as any,
    });
    expect(res.status).toBe(401);
  });

  it("GET returns 200 with the cached row on a hit", async () => {
    const db = makeDB({
      diagramType: "sequence",
      diagramSource: "A->B: hi",
      title: "Order flow",
      curatedAt: "2026-07-26T00:00:00.000Z",
    });
    const res = await onRequest({
      request: makeRequest("https://backend.example/activation-prepared?pageId=123456"),
      env: { DB: db },
      data: forgeData,
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as any;
    expect(out).toEqual({
      diagramType: "sequence",
      diagramSource: "A->B: hi",
      title: "Order flow",
      curatedAt: "2026-07-26T00:00:00.000Z",
    });
  });

  it("GET returns a bare 404 with no body on a cache miss", async () => {
    const res = await onRequest({
      request: makeRequest("https://backend.example/activation-prepared?pageId=123456"),
      env: { DB: makeDB(null) },
      data: forgeData,
    });
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe("");
  });

  it("GET ignores a client-supplied cloudId query param and uses the FIT cloudId", async () => {
    const db = makeDB({
      diagramType: "sequence",
      diagramSource: "A->B: hi",
      title: null,
      curatedAt: "2026-07-26T00:00:00.000Z",
    });
    const res = await onRequest({
      request: makeRequest(
        "https://backend.example/activation-prepared?pageId=123456&cloudId=attacker-cloud",
      ),
      env: { DB: db },
      data: forgeData,
    });
    expect(res.status).toBe(200);
    // The only cloudId ever bound to the query is the FIT-verified one.
    expect(db.binds[0].args).toEqual(["cloud-1", "123456"]);
  });

  it("GET with a non-numeric pageId returns 400", async () => {
    const res = await onRequest({
      request: makeRequest("https://backend.example/activation-prepared?pageId=abc"),
      env: { DB: makeDB(null) },
      data: forgeData,
    });
    expect(res.status).toBe(400);
  });

  it("GET with a missing pageId returns 400", async () => {
    const res = await onRequest({
      request: makeRequest("https://backend.example/activation-prepared"),
      env: { DB: makeDB(null) },
      data: forgeData,
    });
    expect(res.status).toBe(400);
  });

  it("POST with a non-numeric pageId returns 400", async () => {
    const res = await onRequest({
      request: makeRequest("https://backend.example/activation-prepared", "POST", {
        ...validPostBody,
        pageId: "abc",
      }),
      env: { DB: makeDB(null) },
      data: forgeData,
    });
    expect(res.status).toBe(400);
  });

  it("POST rejects an empty diagramType or diagramSource with 400", async () => {
    const env = { DB: makeDB(null) };
    const missingType = await onRequest({
      request: makeRequest("https://backend.example/activation-prepared", "POST", {
        ...validPostBody,
        diagramType: "",
      }),
      env,
      data: forgeData,
    });
    expect(missingType.status).toBe(400);

    const missingSource = await onRequest({
      request: makeRequest("https://backend.example/activation-prepared", "POST", {
        ...validPostBody,
        diagramSource: "",
      }),
      env,
      data: forgeData,
    });
    expect(missingSource.status).toBe(400);
  });

  it("POST rejects a diagramSource over the 100KB cap with 413", async () => {
    const res = await onRequest({
      request: makeRequest("https://backend.example/activation-prepared", "POST", {
        ...validPostBody,
        diagramSource: "x".repeat(100 * 1024 + 1),
      }),
      env: { DB: makeDB(null) },
      data: forgeData,
    });
    expect(res.status).toBe(413);
  });

  it("POST invalid JSON body returns 400", async () => {
    const req = new Request("https://backend.example/activation-prepared", {
      method: "POST",
      body: "not json",
    });
    const res = await onRequest({
      request: req,
      env: { DB: makeDB(null) },
      data: forgeData,
    });
    expect(res.status).toBe(400);
  });

  it("POST upserts with the FIT cloudId/appId and the right bound params", async () => {
    const db = makeDB(null);
    const res = await onRequest({
      request: makeRequest("https://backend.example/activation-prepared", "POST", validPostBody),
      env: { DB: db },
      data: forgeData,
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as any;
    expect(out).toEqual({ ok: true });

    expect(db.runs).toHaveLength(1);
    const [cloudId, pageId, appId, diagramType, diagramSource, title, curatedAt] =
      db.runs[0].args;
    expect(cloudId).toBe("cloud-1");
    expect(pageId).toBe("123456");
    expect(appId).toBe("app-uuid-1");
    expect(diagramType).toBe("sequence");
    expect(diagramSource).toBe("A->B: hi");
    expect(title).toBe("Order flow");
    expect(typeof curatedAt).toBe("string");
    expect(db.runs[0].sql).toMatch(/ON CONFLICT\(cloudId, pageId, appId\)/);
  });

  it("POST truncates an oversized title instead of rejecting", async () => {
    const db = makeDB(null);
    const res = await onRequest({
      request: makeRequest("https://backend.example/activation-prepared", "POST", {
        ...validPostBody,
        title: "x".repeat(1000),
      }),
      env: { DB: db },
      data: forgeData,
    });
    expect(res.status).toBe(200);
    const titleArg = db.runs[0].args[5] as string;
    expect(titleArg).toHaveLength(300);
  });
});
