import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateLegacyStore, resolveRuntimePaths } from './runtime-paths'

const dirs: string[] = []
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'pr-panel-paths-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('resolveRuntimePaths', () => {
  it('keeps reviews in the home directory, not in the OS temp directory', () => {
    const paths = resolveRuntimePaths({}, '/Users/someone')
    expect(paths.storeDir).toBe('/Users/someone/.zenuml-pr-panel/store')
    expect(paths.legacyStoreDir).toBe(join(tmpdir(), 'zenuml-pr-panel', 'store'))
    expect(paths.dir).toBe(join(tmpdir(), 'zenuml-pr-panel'))
  })

  it('keeps the store inside PR_PANEL_RUNTIME_DIR, so a test Hub never touches real reviews', () => {
    const paths = resolveRuntimePaths({ PR_PANEL_RUNTIME_DIR: '/x/run' }, '/Users/someone')
    expect(paths.storeDir).toBe('/x/run/store')
    expect(paths.legacyStoreDir).toBeUndefined()
  })

  it('takes PR_PANEL_STORE_DIR over both defaults', () => {
    expect(resolveRuntimePaths({ PR_PANEL_STORE_DIR: '/data/store' }, '/Users/someone').storeDir).toBe('/data/store')
  })
})

describe('migrateLegacyStore', () => {
  it('copies reviews from the old temp store when the new store has none, and keeps the old copy', () => {
    const root = tempDir()
    const from = join(root, 'tmp-store')
    const to = join(root, 'home', 'store')
    mkdirSync(join(from, 'reviews'), { recursive: true })
    writeFileSync(join(from, 'reviews', 'github.com%2Fo%2Fr.json'), '[{"runId":"a"}]')

    expect(migrateLegacyStore(from, to)).toBe(1)
    expect(readFileSync(join(to, 'reviews', 'github.com%2Fo%2Fr.json'), 'utf8')).toBe('[{"runId":"a"}]')
    expect(statSync(join(from, 'reviews', 'github.com%2Fo%2Fr.json')).isFile()).toBe(true)
    expect(statSync(to).mode & 0o077).toBe(0)
  })

  it('never overwrites a store that already has reviews', () => {
    const root = tempDir()
    const from = join(root, 'tmp-store')
    const to = join(root, 'home', 'store')
    mkdirSync(join(from, 'reviews'), { recursive: true })
    mkdirSync(join(to, 'reviews'), { recursive: true })
    writeFileSync(join(from, 'reviews', 'r.json'), 'old')
    writeFileSync(join(to, 'reviews', 'r.json'), 'new')

    expect(migrateLegacyStore(from, to)).toBe(0)
    expect(readFileSync(join(to, 'reviews', 'r.json'), 'utf8')).toBe('new')
  })

  it('does nothing when there is no old store', () => {
    const root = tempDir()
    expect(migrateLegacyStore(join(root, 'missing'), join(root, 'store'))).toBe(0)
  })
})
