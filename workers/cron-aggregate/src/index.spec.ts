import { describe, expect, it, vi } from 'vitest'

import { purgeExpiredFeedbackAttachments } from './index'

function database(rows: Array<{ reportReference: string; screenshotObjectKey: string }>) {
  const updateRun = vi.fn(async () => ({ success: true }))
  const updateBind = vi.fn(() => ({ run: updateRun }))
  const selectAll = vi.fn(async () => ({ results: rows }))
  const selectBind = vi.fn(() => ({ all: selectAll }))
  return {
    prepare: vi.fn((sql: string) => sql.includes('SELECT reportReference')
      ? { bind: selectBind }
      : { bind: updateBind }),
    updateBind,
  }
}

describe('feedback attachment retention', () => {
  it('deletes expired private objects and clears only their D1 metadata', async () => {
    const db = database([{ reportReference: 'FBR-EXAMPLE1234', screenshotObjectKey: 'feedback/FBR-EXAMPLE1234/image' }])
    const bucket = { delete: vi.fn(async () => undefined) }

    const deleted = await purgeExpiredFeedbackAttachments(
      db as any,
      bucket as any,
      '2026-10-10T00:00:00.000Z',
    )

    expect(deleted).toBe(1)
    expect(bucket.delete).toHaveBeenCalledWith('feedback/FBR-EXAMPLE1234/image')
    expect(db.updateBind).toHaveBeenCalledWith('FBR-EXAMPLE1234', 'feedback/FBR-EXAMPLE1234/image')
  })

  it('keeps metadata when object deletion fails so a later run can retry', async () => {
    const db = database([{ reportReference: 'FBR-EXAMPLE1234', screenshotObjectKey: 'feedback/FBR-EXAMPLE1234/image' }])
    const bucket = { delete: vi.fn(async () => { throw new Error('R2 unavailable') }) }

    expect(await purgeExpiredFeedbackAttachments(db as any, bucket as any, '2026-10-10T00:00:00.000Z')).toBe(0)
    expect(db.updateBind).not.toHaveBeenCalled()
  })

  it('does nothing when the private bucket has not been configured', async () => {
    const db = database([])
    expect(await purgeExpiredFeedbackAttachments(db as any, undefined, '2026-10-10T00:00:00.000Z')).toBe(0)
    expect(db.prepare).not.toHaveBeenCalled()
  })
})
