import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  runRendererPrefetchIfDue,
  executePrefetch,
  isPrefetchDue,
  type RunOptions,
  type Guards,
} from './rendererPrefetch'
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
  prefetch: ReturnType<typeof vi.fn>
  warmMermaid: ReturnType<typeof vi.fn>
} {
  return {
    host: 'macro',
    store: memoryStore(),
    nav: {},
    now: () => 1000,
    getManifest: vi.fn(async () => ({ version: 1, renderers: { sequence: ['assets/zenuml.esm-x.js'], openapi: ['assets/OpenApiViewer-y.js'] } })),
    prefetch: vi.fn(async (paths: readonly string[]) => ({ requested: paths.length, failed: 0, timedOut: false })),
    warmMermaid: vi.fn(async () => undefined),
    ...overrides,
  } as never
}

const DEFAULT_GUARDS: Guards = { saveData: false, allowImportWarm: true, visible: true }

describe('isPrefetchDue', () => {
  it('flips to not-due once marked done for this build', () => {
    const store = memoryStore()
    expect(isPrefetchDue(store)).toBe(true)
    markPrefetchDone(getBuildKey(), store)
    expect(isPrefetchDue(store)).toBe(false)
  })
})

describe('executePrefetch — outcome classification', () => {
  it('completed: all links + mermaid warm succeed', async () => {
    const opts = makeOpts()
    const outcome = await executePrefetch(['graph', 'mermaid', 'sequence', 'openapi'], DEFAULT_GUARDS, 30_000, opts, () => 1000)
    expect(outcome.outcome).toBe('completed')
    // requested = 5 drawio + 2 manifest chunks + 1 mermaid warm
    expect(outcome.requested).toBe(8)
    expect(outcome.failed).toBe(0)
  })

  it('partial: some links fail', async () => {
    const opts = makeOpts({
      prefetch: vi.fn(async (paths: readonly string[]) => ({ requested: paths.length, failed: 1, timedOut: false })),
    })
    const outcome = await executePrefetch(['graph'], DEFAULT_GUARDS, 30_000, opts, () => 1000)
    expect(outcome.outcome).toBe('partial')
  })

  it('failed: every link fails and no mermaid warm requested', async () => {
    const opts = makeOpts({
      prefetch: vi.fn(async (paths: readonly string[]) => ({ requested: paths.length, failed: paths.length, timedOut: false })),
    })
    const outcome = await executePrefetch(['graph'], DEFAULT_GUARDS, 30_000, opts, () => 1000)
    expect(outcome.outcome).toBe('failed')
  })

  it('failed: mermaid warm itself throws', async () => {
    const opts = makeOpts({
      prefetch: vi.fn(async () => ({ requested: 0, failed: 0, timedOut: false })),
      warmMermaid: vi.fn(async () => {
        throw new Error('warm failed')
      }),
    })
    const outcome = await executePrefetch(['mermaid'], DEFAULT_GUARDS, 30_000, opts, () => 1000)
    expect(outcome.outcome).toBe('failed')
    expect(outcome.failed).toBe(1)
    expect(outcome.requested).toBe(1)
  })

  it('honours allowImportWarm: false — skips the mermaid import-warm, still link-prefetches', async () => {
    const opts = makeOpts()
    const outcome = await executePrefetch(['graph', 'mermaid'], { ...DEFAULT_GUARDS, allowImportWarm: false }, 30_000, opts, () => 1000)
    expect(opts.warmMermaid).not.toHaveBeenCalled()
    expect(opts.prefetch).toHaveBeenCalledOnce()
    expect(outcome.requested).toBe(DRAWIO_PREFETCH_ASSETS.length)
  })

  it('bounds a hung mermaid warm by the remaining deadline and counts it failed', async () => {
    vi.useFakeTimers()
    try {
      const opts = makeOpts({
        warmMermaid: vi.fn(() => new Promise<void>(() => undefined)), // never resolves
      })
      const pending = executePrefetch(['mermaid'], DEFAULT_GUARDS, 1_000, opts, () => 1000)
      await vi.advanceTimersByTimeAsync(1_001)
      const outcome = await pending
      expect(outcome.outcome).toBe('failed') // the only requested asset (the warm) timed out
      expect(outcome.failed).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('runRendererPrefetchIfDue — orchestration', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('prefetches drawio + manifest chunks, warms mermaid, marks done', async () => {
    const opts = makeOpts()
    await runRendererPrefetchIfDue(opts)

    const paths = opts.prefetch.mock.calls[0][0] as string[]
    for (const asset of DRAWIO_PREFETCH_ASSETS) expect(paths).toContain(asset)
    expect(paths).toContain('assets/zenuml.esm-x.js')
    expect(paths).toContain('assets/OpenApiViewer-y.js')
    expect(opts.warmMermaid).toHaveBeenCalledOnce()
    expect(isPrefetchDue(opts.store)).toBe(false)
  })

  it('does nothing once done for this build (no fetches)', async () => {
    const opts = makeOpts()
    markPrefetchDone(getBuildKey(), opts.store)
    await runRendererPrefetchIfDue(opts)
    expect(opts.prefetch).not.toHaveBeenCalled()
  })

  it('derives allowImportWarm from nav.deviceMemory: low memory skips the mermaid warm', async () => {
    const opts = makeOpts({ nav: { deviceMemory: 2 } as RunOptions['nav'] })
    await runRendererPrefetchIfDue(opts)
    expect(opts.warmMermaid).not.toHaveBeenCalled()
    expect(opts.prefetch).toHaveBeenCalledOnce()
    expect(isPrefetchDue(opts.store)).toBe(false)
  })

  it.each([
    ['saveData', { connection: { saveData: true } }],
    ['slow-2g', { connection: { effectiveType: 'slow-2g' } }],
    ['2g', { connection: { effectiveType: '2g' } }],
  ])('skips silently on %s and stays due for a later attempt', async (_name, nav) => {
    const opts = makeOpts({ nav: nav as RunOptions['nav'] })
    await runRendererPrefetchIfDue(opts)
    expect(opts.prefetch).not.toHaveBeenCalled()
    expect(isPrefetchDue(opts.store)).toBe(true)
  })

  it('skips when another iframe holds the lock', async () => {
    const opts = makeOpts()
    tryClaimLock(999, opts.store)
    await runRendererPrefetchIfDue(opts)
    expect(opts.prefetch).not.toHaveBeenCalled()
    expect(isPrefetchDue(opts.store)).toBe(true)
  })

  it('excludes the calling renderer family', async () => {
    const opts = makeOpts({ excludeRenderers: ['graph', 'mermaid'] })
    await runRendererPrefetchIfDue(opts)
    const paths = opts.prefetch.mock.calls[0][0] as string[]
    for (const asset of DRAWIO_PREFETCH_ASSETS) expect(paths).not.toContain(asset)
    expect(opts.warmMermaid).not.toHaveBeenCalled()
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
    // Blow up in the very first step (the throttle read) so the failure lands
    // outside the inner try/finally — the outer guarantee is what matters:
    // this runs on a render and on the banner's view.close path.
    const opts = makeOpts({
      store: {
        getItem: () => {
          throw new Error('boom')
        },
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    })
    await expect(runRendererPrefetchIfDue(opts)).resolves.toBeUndefined()
    expect(opts.prefetch).not.toHaveBeenCalled()
  })

  it('reports timed_out (via executePrefetch) when the manifest fetch hangs past deadline + grace', async () => {
    vi.useFakeTimers()
    try {
      const opts = makeOpts({
        deadlineMs: 1_000,
        getManifest: vi.fn(() => new Promise<never>(() => undefined)), // never resolves
      })
      const pending = runRendererPrefetchIfDue(opts)
      await vi.advanceTimersByTimeAsync(3_001) // deadline + 2s grace
      await pending
      expect(isPrefetchDue(opts.store)).toBe(false) // attempt counted, no retry storm
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the banner deadline to bound waiting', async () => {
    const opts = makeOpts({ host: 'banner', deadlineMs: 5000 })
    await runRendererPrefetchIfDue(opts)
    expect(opts.prefetch).toHaveBeenCalledOnce()
    expect(isPrefetchDue(opts.store)).toBe(false)
  })
})
