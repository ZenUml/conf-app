// Orchestrator for the #382 viewport render gate: flag check → viewport
// turn → telemetry recording. forgeIndex awaits this promise at the viewer
// mount points via awaitGateBlocking; trackRenderTime merges
// getGateTelemetry() into macro_viewed.
//
// Invariant: this function NEVER rejects and never blocks a render on an
// error — every failure path resolves promptly (fail-open).

import type { RenderGateOutcome } from "@/utils/analytics/catalog";
import forgeGlobal from "@/model/globals/forgeGlobal";
import { awaitViewportTurn, type ViewportTurn } from "./viewportGate";
import { getViewportGateFlagFast } from "./flags";

export interface GateTelemetry {
  render_gate?: RenderGateOutcome;
  // Wall time the mount ACTUALLY waited on the gate, measured at the
  // mount-site await (awaitGateBlocking) — NOT the gate's age. The gate runs
  // concurrently with the content fetch, so gate age would overstate the
  // delay whenever the fetch was the slower leg (#384 review F3).
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

const PLACEHOLDER_ID = "viewport-gate-placeholder";

// index.html ships NO skeleton element (the #skeleton-loader lookups in this
// codebase are historical no-ops), so a deferred iframe would otherwise sit
// blank. This shimmer both gives the user a loading affordance and gives the
// iframe real height (iframeResizer reports body size), which also makes the
// top-level viewport intersection meaningful (#384 review F2).
function showPlaceholder(): void {
  try {
    if (typeof document === "undefined" || !document.body) return;
    if (document.getElementById(PLACEHOLDER_ID)) return;
    const el = document.createElement("div");
    el.id = PLACEHOLDER_ID;
    el.setAttribute(
      "style",
      "height:160px;margin:8px 0;border-radius:6px;" +
        "background:linear-gradient(90deg,#f0f1f3 25%,#e4e6ea 37%,#f0f1f3 63%);" +
        "background-size:400% 100%;animation:vgp-shimmer 1.4s ease infinite;",
    );
    const style = document.createElement("style");
    style.textContent =
      "@keyframes vgp-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}";
    el.appendChild(style);
    document.body.appendChild(el);
  } catch {
    // placeholder is best-effort
  }
}

function removePlaceholder(): void {
  try {
    document.getElementById(PLACEHOLDER_ID)?.remove();
  } catch {
    // placeholder is best-effort
  }
}

// Flag-evaluation identity. The Custom UI iframe origin is shared across all
// tenants of this app, so the cached verdict must be scoped (#384 review F1).
function flagScope(): string {
  const ctx = forgeGlobal.forgeContext as
    | { cloudId?: string; accountId?: string; environmentType?: string }
    | undefined;
  return `${ctx?.cloudId ?? "?"}|${ctx?.accountId ?? "?"}|${ctx?.environmentType ?? "?"}`;
}

export async function maybeGateViewerRender(deps?: {
  getFlag?: () => Promise<boolean>;
  awaitTurn?: () => Promise<ViewportTurn>;
}): Promise<void> {
  try {
    // Default flag read is the SYNCHRONOUS cached verdict (flagCache) so a
    // flag-off render never waits on the bridge FeatureFlags round-trip.
    const enabled = await (deps?.getFlag ??
      (async () => getViewportGateFlagFast({ scope: flagScope() })))();
    if (!enabled) return;
  } catch {
    return; // flag layer is fail-closed; a throw here means gate off
  }
  try {
    showPlaceholder();
    const turn = await (deps?.awaitTurn ??
      (() =>
        awaitViewportTurn({
          jitterKey: forgeGlobal.forgeContext?.localId ?? "",
        })))();
    telemetry = {
      render_gate: turn.outcome,
      ...(turn.visibleAtBoot !== undefined
        ? { visible_at_boot: turn.visibleAtBoot }
        : {}),
    };
  } catch {
    telemetry = { render_gate: "failopen" };
  } finally {
    removePlaceholder();
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

/**
 * Await the gate AT A MOUNT SITE and record how long the mount actually
 * waited (first mount site wins). This is the number analysts may subtract
 * from duration_ms; the gate's own age is not recorded anywhere.
 */
export async function awaitGateBlocking(gate: Promise<void> | null): Promise<void> {
  if (!gate) return;
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  await gate;
  if (!telemetry.render_gate) return; // gate never engaged (flag off)
  if (telemetry.render_deferred_ms !== undefined) return;
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  telemetry.render_deferred_ms = Math.max(0, Math.round(t1 - t0));
  try {
    (window as unknown as Record<string, { render_deferred_ms?: number }>).__viewportGateTurn = {
      ...((window as unknown as Record<string, object>).__viewportGateTurn ?? {}),
      render_deferred_ms: telemetry.render_deferred_ms,
    };
  } catch {
    // debug hook is best-effort
  }
}
