import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLARITY_FLAG,
  CLARITY_PROJECT_ID,
  _resetClarityReplayForTests,
  clarityReplaySurface,
  startClarityReplay,
} from "./clarityReplay";

const editorContext = {
  cloudId: "cloud-1",
  accountId: "acc-1",
  environmentType: "STAGING",
  moduleKey: "zenuml-sequence-macro",
  extension: { modal: { macroMode: "editor" } },
};

function flagClient(on: boolean) {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    checkFlag: vi.fn((name: string) => on && name === CLARITY_FLAG),
    shutdown: vi.fn(),
  };
}

function fakeClarity(sessionId = "sess-1") {
  return {
    start: vi.fn(),
    set: vi.fn(),
    identify: vi.fn(),
    metadata: vi.fn((cb: (d: { sessionId?: string }) => void) => cb({ sessionId })),
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

beforeEach(() => _resetClarityReplayForTests());

describe("clarityReplaySurface", () => {
  it.each([
    [{ extension: { modal: { macroMode: "editor" } } }, "editor"],
    [{ extension: { macro: { isConfiguring: true } } }, "editor"],
    [{ extension: { modal: { macroMode: "fullscreen" } } }, "fullscreen"],
    [{ extension: { modal: { macroMode: "feedback" } } }, undefined],
    [{ extension: {} }, undefined],
    [undefined, undefined],
  ])("%j -> %s", (ctx, expected) => {
    expect(clarityReplaySurface(ctx as any)).toBe(expected);
  });
});

describe("startClarityReplay", () => {
  it("starts masked, cookie-less, unidentified recording through the proxy", async () => {
    const clarity = fakeClarity();
    const result = await startClarityReplay({
      getForgeContext: async () => editorContext,
      createFlagClient: async () => flagClient(true),
      fetchGeo: async () => true,
      loadClarity: async () => clarity,
      storage: memoryStorage(),
    });
    expect(result).toEqual({ outcome: "started", sessionId: "sess-1" });
    expect(clarity.start).toHaveBeenCalledWith({
      projectId: CLARITY_PROJECT_ID,
      upload: "https://stats.zenuml.com/clarity/collect",
      track: false,
      content: false,
    });
    expect(clarity.identify).not.toHaveBeenCalled();
    expect(clarity.set).toHaveBeenCalledWith("surface", "editor");
  });

  it("skips an inline viewer without checking the flag", async () => {
    const client = flagClient(true);
    const result = await startClarityReplay({
      getForgeContext: async () => ({ ...editorContext, extension: {} }),
      createFlagClient: async () => client,
    });
    expect(result.outcome).toBe("skipped_surface");
    expect(client.initialize).not.toHaveBeenCalled();
  });

  it("skips when the flag is off and never asks the geo endpoint", async () => {
    const fetchGeo = vi.fn().mockResolvedValue(true);
    const result = await startClarityReplay({
      getForgeContext: async () => editorContext,
      createFlagClient: async () => flagClient(false),
      fetchGeo,
    });
    expect(result.outcome).toBe("skipped_flag");
    expect(fetchGeo).not.toHaveBeenCalled();
  });

  it("skips when flag evaluation throws (fail closed)", async () => {
    const result = await startClarityReplay({
      getForgeContext: async () => editorContext,
      createFlagClient: async () => {
        throw new Error("bridge down");
      },
    });
    expect(result.outcome).toBe("skipped_flag");
  });

  it.each([
    ["refused", async () => false],
    ["unreachable", async () => Promise.reject(new Error("offline"))],
  ])("skips when the geo check is %s and caches the no", async (_label, fetchGeo) => {
    const clarity = fakeClarity();
    const storage = memoryStorage();
    const result = await startClarityReplay({
      getForgeContext: async () => editorContext,
      createFlagClient: async () => flagClient(true),
      fetchGeo,
      loadClarity: async () => clarity,
      storage,
    });
    expect(result.outcome).toBe("skipped_geo");
    expect(clarity.start).not.toHaveBeenCalled();
    expect(storage.data["zenuml.clarityGeoAllow"]).toBe("0");
  });

  it("uses a cached geo answer without a request", async () => {
    const fetchGeo = vi.fn();
    const result = await startClarityReplay({
      getForgeContext: async () => editorContext,
      createFlagClient: async () => flagClient(true),
      fetchGeo,
      loadClarity: async () => fakeClarity(),
      storage: memoryStorage({ "zenuml.clarityGeoAllow": "1" }),
    });
    expect(result.outcome).toBe("started");
    expect(fetchGeo).not.toHaveBeenCalled();
  });

  it("reports failed when the SDK throws", async () => {
    const result = await startClarityReplay({
      getForgeContext: async () => editorContext,
      createFlagClient: async () => flagClient(true),
      fetchGeo: async () => true,
      loadClarity: async () => ({
        ...fakeClarity(),
        start: () => {
          throw new Error("boom");
        },
      }),
      storage: null,
    });
    expect(result.outcome).toBe("failed");
  });

  it("starts at most once per iframe", async () => {
    const clarity = fakeClarity();
    const deps = {
      getForgeContext: async () => editorContext,
      createFlagClient: async () => flagClient(true),
      fetchGeo: async () => true,
      loadClarity: async () => clarity,
      storage: memoryStorage(),
    };
    await Promise.all([startClarityReplay(deps), startClarityReplay(deps)]);
    expect(clarity.start).toHaveBeenCalledTimes(1);
  });
});
