import { beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { MCP_BUTTON_LABEL, MCP_BUTTON_VARIANT_OVERRIDE_KEY, canEditPageCached, mcpButtonVariant } from './mcpButtonExperiment'

describe('mcpButtonVariant', () => {
  beforeEach(() => localStorage.clear())

  it('keeps viewers without an account on the control arm', () => {
    expect(mcpButtonVariant(null)).toBe('control')
    expect(mcpButtonVariant(undefined)).toBe('control')
    expect(mcpButtonVariant('')).toBe('control')
  })

  it('gives one account the same arm every time', () => {
    const id = '5570583731f1897e5846c0b5c7697c5a021aee'
    expect(new Set(Array.from({ length: 5 }, () => mcpButtonVariant(id))).size).toBe(1)
  })

  it('splits accounts roughly in half', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `557058:${i.toString(16).padStart(8, '0')}-acct`)
    const treated = ids.filter((id) => mcpButtonVariant(id) === 'outcome_label').length
    expect(treated / ids.length).toBeGreaterThan(0.45)
    expect(treated / ids.length).toBeLessThan(0.55)
  })

  it('obeys the QA override in either direction, and ignores junk', () => {
    localStorage.setItem(MCP_BUTTON_VARIANT_OVERRIDE_KEY, 'outcome_label')
    expect(mcpButtonVariant(null)).toBe('outcome_label')
    localStorage.setItem(MCP_BUTTON_VARIANT_OVERRIDE_KEY, 'control')
    expect(mcpButtonVariant('any-account')).toBe('control')
    localStorage.setItem(MCP_BUTTON_VARIANT_OVERRIDE_KEY, 'bogus')
    expect(mcpButtonVariant(null)).toBe('control')
  })

  it('labels the arms', () => {
    expect(MCP_BUTTON_LABEL).toEqual({ control: 'MCP', outcome_label: 'Use with AI' })
  })
})

describe('canEditPageCached', () => {
  beforeEach(() => localStorage.clear())

  it('asks once per page and account within a day, then asks again', async () => {
    const ask = vi.fn(() => Promise.resolve(true))
    let t = 1_000_000
    expect(await canEditPageCached('42', 'acct', ask, () => t)).toBe(true)
    t += 60 * 60 * 1000
    expect(await canEditPageCached('42', 'acct', ask, () => t)).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
    await canEditPageCached('43', 'acct', ask, () => t)
    expect(ask).toHaveBeenCalledTimes(2)
    t += 25 * 60 * 60 * 1000
    await canEditPageCached('42', 'acct', ask, () => t)
    expect(ask).toHaveBeenCalledTimes(3)
  })

  it('treats a failed check as cannot edit', async () => {
    expect(await canEditPageCached('42', 'acct', () => Promise.reject(new Error('403')))).toBe(false)
  })
})
