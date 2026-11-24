import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createIntroSeenStore, introPropertyKey } from './seen'

const author = { accountId: 'author:1', cloudId: 'example-cloud' }
const otherAuthor = { ...author, accountId: 'author:2' }

describe('Mermaid introduction seen state', () => {
  beforeEach(() => localStorage.clear())

  it('writes only after a display and stores each type and account independently', async () => {
    const properties = new Set<string>()
    const request = vi.fn(async (url: string, method: string) => {
      if (method === 'POST') {
        properties.add(url)
        return new Response(null, { status: 201 })
      }
      return new Response(null, { status: properties.has(url) ? 200 : 404 })
    })

    const firstVisit = createIntroSeenStore(request)
    expect(await firstVisit.seen(author, 'sequence')).toBe(false)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(
      `/wiki/rest/api/user/author%3A1/property/${introPropertyKey('sequence')}`, 'GET',
    )
    firstVisit.record(author, 'sequence')
    expect(firstVisit.cached(author, 'sequence')).toBe(true)

    localStorage.clear()
    const anotherBrowser = createIntroSeenStore(request)
    expect(await anotherBrowser.seen(author, 'sequence')).toBe(true)
    expect(await anotherBrowser.seen(author, 'flowchart')).toBe(false)
    expect(await anotherBrowser.seen(otherAuthor, 'sequence')).toBe(false)
    anotherBrowser.record(author, 'flowchart')
    expect(properties.size).toBe(2)
  })

  it('keeps an immediate exit recorded locally and retries a failed write on a new session', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('iframe closed'))
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
    createIntroSeenStore(request).record(author, 'flowchart')
    await Promise.resolve()

    const nextVisit = createIntroSeenStore(request)
    expect(await nextVisit.seen(author, 'flowchart')).toBe(true)
    expect(await nextVisit.seen(author, 'flowchart')).toBe(true)
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls.every(([, method]) => method === 'POST')).toBe(true)
  })

  it('leaves eligibility unknown when reading the user property fails', async () => {
    const request = vi.fn(async () => new Response(null, { status: 403 }))
    const store = createIntroSeenStore(request)
    expect(await store.seen(author, 'sequence')).toBeUndefined()
    expect(store.cached(author, 'sequence')).toBe(false)
    expect(request).toHaveBeenCalledTimes(1)
  })
})
