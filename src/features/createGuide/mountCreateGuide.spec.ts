import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

const close = vi.fn()
vi.mock('@/model/globals/forgeGlobal', () => ({ getView: vi.fn(async () => ({ close })) }))

import { mountCreateGuideModal } from './mountCreateGuide'

const guideContext = (variant: unknown) => ({ extension: { modal: { macroMode: 'create-guide', createGuideVariant: variant } } })

describe('mountCreateGuideModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = '<div id="app"></div>'
  })

  it('mounts the guide for the variant the opener asked for', () => {
    expect(mountCreateGuideModal(guideContext('graph'))).toBe(true)
    expect(document.querySelector('video')?.getAttribute('src')).toMatch(/create-guide-graph\.mp4/)
  })

  it('falls back to the ZenUML guide when the variant is unknown', () => {
    mountCreateGuideModal(guideContext('board'))
    expect(document.querySelector('video')?.getAttribute('src')).toMatch(/create-guide-zenuml\.mp4/)
  })

  it('closes the Forge modal with the close method as the payload', async () => {
    mountCreateGuideModal(guideContext('api'))
    document.querySelector<HTMLButtonElement>('button[aria-label="Close guide"]')!.click()
    await flushPromises()
    expect(close).toHaveBeenCalledWith({ method: 'button' })
  })

  it('leaves other modals alone', () => {
    expect(mountCreateGuideModal({ extension: { modal: { macroMode: 'fullscreen' } } })).toBe(false)
    expect(document.querySelector('video')).toBeNull()
  })
})
