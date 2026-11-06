import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// Every EventBus event that is emitted must also be listened to, and the
// reverse (#936). A rename on one side would otherwise fail silently, as
// `draft-discard` and `highlight` did.

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

const sources = walk('src')
  .filter((f) => /\.(ts|tsx|vue)$/.test(f) && !/\.(spec|test|stories)\.(ts|tsx)$/.test(f))
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n')

const CALL = /EventBus\.\$(on|once|emit)\(\s*['"]([^'"]+)['"]/g

function names(kind: 'listen' | 'emit'): Set<string> {
  const found = new Set<string>()
  for (const [, method, name] of sources.matchAll(CALL)) {
    if ((method === 'emit') === (kind === 'emit')) found.add(name)
  }
  return found
}

describe('EventBus events (#936)', () => {
  const emitted = names('emit')
  const listened = names('listen')

  it('finds the bus calls', () => {
    expect(emitted.size).toBeGreaterThan(10)
    expect(listened).toContain('saved')
  })

  it('has a listener for every emitted event', () => {
    expect([...emitted].filter((n) => !listened.has(n)).sort()).toEqual([])
  })

  it('has an emitter for every listened event', () => {
    expect([...listened].filter((n) => !emitted.has(n)).sort()).toEqual([])
  })
})
