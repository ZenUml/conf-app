import EventBus from '@/EventBus';
import type { MacroTypeValue } from '@/utils/analytics/catalog';

const READY_EVENT = 'viewerContentReady';
interface Receipt { element: HTMLElement; macroType: MacroTypeValue }

/** Call only after a renderer successfully applied non-empty content. No telemetry here. */
export function reportDiagramReady(element: HTMLElement | undefined | null, macroType: MacroTypeValue): void {
  if (element instanceof HTMLElement) EventBus.$emit(READY_EVENT, { element, macroType });
}

/** A render receipt plus visible, connected content; never a click or timeout fallback. */
export function onVisibleDiagramReady(
  root: () => HTMLElement | null,
  callback: (macroType: MacroTypeValue) => void,
): () => void {
  let receipt: Receipt | null = null;
  let stopped = false;
  let complete = false;
  let observer: IntersectionObserver | undefined;
  function check() {
    if (stopped || complete || !receipt || document.visibilityState === 'hidden') return;
    const { element, macroType } = receipt;
    if (!element.isConnected || !root()?.contains(element)) return;
    const r = element.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.bottom <= 0 || r.right <= 0
      || r.top >= window.innerHeight || r.left >= window.innerWidth) return;
    complete = true;
    observer?.disconnect();
    callback(macroType);
  }
  function scheduleCheck() { requestAnimationFrame(() => requestAnimationFrame(check)); }
  function receive(value: Receipt) {
    if (stopped || complete || !root()?.contains(value.element)) return;
    receipt = value;
    observer?.disconnect();
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(scheduleCheck);
      observer.observe(value.element);
    }
    scheduleCheck();
  }
  EventBus.$on(READY_EVENT, receive);
  document.addEventListener('visibilitychange', scheduleCheck);
  window.addEventListener('resize', scheduleCheck);
  return () => {
    stopped = true; observer?.disconnect();
    EventBus.$off(READY_EVENT, receive);
    document.removeEventListener('visibilitychange', scheduleCheck);
    window.removeEventListener('resize', scheduleCheck);
  };
}
