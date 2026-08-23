import { describe, it, expect, beforeEach } from "vitest";
import {
  maybeGateViewerRender,
  awaitGateBlocking,
  getGateTelemetry,
  getGateMode,
  GATE_MODE_KEY,
  _resetForTesting,
} from "./maybeGateViewerRender";

beforeEach(() => {
  _resetForTesting();
  document.getElementById("viewport-gate-placeholder")?.remove();
});

describe("maybeGateViewerRender", () => {
  // The gate used to be skipped whenever `viewport-gated-render` evaluated
  // false, which was every app except Lite (the flag was never created there,
  // and checkFlag defaults to false). With the switch gone it always runs.
  it("always engages the viewport turn and records telemetry", async () => {
    let turnCalled = false;
    await maybeGateViewerRender({
      awaitTurn: async () => {
        turnCalled = true;
        return { outcome: "immediate", deferredMs: 0, visibleAtBoot: true };
      },
    });
    expect(turnCalled).toBe(true);
    expect(getGateTelemetry().render_gate).toBe("immediate");
    expect(getGateTelemetry().visible_at_boot).toBe(true);
  });

  it("awaits the viewport turn and records outcome telemetry when the flag is on", async () => {
    await maybeGateViewerRender({
      awaitTurn: async () => ({
        outcome: "background",
        deferredMs: 4321,
        visibleAtBoot: false,
      }),
    });
    // render_deferred_ms is deliberately NOT set here: the gate runs
    // concurrently with the content fetch, so gate age is not blocking time.
    // Blocking is measured at the mount-site await (awaitGateBlocking).
    expect(getGateTelemetry()).toEqual({
      render_gate: "background",
      gate_mode: "load",
      visible_at_boot: false,
    });
  });

  it("omits visible_at_boot when the turn did not measure it", async () => {
    await maybeGateViewerRender({
      awaitTurn: async () => ({ outcome: "failopen", deferredMs: 0 }),
    });
    expect(getGateTelemetry()).toEqual({
      render_gate: "failopen",
      gate_mode: "load",
    });
  });

  it("shows a real placeholder inside the iframe while the gate holds, and removes it on release (#384 review F2)", async () => {
    let release: () => void = () => {};
    const turn = new Promise<{ outcome: "background"; deferredMs: number }>((r) => {
      release = () => r({ outcome: "background", deferredMs: 5 });
    });
    const p = maybeGateViewerRender({
      awaitTurn: () => turn,
    });
    await new Promise((r) => setTimeout(r, 0)); // let the flag check resolve
    expect(document.getElementById("viewport-gate-placeholder")).not.toBeNull();
    release();
    await p;
    expect(document.getElementById("viewport-gate-placeholder")).toBeNull();
  });

  it("leaves no placeholder behind once the turn resolves", async () => {
    await maybeGateViewerRender({
      awaitTurn: async () => ({ outcome: "immediate", deferredMs: 0 }),
    });
    expect(document.getElementById("viewport-gate-placeholder")).toBeNull();
  });

  it("records failopen when the turn itself rejects", async () => {
    await maybeGateViewerRender({
      awaitTurn: async () => {
        throw new Error("observer exploded");
      },
    });
    expect(getGateTelemetry()).toEqual({ render_gate: "failopen", gate_mode: "load" });
  });
});

describe("awaitGateBlocking (#384 review F3 — blocking measured at the mount site)", () => {
  it("resolves immediately and records nothing for a null gate", async () => {
    await awaitGateBlocking(null);
    expect(getGateTelemetry()).toEqual({});
  });

  it("records ~0 blocking when the gate already resolved before the mount was ready", async () => {
    await maybeGateViewerRender({
      awaitTurn: async () => ({ outcome: "background", deferredMs: 4000 }),
    });
    await awaitGateBlocking(Promise.resolve());
    expect(getGateTelemetry().render_deferred_ms).toBeLessThan(20);
  });

  it("records the actual wall time the mount waited on the gate", async () => {
    await maybeGateViewerRender({
      awaitTurn: async () => ({ outcome: "immediate", deferredMs: 1 }),
    });
    await awaitGateBlocking(new Promise((r) => setTimeout(r, 60)));
    const t = getGateTelemetry();
    expect(t.render_deferred_ms).toBeGreaterThanOrEqual(40);
    expect(t.render_deferred_ms).toBeLessThan(2000);
  });

  it("keeps the first measurement when awaited at a second mount site", async () => {
    await maybeGateViewerRender({
      awaitTurn: async () => ({ outcome: "immediate", deferredMs: 1 }),
    });
    await awaitGateBlocking(new Promise((r) => setTimeout(r, 50)));
    const first = getGateTelemetry().render_deferred_ms;
    await awaitGateBlocking(new Promise((r) => setTimeout(r, 120)));
    expect(getGateTelemetry().render_deferred_ms).toBe(first);
  });

  it("records no blocking telemetry when the gate was never invoked", async () => {
    // awaitGateBlocking is called on mount paths that never started a gate
    // (null gate promise); it must stay a no-op rather than inventing a wait.
    await awaitGateBlocking(null);
    expect(getGateTelemetry()).toEqual({});
  });
});

describe("getGateMode (#382 load-gate spike toggle)", () => {
  beforeEach(() => localStorage.removeItem(GATE_MODE_KEY));

  it("defaults to 'load' with no key, and on garbage values", () => {
    expect(getGateMode()).toBe("load");
    localStorage.setItem(GATE_MODE_KEY, "yolo");
    expect(getGateMode()).toBe("load");
  });

  it("returns 'render' only for the exact diagnostic-override literal", () => {
    localStorage.setItem(GATE_MODE_KEY, "render");
    expect(getGateMode()).toBe("render");
  });

  it("fails safe to 'load' when storage throws", () => {
    expect(
      getGateMode({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe("load");
  });

  it("stamps gate_mode='render' on gated telemetry when the diagnostic override is set", async () => {
    localStorage.setItem(GATE_MODE_KEY, "render");
    await maybeGateViewerRender({
      awaitTurn: async () => ({ outcome: "background", deferredMs: 10, visibleAtBoot: false }),
    });
    expect(getGateTelemetry()).toEqual({
      render_gate: "background",
      gate_mode: "render",
      visible_at_boot: false,
    });
    localStorage.removeItem(GATE_MODE_KEY);
  });
});
