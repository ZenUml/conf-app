import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../service/diagramlyService", () => ({
  ensureDiagramlyDiagram: vi.fn(),
}));

import { ensureDiagramlyDiagram } from "../service/diagramlyService";
import { onRequest } from "./ensure-diagram";

const verifiedData = {
  forgeContext: {
    accountId: "verified-account-123",
    cloudId: "verified-cloud-789",
  },
};

function makeRequest(body: object) {
  return new Request("https://example.com/diagramly/ensure-diagram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("diagramly ensure-diagram route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses only the verified Forge identity", async () => {
    vi.mocked(ensureDiagramlyDiagram).mockResolvedValue({
      diagramId: "diagram-1",
      versionId: "version-1",
    });
    const env = { DIAGRAMLY_API_KEY: "test-key" };

    const result = await onRequest({
      request: makeRequest({
        accountId: "attacker-account",
        teamId: "attacker-team",
        diagramCode: "A -> B",
        diagramType: "sequence",
        title: "Checkout",
      }),
      env,
      data: verifiedData,
    });

    expect(result.status).toBe(200);
    expect(ensureDiagramlyDiagram).toHaveBeenCalledWith(
      {
        accountId: "verified-account-123",
        cloudId: "verified-cloud-789",
        env,
      },
      "A -> B",
      "sequence",
      "Checkout",
      undefined,
    );
  });

  it("allows an existing diagram to be resolved without creation code", async () => {
    vi.mocked(ensureDiagramlyDiagram).mockResolvedValue({
      diagramId: "diagram-1",
      versionId: "version-2",
    });

    const result = await onRequest({
      request: makeRequest({
        diagramId: "diagram-1",
        diagramType: "mermaid",
      }),
      env: {},
      data: verifiedData,
    });

    expect(result.status).toBe(200);
    expect(ensureDiagramlyDiagram).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "verified-account-123",
        cloudId: "verified-cloud-789",
      }),
      undefined,
      "mermaid",
      undefined,
      "diagram-1",
    );
  });

  it.each([
    [{ diagramType: "sequence" }, "Missing diagramCode"],
    [{ diagramCode: "A -> B" }, "Unsupported diagramType"],
    [{ diagramCode: "A -> B", diagramType: "graph" }, "Unsupported diagramType"],
  ])("rejects invalid input", async (body, message) => {
    const result = await onRequest({
      request: makeRequest(body),
      env: {},
      data: verifiedData,
    });

    expect(result.status).toBe(400);
    await expect(result.json()).resolves.toEqual({ error: message });
    expect(ensureDiagramlyDiagram).not.toHaveBeenCalled();
  });

  it("rejects requests without a verified cloudId", async () => {
    const result = await onRequest({
      request: makeRequest({
        diagramCode: "A -> B",
        diagramType: "sequence",
      }),
      env: {},
      data: { forgeContext: { accountId: "verified-account-123" } },
    });

    expect(result.status).toBe(400);
    await expect(result.json()).resolves.toEqual({
      error: "Missing cloudId in Forge context",
    });
    expect(ensureDiagramlyDiagram).not.toHaveBeenCalled();
  });
});
