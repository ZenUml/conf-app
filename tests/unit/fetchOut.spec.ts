import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fetchOut, UpstreamTimeoutError, DEFAULT_TIMEOUT_MS } from '../../functions/utils/http'

function hangingFetch() {
  return vi.fn((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) return reject(init.signal.reason)
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason ?? new DOMException('Aborted', 'AbortError')))
    }),
  )
}

describe('fetchOut (#941)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('rejects with UpstreamTimeoutError carrying name, host only, and timeoutMs', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const p = fetchOut('https://api.example.com/path?token=secret', { name: 'mixpanel', timeoutMs: 1000 })
    const assertion = expect(p).rejects.toMatchObject({
      name: 'UpstreamTimeoutError',
      upstream: 'mixpanel',
      host: 'api.example.com',
      timeoutMs: 1000,
    })
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    await p.catch((e) => {
      expect(e).toBeInstanceOf(UpstreamTimeoutError)
      expect(String(e.message)).not.toContain('secret')
    })
  })

  it('does not time out before the budget elapses', async () => {
    const f = hangingFetch()
    vi.stubGlobal('fetch', f)
    const p = fetchOut('https://a.example.com/', { name: 'x', timeoutMs: 1000 })
    p.catch(() => {})
    await vi.advanceTimersByTimeAsync(999)
    expect(f.mock.calls[0][1]!.signal!.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(f.mock.calls[0][1]!.signal!.aborted).toBe(true)
  })

  it('uses DEFAULT_TIMEOUT_MS when timeoutMs is omitted', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const p = fetchOut('https://a.example.com/', { name: 'x' })
    const assertion = expect(p).rejects.toMatchObject({ timeoutMs: DEFAULT_TIMEOUT_MS })
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS)
    await assertion
  })

  it('a caller abort rejects with the caller reason, not UpstreamTimeoutError', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const ctrl = new AbortController()
    const p = fetchOut('https://a.example.com/', { name: 'x', timeoutMs: 1000, signal: ctrl.signal })
    const reason = new Error('caller gave up')
    const assertion = expect(p).rejects.toBe(reason)
    ctrl.abort(reason)
    await assertion
  })

  it('an already-aborted caller signal aborts immediately', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const ctrl = new AbortController()
    ctrl.abort(new Error('early'))
    await expect(fetchOut('https://a.example.com/', { name: 'x', signal: ctrl.signal })).rejects.toThrow('early')
  })

  it('strips name/timeoutMs from the init and passes the response through; clears the timer', async () => {
    const f = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', f)
    const res = await fetchOut('https://a.example.com/', { name: 'x', timeoutMs: 500, method: 'POST', body: 'b' })
    expect(await res.text()).toBe('ok')
    const init = f.mock.calls[0][1] as Record<string, unknown>
    expect(init).toMatchObject({ method: 'POST', body: 'b' })
    expect(init).not.toHaveProperty('name')
    expect(init).not.toHaveProperty('timeoutMs')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('propagates non-abort fetch errors unchanged', async () => {
    const err = new TypeError('network down')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err))
    await expect(fetchOut('https://a.example.com/', { name: 'x' })).rejects.toBe(err)
  })
})

describe('guard: no bare fetch( in functions/** (#941)', () => {
  const root = join(__dirname, '../../functions')
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e)
      if (statSync(p).isDirectory()) walk(p, out)
      else if (/\.(ts|js)$/.test(e) && !/\.(spec|test)\.(ts|js)$/.test(e)) out.push(p)
    }
    return out
  }

  it('every outbound call goes through fetchOut()', () => {
    const offenders: string[] = []
    for (const file of walk(root)) {
      const rel = relative(root, file)
      if (rel === join('utils', 'http.ts')) continue
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '')
        if (/^\s*(\*|\/\*)/.test(line)) return // comment lines
        // a bare global call: `fetch(` not preceded by `.`, an identifier char,
        // or `async ` (method definition: Durable Object `async fetch(request)`).
        // `stub.fetch(` (Durable Object stub, internal RPC) is preceded by `.`.
        if (/(^|[^.\w])(?<!async\s)fetch\(/.test(code)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
