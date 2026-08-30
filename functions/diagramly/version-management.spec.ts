import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../service/diagramlyService", () => ({
  getDiagramlyVersions: vi.fn(),
  restoreDiagramlyVersion: vi.fn(),
}));

import {
  getDiagramlyVersions,
  restoreDiagramlyVersion,
} from "../service/diagramlyService";
import { onRequest as restoreVersion } from "./restore-version";
import { onRequest as getVersions } from "./versions";

const verifiedData = {
  forgeContext: {
    accountId: "verified-account-123",
    cloudId: "verified-cloud-789",
  },
};

function makeRequest(path: string, body: object) {
  return new Request(`https://example.com/diagramly/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("diagramly versions route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads team-scoped versions with only the verified Forge identity", async () => {
    vi.mocked(getDiagramlyVersions).mockResolvedValue({
      diagram: { id: "diagram-1" },
      versions: [{ id: "version-1", versionNumber: 1 }],
    });
    const env = { DIAGRAMLY_API_KEY: "test-key" };

    const result = await getVersions({
      request: makeRequest("versions", {
        diagramId: "diagram-1",
        accountId: "attacker-account",
        teamId: "attacker-team",
      }),
      env,
      data: verifiedData,
    });

    expect(result.status).toBe(200);
    expect(getDiagramlyVersions).toHaveBeenCalledWith(
      {
        accountId: "verified-account-123",
        cloudId: "verified-cloud-789",
        env,
      },
      "diagram-1",
    );
  });

  it("rejects an empty diagramId", async () => {
    const result = await getVersions({
      request: makeRequest("versions", { diagramId: " " }),
      env: {},
      data: verifiedData,
    });

    expect(result.status).toBe(400);
    await expect(result.json()).resolves.toEqual({
      error: "Missing diagramId",
    });
    expect(getDiagramlyVersions).not.toHaveBeenCalled();
  });

  it("rejects requests without a verified cloudId", async () => {
    const result = await getVersions({
      request: makeRequest("versions", { diagramId: "diagram-1" }),
      env: {},
      data: { forgeContext: { accountId: "verified-account-123" } },
    });

    expect(result.status).toBe(400);
    expect(getDiagramlyVersions).not.toHaveBeenCalled();
  });
});

describe("diagramly restore-version route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores a version with only the verified Forge identity", async () => {
    vi.mocked(restoreDiagramlyVersion).mockResolvedValue({
      diagramId: "diagram-1",
      version: { id: "version-3", versionNumber: 3 },
      diagramCode: "A -> B",
    });
    const env = { DIAGRAMLY_API_KEY: "test-key" };

    const result = await restoreVersion({
      request: makeRequest("restore-version", {
        diagramId: "diagram-1",
        versionId: "version-1",
        accountId: "attacker-account",
        teamId: "attacker-team",
      }),
      env,
      data: verifiedData,
    });

    expect(result.status).toBe(200);
    expect(restoreDiagramlyVersion).toHaveBeenCalledWith(
      {
        accountId: "verified-account-123",
        cloudId: "verified-cloud-789",
        env,
      },
      "diagram-1",
      "version-1",
    );
  });

  it.each([
    [{ versionId: "version-1" }, "Missing diagramId"],
    [{ diagramId: "diagram-1" }, "Missing versionId"],
  ])("rejects invalid restore input", async (body, message) => {
    const result = await restoreVersion({
      request: makeRequest("restore-version", body),
      env: {},
      data: verifiedData,
    });

    expect(result.status).toBe(400);
    await expect(result.json()).resolves.toEqual({ error: message });
    expect(restoreDiagramlyVersion).not.toHaveBeenCalled();
  });

  it("rejects requests without a verified accountId", async () => {
    const result = await restoreVersion({
      request: makeRequest("restore-version", {
        diagramId: "diagram-1",
        versionId: "version-1",
      }),
      env: {},
      data: { forgeContext: { cloudId: "verified-cloud-789" } },
    });

    expect(result.status).toBe(400);
    expect(restoreDiagramlyVersion).not.toHaveBeenCalled();
  });
});
