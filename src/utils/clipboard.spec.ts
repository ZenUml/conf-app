import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeClipboard } from '@/utils/clipboard'

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

function stubExecCommand(impl: () => boolean) {
  const fn = vi.fn(impl)
  Object.defineProperty(document, 'execCommand', { value: fn, configurable: true, writable: true })
  return fn
}

describe('writeClipboard', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    setClipboard(undefined)
    vi.restoreAllMocks()
  })

  it('returns true when the async Clipboard API succeeds, without the fallback', async () => {
    const writeText = vi.fn(async () => {})
    setClipboard({ writeText })
    const exec = stubExecCommand(() => true)

    await expect(writeClipboard('hello')).resolves.toBe(true)

    expect(writeText).toHaveBeenCalledWith('hello')
    expect(exec).not.toHaveBeenCalled()
  })

  it('falls back to execCommand when the async API rejects, and removes the textarea', async () => {
    setClipboard({ writeText: vi.fn(async () => { throw new Error('denied') }) })
    let copiedValue: string | undefined
    const exec = stubExecCommand(() => {
      // The textarea must be in the DOM, holding the text, while the command runs.
      copiedValue = document.querySelector('textarea')?.value
      return true
    })

    await expect(writeClipboard('fallback text')).resolves.toBe(true)

    expect(exec).toHaveBeenCalledWith('copy')
    expect(copiedValue).toBe('fallback text')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('returns false when both the async API and the fallback fail', async () => {
    setClipboard({ writeText: vi.fn(async () => { throw new Error('denied') }) })
    stubExecCommand(() => false)

    await expect(writeClipboard('nope')).resolves.toBe(false)
    expect(document.querySelector('textarea')).toBeNull()
  })
})
