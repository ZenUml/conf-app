import { describe, expect, it, vi } from 'vitest'

import { createRequire } from 'node:module'

import { purgeExpiredFeedbackScreenshots, purgeExpiredMagicWritebacks } from './index'

function database(changes: number) {
  const updateRun = vi.fn(async () => ({ success: true, meta: { changes } }))
  const updateBind = vi.fn(() => ({ run: updateRun }))
  return {
    prepare: vi.fn(() => ({ bind: updateBind })),
    updateBind,
  }
}

describe('feedback attachment retention', () => {
  it('deletes expired D1 image bytes in a bounded batch', async () => {
    const db = database(1)
    const deleted = await purgeExpiredFeedbackScreenshots(db as any, '2026-10-10T00:00:00.000Z')

    expect(deleted).toBe(1)
    expect(db.updateBind).toHaveBeenCalledWith('2026-10-10T00:00:00.000Z', 100)
  })

  it('returns zero when no expired D1 screenshots are found', async () => {
    const db = database(0)
    expect(await purgeExpiredFeedbackScreenshots(db as any, '2026-10-10T00:00:00.000Z')).toBe(0)
  })
})

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')

function magicDb(expiries: number[]) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('CREATE TABLE MagicWriteback (id TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL)')
  expiries.forEach((e, i) => sqlite.prepare('INSERT INTO MagicWriteback VALUES (?,?)').run(`r${i}`, e))
  const prepare = vi.fn((sql: string) => {
    let values: unknown[] = []
    const st = {
      bind: (...a: unknown[]) => { values = a; return st },
      run: async () => ({ success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
    }
    return st
  })
  return { prepare, count: () => Number(sqlite.prepare('SELECT COUNT(*) c FROM MagicWriteback').get().c) }
}

describe('Magic writeback expiry purge', () => {
  const now = 1_000_000
  it('deletes expired rows (expiresAt <= now) and keeps unexpired ones', async () => {
    const db = magicDb([now - 5, now, now + 1, now + 9999])
    expect(await purgeExpiredMagicWritebacks(db as any, now)).toBe(2)
    expect(db.count()).toBe(2)
  })

  it('stops after one batch when fewer than a batch remain', async () => {
    const db = magicDb([now - 1, now - 2])
    expect(await purgeExpiredMagicWritebacks(db as any, now)).toBe(2)
    expect(db.prepare).toHaveBeenCalledTimes(1)
  })

  it('loops while batches are full and is capped at 20 batches', async () => {
    const db = magicDb(Array.from({ length: 1000 * 21 + 5 }, () => now - 1))
    expect(await purgeExpiredMagicWritebacks(db as any, now)).toBe(20_000)
    expect(db.prepare).toHaveBeenCalledTimes(20)
    expect(db.count()).toBe(1005)
  })

  it('does nothing on an empty table', async () => {
    const db = magicDb([])
    expect(await purgeExpiredMagicWritebacks(db as any, now)).toBe(0)
  })
})
