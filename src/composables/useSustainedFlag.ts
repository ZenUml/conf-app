import { getCurrentScope, onScopeDispose, ref, watch, type Ref, type WatchSource } from 'vue';

/**
 * Rising-edge delay for a boolean-ish signal.
 *
 * The returned flag turns `true` only after `source` has stayed truthy for
 * `delayMs` without interruption, and turns `false` the moment `source` goes
 * falsy. A truthy value that merely *changes* (a new error object for the same
 * unresolved problem) does not restart the delay — only a dip through falsy
 * does.
 *
 * The motivating case is the editor's syntax error: it is cleared on every
 * keystroke and restored a second after typing stops, so gating UI directly on
 * it makes that UI blink through a whole authoring session. Gating on the
 * sustained flag instead surfaces the UI only once the author has actually
 * stopped.
 *
 * The pending timer is cancelled when the owning effect scope (component or
 * `effectScope`) is disposed.
 */
export function useSustainedFlag(source: WatchSource<unknown>, delayMs: number): Ref<boolean> {
  const sustained = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancelTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  watch(
    source,
    (value) => {
      if (!value) {
        cancelTimer();
        sustained.value = false;
        return;
      }
      // Already sustained, or already counting towards it: an uninterrupted
      // truthy run must not be restarted by a change of value.
      if (sustained.value || timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        sustained.value = true;
      }, delayMs);
    },
    { immediate: true },
  );

  // Callers outside a component or effectScope own the timer themselves;
  // registering the hook there would only emit a Vue warning.
  if (getCurrentScope()) onScopeDispose(cancelTimer);

  return sustained;
}
