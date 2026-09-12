import { beforeEach, describe, expect, it } from 'vitest'
import { isInTemplateOfferBand, isTemplateOfferSuppressed, markTemplateCreated, markTemplateOfferDismissed } from './templateOfferMarker'

const identity = { clientDomain: 'example-tenant', spaceKey: 'ENG' }
const now = Date.parse('2026-09-01T00:00:00Z')

beforeEach(() => localStorage.clear())

describe('template offer marker', () => {
  it('uses the cached activation band only from 50 through 84 diagrams', () => {
    expect(isInTemplateOfferBand(49)).toBe(false)
    expect(isInTemplateOfferBand(50)).toBe(true)
    expect(isInTemplateOfferBand(84)).toBe(true)
    expect(isInTemplateOfferBand(85)).toBe(false)
    expect(isInTemplateOfferBand(undefined)).toBe(false)
  })

  it('does not re-offer a template after it has been created', () => {
    markTemplateCreated(identity, now)
    expect(isTemplateOfferSuppressed(identity, now + 400 * 86_400_000)).toBe(true)
  })

  it('reoffers after the thirty-day dismissal window expires', () => {
    markTemplateOfferDismissed(identity, now)
    expect(isTemplateOfferSuppressed(identity, now + 29 * 86_400_000)).toBe(true)
    expect(isTemplateOfferSuppressed(identity, now + 30 * 86_400_000)).toBe(false)
  })
})
