import { describe, expect, it, vi } from 'vitest'

import { purgeExpiredFeedbackScreenshots } from './index'

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
