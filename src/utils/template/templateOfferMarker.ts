import type { WarningBannerIdentity } from '@/utils/paywall/warningBanner'

export const TEMPLATE_OFFER_MIN = 50
export const TEMPLATE_OFFER_MAX = 84
const DISMISS_WINDOW_MS = 30 * 86_400_000

interface TemplateOfferMarker {
  createdAt?: string
  dismissedAt?: string
}

export function isInTemplateOfferBand(macroCount: number | undefined): boolean {
  return typeof macroCount === 'number'
    && Number.isFinite(macroCount)
    && macroCount >= TEMPLATE_OFFER_MIN
    && macroCount <= TEMPLATE_OFFER_MAX
}

function markerKey(identity: WarningBannerIdentity): string {
  return `zenumlTemplateOffer:${encodeURIComponent(identity.clientDomain)}:${encodeURIComponent(identity.spaceKey)}`
}

function readMarker(identity: WarningBannerIdentity): TemplateOfferMarker | null {
  try {
    const raw = localStorage.getItem(markerKey(identity))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function writeMarker(identity: WarningBannerIdentity, marker: TemplateOfferMarker): void {
  try {
    localStorage.setItem(markerKey(identity), JSON.stringify(marker))
  } catch {
    // Storage is best effort: an unavailable iframe must not leave a banner open.
  }
}

export function markTemplateCreated(identity: WarningBannerIdentity, now: number = Date.now()): void {
  writeMarker(identity, { ...readMarker(identity), createdAt: new Date(now).toISOString() })
}

export function markTemplateOfferDismissed(identity: WarningBannerIdentity, now: number = Date.now()): void {
  writeMarker(identity, { ...readMarker(identity), dismissedAt: new Date(now).toISOString() })
}

export function isTemplateOfferSuppressed(identity: WarningBannerIdentity, now: number = Date.now()): boolean {
  const marker = readMarker(identity)
  if (!marker) return false
  if (marker.createdAt) return true
  if (!marker.dismissedAt) return false
  const dismissedAt = Date.parse(marker.dismissedAt)
  return Number.isFinite(dismissedAt) && now - dismissedAt < DISMISS_WINDOW_MS
}
