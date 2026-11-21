import { describe, expect, it, vi } from 'vitest'
import { nativeThreadPath, openNativeThread, replyFromClosePayload } from './nativeThread'

const PAGE_URL = 'https://example.atlassian.net/wiki/spaces/OP/pages/42/Checkout?zenumlDiagram=cc-1&zn=abc#frag'

describe('nativeThreadPath', () => {
  it('targets the page with only focusedCommentId, as a site-relative path', () => {
    expect(nativeThreadPath(PAGE_URL, '777')).toBe('/wiki/spaces/OP/pages/42/Checkout?focusedCommentId=777')
  })
  it('returns null for a url it cannot parse', () => {
    expect(nativeThreadPath('not a url', '777')).toBeNull()
  })
})

describe('openNativeThread', () => {
  it('navigates the host page, then closes the modal', async () => {
    const order: string[] = []
    const navigate = vi.fn(async () => { order.push('navigate') })
    const close = vi.fn(async () => { order.push('close') })
    const result = await openNativeThread({ pageUrl: PAGE_URL, commentId: '777', navigate, close })
    expect(navigate).toHaveBeenCalledWith('/wiki/spaces/OP/pages/42/Checkout?focusedCommentId=777')
    expect(close).toHaveBeenCalledWith()
    expect(order).toEqual(['navigate', 'close'])
    expect(result).toBe('navigated')
  })

  it('falls back to closing with a payload for the macro iframe to act on when navigate fails', async () => {
    const navigate = vi.fn(async () => { throw new Error('not allowed from a modal') })
    const close = vi.fn(async () => undefined)
    const result = await openNativeThread({ pageUrl: PAGE_URL, commentId: '777', navigate, close })
    expect(close).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledWith({ action: 'reply', commentId: '777' })
    expect(result).toBe('handed_back')
  })

  it('hands back when the url is unusable', async () => {
    const navigate = vi.fn()
    const close = vi.fn(async () => undefined)
    expect(await openNativeThread({ pageUrl: '', commentId: '777', navigate, close })).toBe('handed_back')
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('replyFromClosePayload', () => {
  it('accepts only the reply payload', () => {
    expect(replyFromClosePayload({ action: 'reply', commentId: '777' })).toEqual({ commentId: '777' })
    expect(replyFromClosePayload({ action: 'reply' })).toBeNull()
    expect(replyFromClosePayload({ action: 'other', commentId: '1' })).toBeNull()
    expect(replyFromClosePayload(undefined)).toBeNull()
    expect(replyFromClosePayload('x')).toBeNull()
  })
})
