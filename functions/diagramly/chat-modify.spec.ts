import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../service/diagramlyService", () => ({
  modifyDiagramWithCommand: vi.fn(),
}));

import { modifyDiagramWithCommand } from "../service/diagramlyService";
import { onRequest } from "./chat-modify";

const verifiedData = {
  forgeContext: {
    accountId: "verified-account-123",
    cloudId: "verified-cloud-789",
  },
};

function makeRequest(body: object) {
  return new Request("https://example.com/diagramly/chat-modify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  diagramId: "diagram-1",
  diagramCode: "A -> B",
  command: "Add payment",
  diagramType: "sequence",
};

describe("diagramly chat-modify route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the verified identity and forwards versioned repair options", async () => {
    vi.mocked(modifyDiagramWithCommand).mockResolvedValue({ jobId: "job-1" });
    const env = { DIAGRAMLY_API_KEY: "test-key" };

    const result = await onRequest({
      request: makeRequest({
        ...validBody,
        accountId: "attacker-account",
        teamId: "attacker-team",
        errorMessage: "Unexpected token",
        model: "anthropic/claude-sonnet-5",
        disableReasoning: false,
      }),
      env,
      data: verifiedData,
    });

    expect(result.status).toBe(200);
    expect(modifyDiagramWithCommand).toHaveBeenCalledWith(
      {
        accountId: "verified-account-123",
        cloudId: "verified-cloud-789",
        env,
      },
      {
        diagramId: "diagram-1",
        diagramCode: "A -> B",
        command: "Add payment",
        diagramType: "sequence",
        errorMessage: "Unexpected token",
        model: "anthropic/claude-sonnet-5",
        disableReasoning: false,
      },
    );
  });

  it.each([
    [{ ...validBody, diagramId: " " }, "Missing diagramId"],
    [{ ...validBody, diagramCode: " " }, "Missing diagramCode"],
    [{ ...validBody, command: " " }, "Missing command"],
    [{ ...validBody, diagramType: "graph" }, "Unsupported diagramType"],
    [{ ...validBody, diagramType: "unknown" }, "Unsupported diagramType"],
    [{ ...validBody, errorMessage: 123 }, "errorMessage must be a string"],
    [{ ...validBody, model: 123 }, "model must be a string"],
    [
      { ...validBody, disableReasoning: "false" },
      "disableReasoning must be a boolean",
    ],
  ])("rejects invalid versioned modification input", async (body, message) => {
    const result = await onRequest({
      request: makeRequest(body),
      env: {},
      data: verifiedData,
    });

    expect(result.status).toBe(400);
    await expect(result.json()).resolves.toEqual({ error: message });
    expect(modifyDiagramWithCommand).not.toHaveBeenCalled();
  });

  it("rejects requests without a verified accountId", async () => {
    const result = await onRequest({
      request: makeRequest(validBody),
      env: {},
      data: { forgeContext: { cloudId: "verified-cloud-789" } },
    });

    expect(result.status).toBe(400);
    await expect(result.json()).resolves.toEqual({
      error: "Missing accountId in Forge context",
    });
    expect(modifyDiagramWithCommand).not.toHaveBeenCalled();
  });
});
