// Orchestrator for the #382 viewport render gate: flag check → viewport
// turn → telemetry recording. forgeIndex awaits this promise at the viewer
// mount points; trackRenderTime merges getGateTelemetry() into macro_viewed.
//
// Invariant: this function NEVER rejects and never blocks a render on an
// error — every failure path resolves promptly (fail-open).

import type { RenderGateOutcome } from "@/utils/analytics/catalog";
import forgeGlobal from "@/model/globals/forgeGlobal";
import { awaitViewportTurn, type ViewportTurn } from "./viewportGate";
import { getViewportGateFlagFast } from "./flags";

export interface GateTelemetry {
  render_gate?: RenderGateOutcome;
  render_deferred_ms?: number;
  visible_at_boot?: boolean;
}

let telemetry: GateTelemetry = {};

/** Merged into macro_viewed by trackRenderTime. {} when the gate never ran. */
export function getGateTelemetry(): GateTelemetry {
  return telemetry;
}

export function _resetForTesting(): void {
  telemetry = {};
}

export async function maybeGateViewerRender(deps?: {
  getFlag?: () => Promise<boolean>;
  awaitTurn?: () => Promise<ViewportTurn>;
}): Promise<void> {
  try {
    // Default flag read is the SYNCHRONOUS cached verdict (flagCache) so a
    // flag-off render never waits on the bridge FeatureFlags round-trip.
    const enabled = await (deps?.getFlag ?? (async () => getViewportGateFlagFast()))();
    if (!enabled) return;
  } catch {
    return; // flag layer is fail-closed; a throw here means gate off
  }
  try {
    const turn = await (deps?.awaitTurn ??
      (() =>
        awaitViewportTurn({
          jitterKey: forgeGlobal.forgeContext?.localId ?? "",
        })))();
    telemetry = {
      render_gate: turn.outcome,
      render_deferred_ms: turn.deferredMs,
      ...(turn.visibleAtBoot !== undefined
        ? { visible_at_boot: turn.visibleAtBoot }
        : {}),
    };
  } catch {
    telemetry = { render_gate: "failopen" };
  }
  try {
    // Spot-check hook (#382 dev verification): per-iframe gate outcome,
    // readable via Playwright frame.evaluate. Harmless in prod.
    (window as unknown as Record<string, unknown>).__viewportGateTurn = {
      ...telemetry,
      bodyH: document.body?.clientHeight,
      bodyW: document.body?.clientWidth,
    };
  } catch {
    // debug hook is best-effort
  }
}
