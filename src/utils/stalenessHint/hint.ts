import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import type { MacroTypeValue } from '@/utils/analytics/catalog'
import { writeDismissMarker } from './core'
import './hint.css'

/**
 * Vanilla-DOM strip + attention ring, mounted directly on the iframe body so
 * it stays decoupled from the viewer component tree. English product copy —
 * facts and permissions, no persuasion (design decision 2026-07-18).
 */

export interface MountOpts {
  drift: number
  isDiagramAuthor: boolean
  macroType: string
  ccId: string
  onCta: () => void
}

const RING_SETTLE_MS = 6000

export function mountStalenessHint(opts: MountOpts): void {
  if (document.querySelector('.staleness-hint')) return

  const props = {
    feature_area: 'macro' as const,
    surface: 'editor' as const,
    drift_count: opts.drift,
    is_diagram_author: opts.isDiagramAuthor,
    macro_type: opts.macroType as MacroTypeValue,
  }

  const ring = document.createElement('div')
  ring.className = 'staleness-ring'

  const strip = document.createElement('div')
  strip.className = 'staleness-hint'

  const text = document.createElement('span')
  text.className = 'staleness-hint__text'
  text.textContent = opts.isDiagramAuthor
    ? `This page has changed ${opts.drift} times since this diagram was last updated — it may need a refresh.`
    : `This page has changed ${opts.drift} times since this diagram was last updated — it may be out of date. Anyone with page edit access can update it.`

  const cta = document.createElement('button')
  cta.className = 'staleness-hint__cta'
  cta.type = 'button'
  cta.textContent = 'Update diagram'
  cta.addEventListener('click', () => {
    trackAnalyticsEvent('staleness_hint_clicked', props)
    opts.onCta()
  })

  const dismiss = document.createElement('button')
  dismiss.className = 'staleness-hint__dismiss'
  dismiss.type = 'button'
  dismiss.setAttribute('aria-label', 'Dismiss')
  dismiss.textContent = '✕'
  dismiss.addEventListener('click', () => {
    writeDismissMarker(opts.ccId)
    trackAnalyticsEvent('staleness_hint_dismissed', props)
    strip.remove()
    ring.remove()
  })

  strip.append(text, cta, dismiss)
  document.body.append(ring, strip)

  window.setTimeout(() => ring.classList.add('staleness-ring--settled'), RING_SETTLE_MS)

  trackAnalyticsEvent('staleness_hint_shown', props)
}
