import { describe, expect, it } from "vitest";
import {
  getAtlassianInstanceClientDomain,
  getForgeInstallationClientDomain,
  upsertAtlassianInstance,
  upsertForgeInstallation,
} from "../../functions/utils/dbUtils";

class MockStatement {
  constructor(
    private readonly sql: string,
    private readonly state: MockDbState,
  ) {}

  bind(...params: unknown[]) {
    this.state.calls.push({ sql: this.sql, params });
    const firstResult = this.state.firstResults.shift();
    const runResult = this.state.runResults.shift() || { success: true };

    return {
      first: async <T>() => firstResult as T,
      run: async () => runResult,
    };
  }
}

interface MockDbState {
  calls: Array<{ sql: string; params: unknown[] }>;
  firstResults: unknown[];
  runResults: unknown[];
}

function createMockDb(firstResults: unknown[] = [], runResults: unknown[] = []) {
  const state: MockDbState = {
    calls: [],
    firstResults: [...firstResults],
    runResults: [...runResults],
  };

  const db = {
    prepare(sql: string) {
      return new MockStatement(sql, state);
    },
  };

  return { db, state };
}

describe("dbUtils", () => {
  it("prefers a non-empty stored client domain across raw and normalized app ids", async () => {
    const { db, state } = createMockDb([{ clientDomain: "whimet4.atlassian.net" }]);

    const result = await getForgeInstallationClientDomain(
      db as never,
      "ari:cloud:ecosystem::app/d9e4002b-120b-426b-834b-402a4a5adce7",
      "866c3a03-ec62-4717-91c4-1ad078bfcc60",
    );

    expect(result).toBe("whimet4.atlassian.net");
    expect(state.calls[0].sql).toContain("appId IN (?1, ?2)");
    expect(state.calls[0].sql).toContain("clientDomain IS NOT NULL");
    expect(state.calls[0].sql).toContain("ORDER BY createdAt DESC");
    expect(state.calls[0].params).toEqual([
      "ari:cloud:ecosystem::app/d9e4002b-120b-426b-834b-402a4a5adce7",
      "d9e4002b-120b-426b-834b-402a4a5adce7",
      "866c3a03-ec62-4717-91c4-1ad078bfcc60",
    ]);
  });

  it("preserves an existing stored client domain when a new installation row is inserted", async () => {
    const { db, state } = createMockDb(
      [undefined, { clientDomain: "whimet4.atlassian.net" }],
      [{ success: true }, { success: true }],
    );

    await upsertForgeInstallation(db as never, {
      id: "installation-1",
      context: "ari:cloud:confluence::site/866c3a03-ec62-4717-91c4-1ad078bfcc60",
      installerAccountId: "user-1",
      eventType: "avi:forge:installed:app",
      app: {
        id: "d9e4002b-120b-426b-834b-402a4a5adce7",
        name: "ZenUML Lite",
        ownerAccountId: "owner-1",
        version: "1",
      },
      environment: {
        id: "env-1",
      },
      permissions: {
        scopes: [],
        external: {
          fetch: {
            backend: [],
            client: [],
          },
        },
        frames: [],
        scripts: [],
      },
    });

    const insertCall = state.calls.at(-1);
    expect(insertCall?.sql).toContain("clientDomain = COALESCE(excluded.clientDomain, ForgeInstallation.clientDomain)");
    expect(insertCall?.params[8]).toBe("whimet4.atlassian.net");
  });
});

describe("AtlassianInstance", () => {
  it("getAtlassianInstanceClientDomain returns stored domain for a cloudId", async () => {
    const { db, state } = createMockDb([{ clientDomain: "whimet4.atlassian.net" }]);

    const result = await getAtlassianInstanceClientDomain(
      db as never,
      "866c3a03-ec62-4717-91c4-1ad078bfcc60",
    );

    expect(result).toBe("whimet4.atlassian.net");
    expect(state.calls[0].sql).toContain("AtlassianInstance");
    expect(state.calls[0].params).toEqual(["866c3a03-ec62-4717-91c4-1ad078bfcc60"]);
  });

  it("getAtlassianInstanceClientDomain returns null when cloudId is missing", async () => {
    const { db } = createMockDb();

    const result = await getAtlassianInstanceClientDomain(db as never, undefined);

    expect(result).toBeNull();
  });

  it("getAtlassianInstanceClientDomain returns null when no row exists", async () => {
    const { db } = createMockDb([undefined]);

    const result = await getAtlassianInstanceClientDomain(
      db as never,
      "866c3a03-ec62-4717-91c4-1ad078bfcc60",
    );

    expect(result).toBeNull();
  });

  it("upsertAtlassianInstance writes cloudId and clientDomain with ON CONFLICT", async () => {
    const { db, state } = createMockDb([], [{ success: true }]);

    await upsertAtlassianInstance(
      db as never,
      "866c3a03-ec62-4717-91c4-1ad078bfcc60",
      "whimet4.atlassian.net",
    );

    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].sql).toContain("AtlassianInstance");
    expect(state.calls[0].sql).toContain("ON CONFLICT(cloudId) DO UPDATE");
    expect(state.calls[0].params).toEqual([
      "866c3a03-ec62-4717-91c4-1ad078bfcc60",
      "whimet4.atlassian.net",
    ]);
  });

  it("upsertAtlassianInstance skips write when clientDomain is null", async () => {
    const { db, state } = createMockDb();

    await upsertAtlassianInstance(db as never, "some-cloud-id", null);

    expect(state.calls).toHaveLength(0);
  });

  it("upsertAtlassianInstance skips write when cloudId is empty", async () => {
    const { db, state } = createMockDb();

    await upsertAtlassianInstance(db as never, "", "some-domain");

    expect(state.calls).toHaveLength(0);
  });
});
