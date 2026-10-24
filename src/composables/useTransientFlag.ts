import { getCurrentScope, onScopeDispose, ref, type Ref } from 'vue';

export const TRANSIENT_HOLD_MS = 2500;
export const TRANSIENT_FADE_MS = 300;

export interface TransientFlag {
  /** True from `trigger()` until the fade has finished. */
  active: Ref<boolean>;
  /** True during the closing fade; the consumer fades the "done" label out while `active` is still true. */
  fading: Ref<boolean>;
  /** Turns the flag on and (re)starts the hold. */
  trigger: () => void;
  /** Turns the flag off at once and cancels pending timers. */
  reset: () => void;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A boolean that turns itself off: "Copied" feedback that holds, fades out, then reverts.
 *
 * `trigger()` sets `active`; after `holdMs` `fading` turns on so the consumer can
 * fade its label out (opacity transition of `fadeMs`); after a further `fadeMs`
 * both turn off. Both phases are timers, never `transitionend`/`animationend`,
 * so a transition that does not run cannot leave the flag stuck. Under
 * `prefers-reduced-motion: reduce` there is no fade phase: the flag resets when
 * the hold ends.
 *
 * Triggering again during the hold or the fade restarts the hold. Timers are
 * cancelled when the owning effect scope (component) is disposed.
 */
export function useTransientFlag(
  { holdMs = TRANSIENT_HOLD_MS, fadeMs = TRANSIENT_FADE_MS }: { holdMs?: number; fadeMs?: number } = {},
): TransientFlag {
  const active = ref(false);
  const fading = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancelTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const reset = () => {
    cancelTimer();
    active.value = false;
    fading.value = false;
  };

  const trigger = () => {
    cancelTimer();
    active.value = true;
    fading.value = false;
    timer = setTimeout(() => {
      if (prefersReducedMotion()) {
        reset();
        return;
      }
      fading.value = true;
      timer = setTimeout(reset, fadeMs);
    }, holdMs);
  };

  if (getCurrentScope()) onScopeDispose(cancelTimer);

  return { active, fading, trigger, reset };
}
