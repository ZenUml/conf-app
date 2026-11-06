import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))
vi.mock('@/model/globals/forgeGlobal', () => ({ openModal: vi.fn() }))

import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { CREATE_GUIDE_MACRO_MODE, openCreateGuide, resetCreateGuideForTests } from './openCreateGuide'

const track = vi.mocked(trackAnalyticsEvent)

function setup(overrides: { reject?: Error } = {}) {
  let now = 1_000
  const openModal = vi.fn(async (_options: Record<string, unknown>) => {
    if (overrides.reject) throw overrides.reject
  })
  const open = () => openCreateGuide({ variant: 'graph', macroType: 'graph', hasEditPermission: true, openModal, now: () => now })
  const onClose = (payload?: unknown) => (openModal.mock.calls.at(-1)![0] as unknown as { onClose: (payload?: unknown) => void }).onClose(payload)
  return { openModal, open, onClose, advance: (ms: number) => { now += ms } }
}

describe('openCreateGuide', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetCreateGuideForTests()
  })

  it('opens an untitled medium Forge modal routed to the guide variant', async () => {
    const { openModal, open } = setup()
    await open()
    expect(openModal).toHaveBeenCalledTimes(1)
    expect(openModal.mock.calls[0][0]).toMatchObject({
      resource: 'main',
      size: 'medium',
      title: '',
      closeOnEscape: true,
      closeOnOverlayClick: true,
      context: { macroMode: CREATE_GUIDE_MACRO_MODE, createGuideVariant: 'graph' },
    })
  })

  it('tracks create_guide_opened from the viewer', async () => {
    const { open } = setup()
    await open()
    expect(track).toHaveBeenCalledWith('create_guide_opened', {
      feature_area: 'macro',
      surface: 'viewer',
      macro_type: 'graph',
      has_edit_permission: true,
      create_guide_variant: 'graph',
    })
  })

  it('tracks create_guide_closed with the method the guide reported and the time it was open', async () => {
    const { open, onClose, advance } = setup()
    await open()
    advance(3_500)
    onClose({ method: 'escape' })
    expect(track).toHaveBeenLastCalledWith('create_guide_closed', {
      feature_area: 'macro',
      surface: 'modal',
      macro_type: 'graph',
      create_guide_variant: 'graph',
      create_guide_close_method: 'escape',
      create_guide_watched_ms: 3_500,
    })
  })

  it.each([undefined, {}, { method: 'swipe' }, 'button'])('counts a close without a known guide method (%o) as a host close', async (payload) => {
    const { open, onClose } = setup()
    await open()
    onClose(payload)
    expect(track).toHaveBeenLastCalledWith('create_guide_closed', expect.objectContaining({ create_guide_close_method: 'host' }))
  })

  it('opens one guide at a time and allows another after it closes', async () => {
    const { openModal, open, onClose } = setup()
    await open()
    await open()
    expect(openModal).toHaveBeenCalledTimes(1)
    onClose({ method: 'button' })
    await open()
    expect(openModal).toHaveBeenCalledTimes(2)
  })

  it('tracks create_guide_open_failed and allows a retry when the bridge rejects', async () => {
    const { openModal, open } = setup({ reject: new Error('Unable to open modal.') })
    await open()
    expect(track).toHaveBeenLastCalledWith('create_guide_open_failed', {
      feature_area: 'macro',
      surface: 'viewer',
      macro_type: 'graph',
      create_guide_variant: 'graph',
      failure_reason: 'Unable to open modal.',
    })
    await open()
    expect(openModal).toHaveBeenCalledTimes(2)
  })
})
