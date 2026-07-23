import { describe, it, expect, vi } from "vitest";
import { getViewportGateFlagFast, FLAG_CACHE_KEY } from "./flags";

function fakeStorage(initial?: string) {
  const store = new Map<string, string>();
  if (initial !== undefined) store.set(FLAG_CACHE_KEY, initial);
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    dump: () => store.get(FLAG_CACHE_KEY),
  };
}

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

describe("getViewportGateFlagFast", () => {
  it("returns false synchronously with no cache and primes the cache in the background", async () => {
    const storage = fakeStorage();
    const fetchFlag = vi.fn(async () => true);
    const on = getViewportGateFlagFast({ fetchFlag, storage, now: () => 1000 });
    expect(on).toBe(false); // never blocks the render path on the bridge
    await flushMicrotasks();
    expect(fetchFlag).toHaveBeenCalledOnce();
    expect(JSON.parse(storage.dump()!)).toEqual({ on: true, at: 1000 });
  });

  it("returns the cached value without fetching while the cache is fresh", async () => {
    const storage = fakeStorage(JSON.stringify({ on: true, at: 1000 }));
    const fetchFlag = vi.fn(async () => false);
    const on = getViewportGateFlagFast({ fetchFlag, storage, now: () => 1000 + 60_000 });
    expect(on).toBe(true);
    await flushMicrotasks();
    expect(fetchFlag).not.toHaveBeenCalled();
  });

  it("returns the stale cached value but refreshes in the background", async () => {
    const storage = fakeStorage(JSON.stringify({ on: true, at: 0 }));
    const fetchFlag = vi.fn(async () => false);
    const on = getViewportGateFlagFast({
      fetchFlag,
      storage,
      now: () => 100 * 60_000, // well past the TTL
    });
    expect(on).toBe(true); // stale value still used this render
    await flushMicrotasks();
    expect(fetchFlag).toHaveBeenCalledOnce();
    expect(JSON.parse(storage.dump()!).on).toBe(false); // next render sees fresh value
  });

  it("treats corrupt cache JSON as no cache", () => {
    const storage = fakeStorage("not-json{");
    const on = getViewportGateFlagFast({ fetchFlag: async () => true, storage, now: () => 0 });
    expect(on).toBe(false);
  });

  it("never throws when storage or the fetcher fail", async () => {
    const on = getViewportGateFlagFast({
      fetchFlag: async () => {
        throw new Error("bridge down");
      },
      storage: {
        getItem: () => {
          throw new Error("storage denied");
        },
        setItem: () => {
          throw new Error("storage denied");
        },
      },
      now: () => 0,
    });
    expect(on).toBe(false);
    await flushMicrotasks(); // background refresh failure must stay silent
  });
});
