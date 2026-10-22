import { onScopeDispose, ref, watch, type Ref } from 'vue'
import { ACTIVITY_LINGER_MS } from './useAgentLinkSession'

/**
 * A `Date.now()` ref that refreshes every `intervalMs` while `active()` is true.
 * Stops on false and on scope/component dispose. Each (re)start refreshes the
 * value immediately. `restartOn` re-runs the start when its value changes while
 * active (e.g. a bumped `expiresAt`), as the per-component watchers did.
 */
export function useTickingNow(
  active: () => boolean,
  intervalMs = 1000,
  restartOn?: () => unknown
): Readonly<Ref<number>> {
  const nowMs = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | null = null

  function stop() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
  function start() {
    stop()
    nowMs.value = Date.now()
    timer = setInterval(() => {
      nowMs.value = Date.now()
    }, intervalMs)
  }

  watch(
    () => [active(), restartOn?.()] as const,
    ([on]) => {
      if (on) start()
      else stop()
    },
    { immediate: true }
  )

  onScopeDispose(stop)
  return nowMs
}

export function isRecentlyActive(nowMs: number, lastActivityAt: number | null | undefined): boolean {
  if (lastActivityAt === null || lastActivityAt === undefined) return false
  return nowMs - lastActivityAt < ACTIVITY_LINGER_MS
}

export function secondsLeft(nowMs: number, expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - nowMs) / 1000))
}
