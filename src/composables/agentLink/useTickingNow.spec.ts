import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { ACTIVITY_LINGER_MS } from './useAgentLinkSession'
import { isRecentlyActive, secondsLeft, useTickingNow } from './useTickingNow'

const T0 = Date.UTC(2026, 9, 23, 9, 0, 0)

describe('useTickingNow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('ticks every second while active', async () => {
    const active = ref(true)
    const scope = effectScope()
    const now = scope.run(() => useTickingNow(() => active.value))!
    expect(now.value).toBe(T0)

    vi.advanceTimersByTime(1000)
    expect(now.value).toBe(T0 + 1000)
    vi.advanceTimersByTime(2000)
    expect(now.value).toBe(T0 + 3000)
    scope.stop()
  })

  it('does not tick while inactive', async () => {
    const scope = effectScope()
    const now = scope.run(() => useTickingNow(() => false))!
    vi.advanceTimersByTime(5000)
    expect(now.value).toBe(T0)
    expect(vi.getTimerCount()).toBe(0)
    scope.stop()
  })

  it('stops when active turns false', async () => {
    const active = ref(true)
    const scope = effectScope()
    const now = scope.run(() => useTickingNow(() => active.value))!
    vi.advanceTimersByTime(1000)

    active.value = false
    await nextTick()
    expect(vi.getTimerCount()).toBe(0)
    const frozen = now.value
    vi.advanceTimersByTime(5000)
    expect(now.value).toBe(frozen)
    scope.stop()
  })

  it('restarts and refreshes now when active turns true again', async () => {
    const active = ref(false)
    const scope = effectScope()
    const now = scope.run(() => useTickingNow(() => active.value))!
    vi.advanceTimersByTime(5000)

    active.value = true
    await nextTick()
    expect(now.value).toBe(T0 + 5000)
    vi.advanceTimersByTime(1000)
    expect(now.value).toBe(T0 + 6000)
    expect(vi.getTimerCount()).toBe(1)
    scope.stop()
  })

  it('clears the interval when the scope is disposed', async () => {
    const scope = effectScope()
    scope.run(() => useTickingNow(() => true))
    expect(vi.getTimerCount()).toBe(1)
    scope.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never runs two intervals for one composable', async () => {
    const active = ref(true)
    const scope = effectScope()
    scope.run(() => useTickingNow(() => active.value))
    active.value = false
    await nextTick()
    active.value = true
    await nextTick()
    expect(vi.getTimerCount()).toBe(1)
    scope.stop()
  })

  it('restarts the clock when the restartOn value changes while active', async () => {
    const expiresAt = ref(1)
    const scope = effectScope()
    const now = scope.run(() => useTickingNow(() => true, 1000, () => expiresAt.value))!
    vi.advanceTimersByTime(500)
    expect(now.value).toBe(T0)

    expiresAt.value = 2
    await nextTick()
    expect(now.value).toBe(T0 + 500)
    expect(vi.getTimerCount()).toBe(1)
    scope.stop()
  })
})

describe('isRecentlyActive', () => {
  const now = T0

  it('is true inside the linger window', () => {
    expect(isRecentlyActive(now, now - ACTIVITY_LINGER_MS + 1)).toBe(true)
  })

  it('is false at exactly ACTIVITY_LINGER_MS (strict <)', () => {
    expect(isRecentlyActive(now, now - ACTIVITY_LINGER_MS)).toBe(false)
  })

  it('is false when null or undefined', () => {
    expect(isRecentlyActive(now, null)).toBe(false)
    expect(isRecentlyActive(now, undefined)).toBe(false)
  })
})

describe('secondsLeft', () => {
  const now = T0

  it('is 0 when expiresAt is in the past', () => {
    expect(secondsLeft(now, now - 5000)).toBe(0)
  })

  it('is 0 at exactly expiresAt', () => {
    expect(secondsLeft(now, now)).toBe(0)
  })

  it('rounds partial seconds up', () => {
    expect(secondsLeft(now, now + 1)).toBe(1)
    expect(secondsLeft(now, now + 1000)).toBe(1)
    expect(secondsLeft(now, now + 1001)).toBe(2)
    expect(secondsLeft(now, now + 59_500)).toBe(60)
  })
})
