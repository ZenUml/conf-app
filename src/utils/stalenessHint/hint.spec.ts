import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))
vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: () => 'example-tenant',
}))

import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { mountStalenessHint } from './hint'
import { readDismissMarker } from './core'

const baseOpts = () => ({
  drift: 12,
  isDiagramAuthor: false,
  macroType: 'sequence',
  ccId: 'cc-9',
  onCta: vi.fn(),
})

describe('mountStalenessHint', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('mounts strip + ring, tracks shown with props', () => {
    mountStalenessHint(baseOpts())
    expect(document.querySelector('.staleness-hint')).not.toBeNull()
    expect(document.querySelector('.staleness-ring')).not.toBeNull()
    expect(document.querySelector('.staleness-hint')!.textContent).toContain('12')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('staleness_hint_shown', {
      feature_area: 'macro',
      surface: 'editor',
      drift_count: 12,
      is_diagram_author: false,
      macro_type: 'sequence',
    })
  })

  it('non-author copy includes the permission fact; author copy does not', () => {
    mountStalenessHint(baseOpts())
    expect(document.querySelector('.staleness-hint')!.textContent).toContain('edit access')
    document.body.innerHTML = ''
    mountStalenessHint({ ...baseOpts(), isDiagramAuthor: true })
    expect(document.querySelector('.staleness-hint')!.textContent).not.toContain('edit access')
  })

  it('CTA click calls onCta and tracks clicked', () => {
    const opts = baseOpts()
    mountStalenessHint(opts)
    ;(document.querySelector('.staleness-hint__cta') as HTMLButtonElement).click()
    expect(opts.onCta).toHaveBeenCalledTimes(1)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('staleness_hint_clicked', expect.objectContaining({ drift_count: 12 }))
  })

  it('dismiss removes strip and ring, writes the 30d marker, tracks dismissed', () => {
    mountStalenessHint(baseOpts())
    ;(document.querySelector('.staleness-hint__dismiss') as HTMLButtonElement).click()
    expect(document.querySelector('.staleness-hint')).toBeNull()
    expect(document.querySelector('.staleness-ring')).toBeNull()
    expect(readDismissMarker('cc-9')).not.toBeNull()
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('staleness_hint_dismissed', expect.objectContaining({ drift_count: 12 }))
  })

  it('mounting twice does not duplicate the strip', () => {
    mountStalenessHint(baseOpts())
    mountStalenessHint(baseOpts())
    expect(document.querySelectorAll('.staleness-hint').length).toBe(1)
  })
})
