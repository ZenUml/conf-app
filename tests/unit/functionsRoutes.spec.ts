import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// Which backend paths exist is written by hand in public/_routes.json (the
// Pages allowlist: a handler missing there is served the SPA HTML) and in the
// vite dev proxy. This checks both against the handlers on disk (#924).
// functions/_middleware.ts AUTHENTICATED_PATHS stays a hand-kept policy list.

const FUNCTIONS_DIR = 'functions'

// Handlers that are deliberately NOT routed in production. Each needs a reason.
const LOCAL_ONLY: Record<string, string> = {
  '/api/analytics/events': 'internal analytics dashboard, local wrangler only (docs/audit/2026-06-10-repo-audit.md Q2); not FIT-authenticated',
  '/api/analytics/explore': 'internal analytics dashboard, local wrangler only',
  '/api/analytics/operations': 'internal analytics dashboard, local wrangler only',
  '/api/analytics/refresh': 'internal analytics dashboard, local wrangler only',
  '/api/analytics/reports': 'internal analytics dashboard, local wrangler only',
  '/api/analytics/saved-queries': 'internal analytics dashboard, local wrangler only',
}

// _routes.json entries answered by functions/_middleware.ts, not by a file.
const MIDDLEWARE_SERVED: Record<string, string> = {
  '/.well-known/oauth-protected-resource': '_middleware.ts oauthDiscoveryResponse',
  '/.well-known/oauth-authorization-server': '_middleware.ts oauthDiscoveryResponse',
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

const HANDLER_EXPORT = /export\s+(?:async\s+)?(?:function|const)\s+onRequest/

// functions/a/b.ts -> /a/b; index -> its directory; [param] and [[catchall]]
// -> a sample segment, so the path can be matched against the allowlist.
function pagesPath(file: string): string {
  const rel = path.relative(FUNCTIONS_DIR, file).replace(/\.(ts|js)$/, '')
  const segments = rel.split(path.sep).filter((s) => s !== 'index')
  return `/${segments.map((s) => (/^\[.+\]$/.test(s) ? 'x' : s)).join('/')}`
}

const handlers = walk(FUNCTIONS_DIR)
  .filter((f) => /\.(ts|js)$/.test(f) && !/\.(spec|test)\.(ts|js)$/.test(f))
  .filter((f) => path.basename(f) !== '_middleware.ts')
  .filter((f) => HANDLER_EXPORT.test(fs.readFileSync(f, 'utf8')))
  .map(pagesPath)
  .sort()

// Cloudflare Pages: `*` matches any characters, including `/`.
function includeMatches(include: string, p: string): boolean {
  const pattern = include.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${pattern}$`).test(p)
}

const includes: string[] = JSON.parse(fs.readFileSync('public/_routes.json', 'utf8')).include

function viteProxyKeys(): string[] {
  const config = fs.readFileSync('vite.config.mjs', 'utf8')
  const block = config.slice(config.indexOf('proxy: {'))
  const body = block.slice(0, block.indexOf('\n    },') + 1)
  return [...body.matchAll(/^\s*'(\/[^']*)':\s*\{/gm)].map((m) => m[1])
}

describe('functions routes (#924)', () => {
  it('finds the handlers on disk', () => {
    expect(handlers.length).toBeGreaterThan(40)
    expect(handlers).toContain('/forge-custom-content')
    expect(handlers).toContain('/api/diagram-impact')
    expect(handlers).toContain('/d/x')
  })

  it('routes every handler in public/_routes.json, unless it is listed as local-only', () => {
    const unrouted = handlers.filter((p) => !includes.some((i) => includeMatches(i, p)) && !(p in LOCAL_ONLY))
    expect(unrouted).toEqual([])
  })

  it('keeps LOCAL_ONLY honest: each entry is a real handler that is really unrouted', () => {
    for (const p of Object.keys(LOCAL_ONLY)) {
      expect(handlers).toContain(p)
      expect(includes.some((i) => includeMatches(i, p))).toBe(false)
    }
  })

  it('backs every public/_routes.json entry with a handler or the middleware', () => {
    const orphaned = includes.filter((i) => !handlers.some((p) => includeMatches(i, p)) && !(i in MIDDLEWARE_SERVED))
    expect(orphaned).toEqual([])
  })

  it('proxies only paths that have a handler in local dev', () => {
    const dead = viteProxyKeys().filter((key) => !handlers.some((p) => p === key || p.startsWith(`${key}/`)))
    expect(viteProxyKeys().length).toBeGreaterThan(0)
    expect(dead).toEqual([])
  })
})
