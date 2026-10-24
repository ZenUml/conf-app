// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

import { purgeExpiredFeedbackScreenshots, purgeExpiredMagicWritebacks } from './index'
import { purgeExpiredOAuthRefreshState } from './index'

// Use Node's built-in SQLite directly; no external database package is needed.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

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
    const sqlite = new DatabaseSync(':memory:')
    try {
      sqlite.exec(`CREATE TABLE FeedbackReport (
        reportReference TEXT PRIMARY KEY,
        screenshotData TEXT,
        screenshotContentType TEXT,
        screenshotExpiresAt TEXT
      )`)
      const insert = sqlite.prepare(`INSERT INTO FeedbackReport VALUES (?, ?, ?, ?)`)
      for (let i = 0; i < 103; i++) {
        insert.run(`expired-${i}`, 'image-bytes', 'image/png', '2026-10-09T00:00:00.000Z')
      }
      insert.run('fresh', 'fresh-image', 'image/png', '2026-10-11T00:00:00.000Z')
      insert.run('at-deadline', 'deadline-image', 'image/png', '2026-10-10T00:00:00.000Z')
      insert.run('no-image', null, null, '2026-10-09T00:00:00.000Z')

      const db = {
        prepare(sql: string) {
          return {
            bind(...values: unknown[]) {
              return {
                run() {
                  const result = sqlite.prepare(sql).run(...values as never[])
                  return { meta: { changes: Number(result.changes) } }
                },
              }
            },
          }
        },
      }
      const now = '2026-10-10T00:00:00.000Z'
      expect(await purgeExpiredFeedbackScreenshots(db as any, now)).toBe(100)
      expect(Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM FeedbackReport WHERE screenshotData IS NOT NULL AND screenshotExpiresAt <= ?`).get(now)?.count)).toBe(4)
      expect(sqlite.prepare(`SELECT screenshotData, screenshotExpiresAt FROM FeedbackReport WHERE reportReference = 'fresh'`).get())
        .toEqual({ screenshotData: 'fresh-image', screenshotExpiresAt: '2026-10-11T00:00:00.000Z' })

      expect(await purgeExpiredFeedbackScreenshots(db as any, now)).toBe(4)
      expect(Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM FeedbackReport WHERE screenshotData IS NOT NULL AND screenshotExpiresAt <= ?`).get(now)?.count)).toBe(0)
      expect(sqlite.prepare(`SELECT screenshotData, screenshotContentType, screenshotExpiresAt FROM FeedbackReport WHERE reportReference = 'at-deadline'`).get())
        .toEqual({ screenshotData: null, screenshotContentType: null, screenshotExpiresAt: null })
    } finally {
      sqlite.close()
    }
  })

  it('returns zero when no expired D1 screenshots are found', async () => {
    const db = database(0)
    expect(await purgeExpiredFeedbackScreenshots(db as any, '2026-10-10T00:00:00.000Z')).toBe(0)
  })
})

function sqliteD1() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE AgentLinkOAuthRefreshChain (
      issuer TEXT NOT NULL,
      chainId TEXT NOT NULL,
      revokedAtMs INTEGER,
      expiresAtMs INTEGER NOT NULL,
      PRIMARY KEY (issuer, chainId)
    );
    CREATE TABLE AgentLinkOAuthRefreshToken (
      issuer TEXT NOT NULL,
      tokenHash TEXT NOT NULL,
      chainId TEXT NOT NULL,
      userId TEXT NOT NULL,
      clientId TEXT NOT NULL,
      scope TEXT NOT NULL,
      resource TEXT NOT NULL,
      expiresAtMs INTEGER NOT NULL,
      legacy INTEGER NOT NULL DEFAULT 0,
      usedAtMs INTEGER,
      successorHash TEXT,
      rotationNonce TEXT UNIQUE,
      receiptCiphertext TEXT,
      receiptIv TEXT,
      receiptExpiresAtMs INTEGER,
      PRIMARY KEY (issuer, tokenHash),
      FOREIGN KEY (issuer, chainId) REFERENCES AgentLinkOAuthRefreshChain (issuer, chainId)
    );
  `)
  sqlite.exec('PRAGMA foreign_keys = ON')

  return {
    db: {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              run() {
                const result = sqlite.prepare(sql).run(...values as never[])
                return { meta: { changes: Number(result.changes) } }
              },
            }
          },
        }
      },
    } as any,
    sqlite,
  }
}

describe('Agent Link OAuth refresh state retention', () => {
  it('strips expired receipts while retaining replay metadata and chains with live tokens', async () => {
    const { db, sqlite } = sqliteD1()
    sqlite.prepare(`INSERT INTO AgentLinkOAuthRefreshChain VALUES (?, ?, ?, ?)`).run('issuer-a', 'live-chain', 123, 500)
    sqlite.prepare(`INSERT INTO AgentLinkOAuthRefreshToken
      (issuer, tokenHash, chainId, userId, clientId, scope, resource, expiresAtMs, usedAtMs, successorHash, rotationNonce, receiptCiphertext, receiptIv, receiptExpiresAtMs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('issuer-a', 'live-hash', 'live-chain', 'account-a', 'client-a', 'offline_access', 'resource-a', 2000, 100, 'next-hash', 'nonce-a', 'encrypted-receipt', 'iv-a', 900)

    const counts = await purgeExpiredOAuthRefreshState(db, 1000)

    expect(counts).toEqual({ receiptsStripped: 1, tokensDeleted: 0, chainsDeleted: 0 })
    expect(sqlite.prepare(`SELECT * FROM AgentLinkOAuthRefreshToken`).get()).toMatchObject({
      issuer: 'issuer-a', tokenHash: 'live-hash', chainId: 'live-chain',
      usedAtMs: 100, successorHash: 'next-hash', rotationNonce: 'nonce-a',
      receiptCiphertext: null, receiptIv: null, receiptExpiresAtMs: null,
    })
    expect(sqlite.prepare(`SELECT * FROM AgentLinkOAuthRefreshChain`).get()).toMatchObject({
      issuer: 'issuer-a', chainId: 'live-chain', revokedAtMs: 123,
    })
    sqlite.close()
  })

  it('retains an expired token row until its retry receipt window closes', async () => {
    const { db, sqlite } = sqliteD1()
    sqlite.prepare(`INSERT INTO AgentLinkOAuthRefreshChain VALUES (?, ?, ?, ?)`).run('issuer-a', 'retry-chain', null, 900)
    sqlite.prepare(`INSERT INTO AgentLinkOAuthRefreshToken
      (issuer, tokenHash, chainId, userId, clientId, scope, resource, expiresAtMs, usedAtMs, rotationNonce, receiptCiphertext, receiptIv, receiptExpiresAtMs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('issuer-a', 'retry-hash', 'retry-chain', 'account-a', 'client-a', 'offline_access', 'resource-a', 900, 800, 'nonce-retry', 'retry-response', 'retry-iv', 1100)

    const beforeReceiptExpiry = await purgeExpiredOAuthRefreshState(db, 1000)
    expect(beforeReceiptExpiry).toEqual({ receiptsStripped: 0, tokensDeleted: 0, chainsDeleted: 0 })
    expect(sqlite.prepare(`SELECT receiptCiphertext FROM AgentLinkOAuthRefreshToken`).get())
      .toMatchObject({ receiptCiphertext: 'retry-response' })

    const afterReceiptExpiry = await purgeExpiredOAuthRefreshState(db, 1100)
    expect(afterReceiptExpiry).toEqual({ receiptsStripped: 1, tokensDeleted: 1, chainsDeleted: 1 })
    expect(Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM AgentLinkOAuthRefreshToken`).get()?.count)).toBe(0)
    expect(Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM AgentLinkOAuthRefreshChain`).get()?.count)).toBe(0)
    sqlite.close()
  })

  it('deletes at most 1000 expired tokens across issuers and then expired chains', async () => {
    const { db, sqlite } = sqliteD1()
    const insertChain = sqlite.prepare(`INSERT INTO AgentLinkOAuthRefreshChain VALUES (?, ?, NULL, ?)`)
    const insertToken = sqlite.prepare(`INSERT INTO AgentLinkOAuthRefreshToken
      (issuer, tokenHash, chainId, userId, clientId, scope, resource, expiresAtMs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    insertChain.run('issuer-a', 'shared-chain', 900)
    insertChain.run('issuer-b', 'shared-chain', 900)
    for (let i = 0; i < 1002; i++) {
      const issuer = i % 2 ? 'issuer-a' : 'issuer-b'
      insertToken.run(issuer, `hash-${i}`, 'shared-chain', 'account', 'client', 'offline_access', 'resource', 900)
    }

    const first = await purgeExpiredOAuthRefreshState(db, 1000)
    expect(first.tokensDeleted).toBe(1000)
    // Children left after the token batch must protect their chain rows from
    // an FK violation and preserve the chain marker until they are removed.
    expect(first.chainsDeleted).toBe(0)
    expect(Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM AgentLinkOAuthRefreshToken`).get()?.count)).toBe(2)

    const second = await purgeExpiredOAuthRefreshState(db, 1000)
    expect(second.tokensDeleted).toBe(2)
    expect(second.chainsDeleted).toBe(2)
    expect(Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM AgentLinkOAuthRefreshChain`).get()?.count)).toBe(0)
    sqlite.close()
  })
})

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
