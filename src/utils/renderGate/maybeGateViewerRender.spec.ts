import { describe, it, expect, beforeEach } from "vitest";
import {
  maybeGateViewerRender,
  getGateTelemetry,
  _resetForTesting,
} from "./maybeGateViewerRender";

beforeEach(() => {
  _resetForTesting();
});

describe("maybeGateViewerRender", () => {
  it("does nothing when the flag is off: no telemetry, resolves at once", async () => {
    let turnCalled = false;
    await maybeGateViewerRender({
      getFlag: async () => false,
      awaitTurn: async () => {
        turnCalled = true;
        return { outcome: "immediate", deferredMs: 0, visibleAtBoot: true };
      },
    });
    expect(turnCalled).toBe(false);
    expect(getGateTelemetry()).toEqual({});
  });

  it("awaits the viewport turn and records telemetry when the flag is on", async () => {
    await maybeGateViewerRender({
      getFlag: async () => true,
      awaitTurn: async () => ({
        outcome: "background",
        deferredMs: 4321,
        visibleAtBoot: false,
      }),
    });
    expect(getGateTelemetry()).toEqual({
      render_gate: "background",
      render_deferred_ms: 4321,
      visible_at_boot: false,
    });
  });

  it("omits visible_at_boot when the turn did not measure it", async () => {
    await maybeGateViewerRender({
      getFlag: async () => true,
      awaitTurn: async () => ({ outcome: "failopen", deferredMs: 0 }),
    });
    expect(getGateTelemetry()).toEqual({
      render_gate: "failopen",
      render_deferred_ms: 0,
    });
  });

  it("never blocks the render when the flag getter throws", async () => {
    await maybeGateViewerRender({
      getFlag: async () => {
        throw new Error("bridge exploded");
      },
      awaitTurn: async () => ({ outcome: "immediate", deferredMs: 0 }),
    });
    expect(getGateTelemetry()).toEqual({});
  });

  it("records failopen when the turn itself rejects", async () => {
    await maybeGateViewerRender({
      getFlag: async () => true,
      awaitTurn: async () => {
        throw new Error("observer exploded");
      },
    });
    expect(getGateTelemetry()).toEqual({ render_gate: "failopen" });
  });
});
