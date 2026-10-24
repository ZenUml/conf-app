// Viewport render gate (#382): defer a viewer render until the macro's
// iframe is in (or near) the top-level viewport, so a many-macro page does
// not co-start every renderer at once and serialize them all on the shared
// renderer main thread.
//
// Zero cross-macro communication by design (decision 2026-07-24): each
// iframe self-decides using IntersectionObserver's implicit root, which
// reports intersection with the TOP-LEVEL viewport even from a cross-origin
// iframe (the ad-viewability use case the API was built for). Offscreen
// macros are eventually released by a deterministically jittered
// background-fill timer — never a second thundering herd, and consumers
// with no scrolling user (PNG snapshot backfill, export) still get a render.
//
// Fail-open is absolute: any error, and the render proceeds immediately.

import type { RenderGateOutcome } from "@/utils/analytics/catalog";

export interface ViewportTurn {
  outcome: RenderGateOutcome;
  deferredMs: number;
  // Strict (no-margin) top-level-viewport intersection at first observation.
  // Undefined when the gate failed open before observing.
  visibleAtBoot?: boolean;
}

export interface GateDeps {
  target?: Element;
  // Deterministic jitter key — the macro's localId. Same macro, same delay.
  jitterKey?: string;
  // How far ahead of the viewport a render is released early ("prefetch").
  prefetchMargin?: string;
  backgroundBaseMs?: number;
  backgroundSpreadMs?: number;
  IntersectionObserverCtor?: typeof IntersectionObserver;
  now?: () => number;
  setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (id: ReturnType<typeof setTimeout>) => void;
}

// djb2 over the key, folded into [0, spread). Deterministic so a given macro
// always fills at the same offset (stable analytics, no render-order churn).
export function hashJitter(key: string, spread: number): number {
  if (spread <= 0) return 0;
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = (h * 33) ^ key.charCodeAt(i);
  }
  return Math.abs(h) % spread;
}

export function awaitViewportTurn(deps: GateDeps = {}): Promise<ViewportTurn> {
  const {
    target = typeof document !== "undefined" ? document.body : undefined,
    jitterKey = "",
    prefetchMargin = "100% 0px 100% 0px",
    backgroundBaseMs = 3000,
    backgroundSpreadMs = 4000,
    now = () => performance.now(),
    setTimeoutFn = (cb, ms) => setTimeout(cb, ms),
    clearTimeoutFn = (id) => clearTimeout(id),
  } = deps;
  // Distinguish "caller explicitly says IO is unavailable" (key present,
  // value undefined → fail open) from "caller didn't inject" (use ambient).
  const IntersectionObserverCtor =
    "IntersectionObserverCtor" in deps
      ? deps.IntersectionObserverCtor
      : typeof IntersectionObserver !== "undefined"
        ? IntersectionObserver
        : undefined;

  return new Promise<ViewportTurn>((resolve) => {
    let visibleAtBoot: boolean | undefined;

    if (!IntersectionObserverCtor || !target) {
      resolve({ outcome: "failopen", deferredMs: 0 });
      return;
    }

    const t0 = now();
    let settled = false;
    let strict: IntersectionObserver | undefined;
    let trigger: IntersectionObserver | undefined;
    let fillTimer: ReturnType<typeof setTimeout> | undefined;

    const settle = (outcome: RenderGateOutcome) => {
      if (settled) return;
      settled = true;
      try {
        // IO callback order between the two observers is unspecified: the
        // trigger can settle before the strict observer's first delivery.
        // Drain its queued entries so visible_at_boot survives that order
        // (#384 review F5).
        if (visibleAtBoot === undefined && strict?.takeRecords) {
          const pending = strict.takeRecords();
          if (pending.length > 0) {
            visibleAtBoot = pending.some((e) => e.isIntersecting);
          }
        }
        strict?.disconnect();
        trigger?.disconnect();
        if (fillTimer !== undefined) clearTimeoutFn(fillTimer);
      } catch {
        // cleanup is best-effort
      }
      resolve({
        outcome,
        deferredMs: Math.max(0, Math.round(now() - t0)),
        ...(visibleAtBoot !== undefined ? { visibleAtBoot } : {}),
      });
    };

    try {
      // Measurement-only observer: strict viewport intersection at boot.
      strict = new IntersectionObserverCtor((entries) => {
        if (visibleAtBoot === undefined) {
          visibleAtBoot = entries.some((e) => e.isIntersecting);
        }
        strict?.disconnect();
      });

      // Release observer: viewport plus the prefetch margin. Its very first
      // callback classifies 'immediate'; any later intersection is a scroll.
      let firstTriggerCallbackSeen = false;
      trigger = new IntersectionObserverCtor(
        (entries) => {
          const intersecting = entries.some((e) => e.isIntersecting);
          const isFirst = !firstTriggerCallbackSeen;
          firstTriggerCallbackSeen = true;
          if (intersecting) settle(isFirst ? "immediate" : "scrolled_in");
        },
        { rootMargin: prefetchMargin },
      );

      strict.observe(target);
      trigger.observe(target);

      fillTimer = setTimeoutFn(
        () => settle("background"),
        backgroundBaseMs + hashJitter(jitterKey, backgroundSpreadMs),
      );
    } catch {
      settle("failopen");
    }
  });
}
