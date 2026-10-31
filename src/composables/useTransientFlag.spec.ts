import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'

import { useTransientFlag } from './useTransientFlag'

const HOLD_MS = 2500
const FADE_MS = 300

describe('useTransientFlag', () => {
  let scopes: EffectScope[] = []

  function inScope<T>(fn: () => T): T {
    const scope = effectScope()
    scopes.push(scope)
    return scope.run(fn) as T
  }

  function mockReducedMotion(reduce: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
    }))
  }

  beforeEach(() => {
    vi.useFakeTimers()
    mockReducedMotion(false)
  })

  afterEach(() => {
    scopes.forEach((scope) => scope.stop())
    scopes = []
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('starts inactive and not fading', () => {
    const flag = inScope(() => useTransientFlag())
    expect(flag.active.value).toBe(false)
    expect(flag.fading.value).toBe(false)
  })

  it('holds for 2.5s, fades for 0.3s, then resets', () => {
    const flag = inScope(() => useTransientFlag())
    flag.trigger()
    expect(flag.active.value).toBe(true)
    expect(flag.fading.value).toBe(false)

    vi.advanceTimersByTime(HOLD_MS - 1)
    expect(flag.active.value).toBe(true)
    expect(flag.fading.value).toBe(false)

    vi.advanceTimersByTime(1)
    expect(flag.active.value).toBe(true)
    expect(flag.fading.value).toBe(true)

    vi.advanceTimersByTime(FADE_MS - 1)
    expect(flag.active.value).toBe(true)

    vi.advanceTimersByTime(1)
    expect(flag.active.value).toBe(false)
    expect(flag.fading.value).toBe(false)
  })

  it('restarts the hold when re-triggered during the hold', () => {
    const flag = inScope(() => useTransientFlag())
    flag.trigger()
    vi.advanceTimersByTime(2000)
    flag.trigger()
    vi.advanceTimersByTime(2000)
    expect(flag.active.value).toBe(true)
    expect(flag.fading.value).toBe(false)
    vi.advanceTimersByTime(500)
    expect(flag.fading.value).toBe(true)
  })

  it('cancels the fade and restarts the hold when re-triggered during the fade', () => {
    const flag = inScope(() => useTransientFlag())
    flag.trigger()
    vi.advanceTimersByTime(HOLD_MS + 100)
    expect(flag.fading.value).toBe(true)

    flag.trigger()
    expect(flag.fading.value).toBe(false)
    vi.advanceTimersByTime(FADE_MS + 100)
    expect(flag.active.value).toBe(true)

    vi.advanceTimersByTime(HOLD_MS + FADE_MS)
    expect(flag.active.value).toBe(false)
  })

  it('skips the fade under prefers-reduced-motion and still resets at the hold', () => {
    mockReducedMotion(true)
    const flag = inScope(() => useTransientFlag())
    flag.trigger()
    vi.advanceTimersByTime(HOLD_MS - 1)
    expect(flag.active.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(flag.active.value).toBe(false)
    expect(flag.fading.value).toBe(false)
  })

  it('still resets when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    const flag = inScope(() => useTransientFlag())
    flag.trigger()
    vi.advanceTimersByTime(HOLD_MS + FADE_MS)
    expect(flag.active.value).toBe(false)
  })

  it('reset() clears the flag and cancels pending timers', () => {
    const flag = inScope(() => useTransientFlag())
    flag.trigger()
    flag.reset()
    expect(flag.active.value).toBe(false)
    expect(flag.fading.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears its timers when the owning scope is disposed', () => {
    const scope = effectScope()
    const flag = scope.run(() => useTransientFlag())!
    flag.trigger()
    expect(vi.getTimerCount()).toBe(1)
    scope.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('accepts custom durations', () => {
    const flag = inScope(() => useTransientFlag({ holdMs: 100, fadeMs: 50 }))
    flag.trigger()
    vi.advanceTimersByTime(100)
    expect(flag.fading.value).toBe(true)
    vi.advanceTimersByTime(50)
    expect(flag.active.value).toBe(false)
  })
})
