import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../service/diagramlyService", () => ({
  chat: vi.fn(),
  modifyDiagramWithCommand: vi.fn(),
  ensureDiagramlyDiagram: vi.fn(),
  modifyDiagram: vi.fn(),
  callDiagramly: vi.fn(),
  restoreDiagramlyVersion: vi.fn(),
  getDiagramlyVersions: vi.fn(),
}));

import { response } from "../OkResponse";
import { diagramlyRoute } from "./route";
import { onRequest as chat } from "./chat";
import { onRequest as chatModify } from "./chat-modify";
import { onRequest as ensureDiagram } from "./ensure-diagram";
import { onRequest as fixDiagram } from "./fix-diagram";
import { onRequest as jobStatus } from "./job-status";
import { onRequest as restoreVersion } from "./restore-version";
import { onRequest as versions } from "./versions";

const data = {
  forgeContext: { accountId: "account-1", cloudId: "cloud-1" },
};
const env = { DIAGRAMLY_API_KEY: "test-key" };

const post = (body: string) =>
  new Request("https://example.com/diagramly/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

const call = (handler: any, request: Request, d: any = data) =>
  handler({ request, env, data: d });

const handlers: Array<[string, any]> = [
  ["chat", chat],
  ["chat-modify", chatModify],
  ["ensure-diagram", ensureDiagram],
  ["fix-diagram", fixDiagram],
  ["job-status", jobStatus],
  ["restore-version", restoreVersion],
  ["versions", versions],
];

describe("diagramly routes share one shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe.each(handlers)("%s", (_name, handler) => {
    it("answers 400 for a body that is not JSON", async () => {
      const res = await call(handler, post("not json {"));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid JSON body" });
    });

    it("answers 405 for GET", async () => {
      const res = await call(
        handler,
        new Request("https://example.com/diagramly/x", { method: "GET" }),
      );
      expect(res.status).toBe(405);
    });
  });

  describe("diagramlyRoute", () => {
    it("returns the identity Response when identity is missing", async () => {
      const run = vi.fn();
      const route: any = diagramlyRoute("t", { parse: (b) => b, run });
      const res = await call(route, post("{}"), { forgeContext: {} });
      expect(res.status).toBe(400);
      expect(run).not.toHaveBeenCalled();
    });

    it("checks identity before the body: missing identity + bad JSON gets the identity answer", async () => {
      const run = vi.fn();
      const route: any = diagramlyRoute("t", { parse: (b) => b, run });
      const res = await call(route, post("{not json"), { forgeContext: {} });
      expect(res.status).toBe(400);
      expect(await res.json()).not.toEqual({ error: "Invalid JSON body" });
      expect(run).not.toHaveBeenCalled();
    });

    it("returns a Response from parse as is", async () => {
      const run = vi.fn();
      const route: any = diagramlyRoute("t", {
        parse: () => response(400, "Missing x"),
        run,
      });
      const res = await call(route, post("{}"));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Missing x" });
      expect(run).not.toHaveBeenCalled();
    });

    it("passes identity and env to run and wraps the result in 200", async () => {
      const run = vi.fn().mockResolvedValue({ ok: true });
      const route: any = diagramlyRoute("t", {
        parse: (b: any) => b.value,
        run,
      });
      const res = await call(route, post('{"value":7}'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(run).toHaveBeenCalledWith(
        { accountId: "account-1", cloudId: "cloud-1", env },
        7,
      );
    });

    it("answers 500 with the error message and logs one tagged line", async () => {
      const route: any = diagramlyRoute("t", {
        parse: (b) => b,
        run: async () => {
          throw new Error("boom");
        },
      });
      const res = await call(route, post("{}"));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "boom" });
      expect(console.error).toHaveBeenCalledWith("[diagramly/t] Error:", "boom");
    });

    it("falls back to a generic 500 body when the message is empty", async () => {
      const route: any = diagramlyRoute("t", {
        parse: (b) => b,
        run: async () => {
          throw new Error("");
        },
      });
      const res = await call(route, post("{}"));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Internal server error" });
    });
  });
});
