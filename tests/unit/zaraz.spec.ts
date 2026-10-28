import { afterEach, describe, expect, it, vi } from 'vitest'
import { postData } from '../../functions/utils/zaraz'

describe('zaraz postData (#939)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sends valid JSON even when a value contains a double quote', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))
    await postData('uninstalled', 'app"key', 'client', 'example.atlassian.net')
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]!.body))
    expect(body.events[0].client).toMatchObject({ __zarazTrack: 'uninstalled', appKey: 'app"key', value: '200' })
  })

  it('gives the request a timeout', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))
    await postData('uninstalled', 'a', 'c', 's')
    expect(fetchSpy.mock.calls[0][1]!.signal).toBeInstanceOf(AbortSignal)
  })
})
