import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Storybook aliases the analytics module to a no-op stub. A runtime export the
// stub lacks makes every story that imports it fail to load (ESM link error),
// so the stub must cover every runtime export of the real module.
const EXPORT = /^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/gm

function runtimeExports(file: string): string[] {
  const source = readFileSync(resolve(__dirname, '../..', file), 'utf8')
  return [...source.matchAll(EXPORT)].map((m) => m[1]).sort()
}

describe('Storybook trackAnalyticsEvent stub', () => {
  it('exports every runtime export of the real module', () => {
    const real = runtimeExports('src/utils/analytics/trackAnalyticsEvent.ts')
    const stub = runtimeExports('.storybook/stubs/trackAnalyticsEvent.ts')
    expect(real.length).toBeGreaterThan(0)
    expect(real.filter((name) => !stub.includes(name))).toEqual([])
  })
})
