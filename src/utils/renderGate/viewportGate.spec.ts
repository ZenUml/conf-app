// Unit tests for the #382 viewport render gate. All browser dependencies
// (IntersectionObserver, timers, clock) are injected so the release
// semantics are tested directly, without a DOM or real time.
import { describe, it, expect, beforeEach } from "vitest";
import {
  awaitViewportTurn,
  hashJitter,
  type GateDeps,
} from "./viewportGate";

type IOCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

class FakeIO {
  static instances: FakeIO[] = [];
  callback: IOCallback;
  options: IntersectionObserverInit | undefined;
  observed: Element[] = [];
  disconnected = false;
  queued: Array<{ isIntersecting: boolean }> = [];
  constructor(cb: IOCallback, options?: IntersectionObserverInit) {
    this.callback = cb;
    this.options = options;
    FakeIO.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
  fire(isIntersecting: boolean) {
    this.callback([{ isIntersecting }]);
  }
  // Pending entries not yet delivered to the callback (real IO semantics).
  queue(isIntersecting: boolean) {
    this.queued.push({ isIntersecting });
  }
  takeRecords() {
    const q = this.queued;
    this.queued = [];
    return q;
  }
}

// The strict observer measures visible_at_boot (no rootMargin); the trigger
// observer releases the render (has a rootMargin).
function strictIO(): FakeIO {
  const io = FakeIO.instances.find((i) => !i.options?.rootMargin);
  if (!io) throw new Error("strict observer not created");
  return io;
}
function triggerIO(): FakeIO {
  const io = FakeIO.instances.find((i) => !!i.options?.rootMargin);
  if (!io) throw new Error("trigger observer not created");
  return io;
}

interface ScheduledTimer {
  cb: () => void;
  ms: number;
  cleared: boolean;
}

function makeDeps(overrides?: Partial<GateDeps>) {
  const timers: ScheduledTimer[] = [];
  let clock = 0;
  const deps: GateDeps = {
    target: {} as Element,
    jitterKey: "local-id-1",
    IntersectionObserverCtor: FakeIO as unknown as typeof IntersectionObserver,
    now: () => clock,
    setTimeoutFn: (cb: () => void, ms: number) => {
      const t: ScheduledTimer = { cb, ms, cleared: false };
      timers.push(t);
      return timers.length - 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeoutFn: (id: unknown) => {
      const t = timers[id as number];
      if (t) t.cleared = true;
    },
    ...overrides,
  };
  return { deps, timers, tick: (ms: number) => (clock += ms) };
}

beforeEach(() => {
  FakeIO.instances = [];
});

describe("hashJitter", () => {
  it("is deterministic and bounded by spread", () => {
    const a = hashJitter("local-id-1", 4000);
    expect(hashJitter("local-id-1", 4000)).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(4000);
  });

  it("spreads different keys to different delays", () => {
    expect(hashJitter("local-id-1", 4000)).not.toBe(
      hashJitter("local-id-2", 4000),
    );
  });
});

describe("awaitViewportTurn", () => {
  it("fails open immediately when IntersectionObserver is unavailable", async () => {
    const { deps } = makeDeps({ IntersectionObserverCtor: undefined });
    const turn = await awaitViewportTurn(deps);
    expect(turn.outcome).toBe("failopen");
    expect(turn.deferredMs).toBe(0);
    expect(turn.visibleAtBoot).toBeUndefined();
  });

  it("releases as 'immediate' when the first trigger callback intersects", async () => {
    const { deps, timers } = makeDeps();
    const p = awaitViewportTurn(deps);
    strictIO().fire(true);
    triggerIO().fire(true);
    const turn = await p;
    expect(turn.outcome).toBe("immediate");
    expect(turn.visibleAtBoot).toBe(true);
    expect(strictIO().disconnected).toBe(true);
    expect(triggerIO().disconnected).toBe(true);
    expect(timers.every((t) => t.cleared)).toBe(true);
  });

  it("records visible_at_boot=false for a near-viewport (margin-only) release", async () => {
    const { deps } = makeDeps();
    const p = awaitViewportTurn(deps);
    strictIO().fire(false); // offscreen strictly...
    triggerIO().fire(true); // ...but inside the prefetch margin
    const turn = await p;
    expect(turn.outcome).toBe("immediate");
    expect(turn.visibleAtBoot).toBe(false);
  });

  it("releases as 'scrolled_in' when intersection arrives after the first callback", async () => {
    const { deps, tick } = makeDeps();
    const p = awaitViewportTurn(deps);
    strictIO().fire(false);
    triggerIO().fire(false); // initial callback: offscreen
    tick(1200);
    triggerIO().fire(true); // user scrolled it into the margin
    const turn = await p;
    expect(turn.outcome).toBe("scrolled_in");
    expect(turn.visibleAtBoot).toBe(false);
    expect(turn.deferredMs).toBe(1200);
  });

  it("releases as 'background' from the jittered fill timer when never visible", async () => {
    const { deps, timers, tick } = makeDeps({
      backgroundBaseMs: 3000,
      backgroundSpreadMs: 4000,
      jitterKey: "local-id-1",
    });
    const p = awaitViewportTurn(deps);
    strictIO().fire(false);
    triggerIO().fire(false);
    const expectedDelay = 3000 + hashJitter("local-id-1", 4000);
    const fill = timers.find((t) => t.ms === expectedDelay);
    expect(fill).toBeDefined();
    tick(fill!.ms);
    fill!.cb();
    const turn = await p;
    expect(turn.outcome).toBe("background");
    expect(turn.deferredMs).toBe(expectedDelay);
    expect(triggerIO().disconnected).toBe(true);
  });

  it("resolves only once: a late intersection after the background fill is a no-op", async () => {
    const { deps, timers } = makeDeps();
    const p = awaitViewportTurn(deps);
    strictIO().fire(false);
    triggerIO().fire(false);
    timers.find((t) => !t.cleared)!.cb();
    const turn = await p;
    expect(turn.outcome).toBe("background");
    triggerIO().fire(true); // must not throw or change anything
  });

  it("recovers visible_at_boot via takeRecords when the trigger settles before the strict callback (#384 review F5)", async () => {
    const { deps } = makeDeps();
    const p = awaitViewportTurn(deps);
    strictIO().queue(true); // strict entry generated but callback not yet delivered
    triggerIO().fire(true); // trigger settles first
    const turn = await p;
    expect(turn.outcome).toBe("immediate");
    expect(turn.visibleAtBoot).toBe(true);
  });

  it("fails open when the observer constructor throws", async () => {
    const Throwing = function () {
      throw new Error("boom");
    } as unknown as typeof IntersectionObserver;
    const { deps } = makeDeps({ IntersectionObserverCtor: Throwing });
    const turn = await awaitViewportTurn(deps);
    expect(turn.outcome).toBe("failopen");
  });
});
