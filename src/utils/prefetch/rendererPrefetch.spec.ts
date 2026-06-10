import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runRendererPrefetchIfDue, isPrefetchDue, type RunOptions } from './rendererPrefetch'
import { markPrefetchDone, getBuildKey, tryClaimLock, type KvStore } from './throttle'
import { DRAWIO_PREFETCH_ASSETS } from '@/utils/drawio/loadDrawioViewer'

function memoryStore(): KvStore {
  const map = new Map<string, string>()
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

function makeOpts(overrides: Partial<RunOptions> = {}): RunOptions & {
  track: ReturnType<typeof vi.fn>
  prefetch: ReturnType<typeof vi.fn>
  warmMermaid: ReturnType<typeof vi.fn>
} {
  return {
    host: 'macro',
    store: memoryStore(),
    nav: {},
    now: () => 1000,
    getFlags: vi.fn(async () => true),
    getManifest: vi.fn(async () => ({ version: 1, renderers: { sequence: ['assets/zenuml.esm-x.js'], openapi: ['assets/OpenApiViewer-y.js'] } })),
    prefetch: vi.fn(async (paths: readonly string[]) => ({ requested: paths.length, failed: 0, timedOut: false })),
    warmMermaid: vi.fn(async () => undefined),
    track: vi.fn(),
    ...overrides,
  } as never
}

describe('isPrefetchDue', () => {
  it('flips to not-due once marked done for this build', () => {
    const store = memoryStore()
    expect(isPrefetchDue(store)).toBe(true)
    markPrefetchDone(getBuildKey(), store)
    expect(isPrefetchDue(store)).toBe(false)
  })
})

describe('runRendererPrefetchIfDue', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('prefetches drawio + manifest chunks, warms mermaid, fires both events, marks done', async () => {
    const opts = makeOpts()
    await runRendererPrefetchIfDue(opts)

    const paths = opts.prefetch.mock.calls[0][0] as string[]
    for (const asset of DRAWIO_PREFETCH_ASSETS) expect(paths).toContain(asset)
    expect(paths).toContain('assets/zenuml.esm-x.js')
    expect(paths).toContain('assets/OpenApiViewer-y.js')
    expect(opts.warmMermaid).toHaveBeenCalledOnce()

    const events = opts.track.mock.calls.map((c) => c[0])
    expect(events).toEqual(['renderer_prefetch_started', 'renderer_prefetch_completed'])
    const completed = opts.track.mock.calls[1][1]
    expect(completed.prefetch_outcome).toBe('completed')
    expect(completed.prefetch_host).toBe('macro')
    // requested = 7 links (5 drawio + 2 chunks) + 1 mermaid warm
    expect(completed.prefetch_assets_count).toBe(8)

    expect(isPrefetchDue(opts.store)).toBe(false)
  })

  it('does nothing once done for this build (no events, no fetches)', async () => {
    const opts = makeOpts()
    markPrefetchDone(getBuildKey(), opts.store)
    await runRendererPrefetchIfDue(opts)
    expect(opts.track).not.toHaveBeenCalled()
    expect(opts.prefetch).not.toHaveBeenCalled()
  })

  it.each([
    ['saveData', { connection: { saveData: true } }],
    ['slow-2g', { connection: { effectiveType: 'slow-2g' } }],
    ['2g', { connection: { effectiveType: '2g' } }],
  ])('skips silently on %s and stays due for a later attempt', async (_name, nav) => {
    const opts = makeOpts({ nav: nav as RunOptions['nav'] })
    await runRendererPrefetchIfDue(opts)
    expect(opts.track).not.toHaveBeenCalled()
    expect(isPrefetchDue(opts.store)).toBe(true)
  })

  it('skips when another iframe holds the lock', async () => {
    const opts = makeOpts()
    tryClaimLock(999, opts.store)
    await runRendererPrefetchIfDue(opts)
    expect(opts.track).not.toHaveBeenCalled()
    expect(isPrefetchDue(opts.store)).toBe(true)
  })

  it('flag off: no events, not marked done (a later flag flip can still warm)', async () => {
    const opts = makeOpts({ getFlags: vi.fn(async () => false) })
    await runRendererPrefetchIfDue(opts)
    expect(opts.track).not.toHaveBeenCalled()
    expect(isPrefetchDue(opts.store)).toBe(true)
    // lock released → a later attempt is possible
    expect(tryClaimLock(2000, opts.store)).toBe(true)
  })

  it('excludes the calling renderer family', async () => {
    const opts = makeOpts({ excludeRenderers: ['graph', 'mermaid'] })
    await runRendererPrefetchIfDue(opts)
    const paths = opts.prefetch.mock.calls[0][0] as string[]
    for (const asset of DRAWIO_PREFETCH_ASSETS) expect(paths).not.toContain(asset)
    expect(opts.warmMermaid).not.toHaveBeenCalled()
    expect(opts.track.mock.calls[0][1].prefetch_renderers).toBe('sequence,openapi')
  })

  it('skips the mermaid import-warm on low-memory devices but still link-prefetches', async () => {
    const opts = makeOpts({ nav: { deviceMemory: 2 } as RunOptions['nav'] })
    await runRendererPrefetchIfDue(opts)
    expect(opts.warmMermaid).not.toHaveBeenCalled()
    expect(opts.prefetch).toHaveBeenCalledOnce()
  })

  it('reports partial when some assets fail, failed when all fail', async () => {
    const partial = makeOpts({
      prefetch: vi.fn(async (paths: readonly string[]) => ({ requested: paths.length, failed: 1, timedOut: false })),
    })
    await runRendererPrefetchIfDue(partial)
    expect(partial.track.mock.calls[1][1].prefetch_outcome).toBe('partial')

    const allFail = makeOpts({
      prefetch: vi.fn(async (paths: readonly string[]) => ({ requested: paths.length, failed: paths.length, timedOut: false })),
      warmMermaid: vi.fn(async () => {
        throw new Error('warm failed')
      }),
    })
    await runRendererPrefetchIfDue(allFail)
    expect(allFail.track.mock.calls[1][1].prefetch_outcome).toBe('failed')
  })

  it('marks done even after a failed attempt (no retry storms until next deploy)', async () => {
    const opts = makeOpts({
      prefetch: vi.fn(async () => {
        throw new Error('network down')
      }),
    })
    await runRendererPrefetchIfDue(opts)
    expect(isPrefetchDue(opts.store)).toBe(false)
  })

  it('never throws even when everything explodes', async () => {
    const opts = makeOpts({
      getFlags: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    await expect(runRendererPrefetchIfDue(opts)).resolves.toBeUndefined()
  })

  it('bounds a hung flag fetch by the deadline: no events, not marked done', async () => {
    vi.useFakeTimers()
    try {
      const opts = makeOpts({
        deadlineMs: 1_000,
        getFlags: vi.fn(() => new Promise<boolean>(() => undefined)), // never resolves
      })
      const pending = runRendererPrefetchIfDue(opts)
      await vi.advanceTimersByTimeAsync(1_001)
      await pending
      expect(opts.track).not.toHaveBeenCalled()
      expect(isPrefetchDue(opts.store)).toBe(true)
      expect(tryClaimLock(Date.now(), opts.store)).toBe(true) // lock released
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports timed_out when the manifest fetch hangs past deadline + grace', async () => {
    vi.useFakeTimers()
    try {
      const opts = makeOpts({
        deadlineMs: 1_000,
        getManifest: vi.fn(() => new Promise<never>(() => undefined)), // never resolves
      })
      const pending = runRendererPrefetchIfDue(opts)
      await vi.advanceTimersByTimeAsync(3_001) // deadline + 2s grace
      await pending
      const completed = opts.track.mock.calls.find((c) => c[0] === 'renderer_prefetch_completed')
      expect(completed?.[1].prefetch_outcome).toBe('timed_out')
      expect(completed?.[1].prefetch_assets_count).toBe(0)
      expect(isPrefetchDue(opts.store)).toBe(false) // attempt counted, no retry storm
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds a hung mermaid warm by the remaining deadline and counts it failed', async () => {
    vi.useFakeTimers()
    try {
      const opts = makeOpts({
        deadlineMs: 1_000,
        warmMermaid: vi.fn(() => new Promise<void>(() => undefined)), // never resolves
      })
      const pending = runRendererPrefetchIfDue(opts)
      await vi.advanceTimersByTimeAsync(1_001)
      await pending
      const completed = opts.track.mock.calls.find((c) => c[0] === 'renderer_prefetch_completed')
      expect(completed?.[1].prefetch_outcome).toBe('partial') // links ok, warm timed out
      expect(completed?.[1].prefetch_failed_count).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses page_banner surface and banner host flag for the banner host', async () => {
    const opts = makeOpts({ host: 'banner', deadlineMs: 5000 })
    await runRendererPrefetchIfDue(opts)
    expect(opts.getFlags).toHaveBeenCalledWith('banner')
    expect(opts.track.mock.calls[0][1].surface).toBe('page_banner')
    expect(opts.track.mock.calls[0][1].prefetch_host).toBe('banner')
  })
})
