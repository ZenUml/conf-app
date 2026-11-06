import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type EffectScope } from 'vue'

import { useSustainedFlag } from './useSustainedFlag'

const DELAY_MS = 2000

describe('useSustainedFlag', () => {
  let scopes: EffectScope[] = []

  // The composable is meant to live inside a component's scope, so exercise it
  // in one here too — that is also what keeps its timers from outliving a test.
  function inScope<T>(fn: () => T): T {
    const scope = effectScope()
    scopes.push(scope)
    return scope.run(fn) as T
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    scopes.forEach((scope) => scope.stop())
    scopes = []
    vi.useRealTimers()
  })

  it('starts false even when the source is already truthy', () => {
    const source = ref<unknown>('error')

    const sustained = inScope(() => useSustainedFlag(source, DELAY_MS))

    expect(sustained.value).toBe(false)
  })

  it('stays false until the delay has fully elapsed', async () => {
    const source = ref<unknown>('error')
    const sustained = inScope(() => useSustainedFlag(source, DELAY_MS))

    await vi.advanceTimersByTimeAsync(DELAY_MS - 1)

    expect(sustained.value).toBe(false)
  })

  it('turns true once the source has been truthy for the delay', async () => {
    const source = ref<unknown>('error')
    const sustained = inScope(() => useSustainedFlag(source, DELAY_MS))

    await vi.advanceTimersByTimeAsync(DELAY_MS)

    expect(sustained.value).toBe(true)
  })

  it('turns false immediately when the source becomes falsy', async () => {
    const source = ref<unknown>('error')
    const sustained = inScope(() => useSustainedFlag(source, DELAY_MS))
    await vi.advanceTimersByTimeAsync(DELAY_MS)

    source.value = null
    await vi.advanceTimersByTimeAsync(0)

    expect(sustained.value).toBe(false)
  })

  it('never turns true when the source clears before the delay elapses', async () => {
    const source = ref<unknown>('error')
    const sustained = inScope(() => useSustainedFlag(source, DELAY_MS))

    await vi.advanceTimersByTimeAsync(DELAY_MS - 1)
    source.value = null
    await vi.advanceTimersByTimeAsync(DELAY_MS)

    expect(sustained.value).toBe(false)
  })

  it('requires a fresh full delay after the source dips falsy', async () => {
    const source = ref<unknown>('error')
    const sustained = inScope(() => useSustainedFlag(source, DELAY_MS))

    await vi.advanceTimersByTimeAsync(DELAY_MS - 1)
    source.value = null
    await vi.advanceTimersByTimeAsync(0)
    source.value = 'another error'
    await vi.advanceTimersByTimeAsync(DELAY_MS - 1)

    expect(sustained.value).toBe(false)

    await vi.advanceTimersByTimeAsync(1)

    expect(sustained.value).toBe(true)
  })

  it('does not restart the delay when the value changes but stays truthy', async () => {
    const source = ref<unknown>('error at line 1')
    const sustained = inScope(() => useSustainedFlag(source, DELAY_MS))

    await vi.advanceTimersByTimeAsync(DELAY_MS - 1)
    source.value = 'error at line 2'
    await vi.advanceTimersByTimeAsync(1)

    expect(sustained.value).toBe(true)
  })

  it('starts the delay when a source that began falsy turns truthy', async () => {
    const source = ref<unknown>(null)
    const sustained = inScope(() => useSustainedFlag(source, DELAY_MS))

    await vi.advanceTimersByTimeAsync(DELAY_MS)
    expect(sustained.value).toBe(false)

    source.value = 'error'
    await vi.advanceTimersByTimeAsync(DELAY_MS)

    expect(sustained.value).toBe(true)
  })

  it('accepts a getter as the source', async () => {
    const source = ref<unknown>('error')
    const sustained = inScope(() => useSustainedFlag(() => source.value, DELAY_MS))

    await vi.advanceTimersByTimeAsync(DELAY_MS)

    expect(sustained.value).toBe(true)
  })

  it('cancels the pending timer when the owning scope is disposed', async () => {
    const source = ref<unknown>('error')
    const scope = effectScope()
    const sustained = scope.run(() => useSustainedFlag(source, DELAY_MS))!

    scope.stop()
    await vi.advanceTimersByTimeAsync(DELAY_MS)

    expect(sustained.value).toBe(false)
  })
})
