import { describe, expect, it, vi } from 'vitest'
vi.mock('@/model/globals/forgeGlobal', () => ({ default: { zenumlRemoteBaseUrl: 'https://conf-stg-lite.zenuml.com' } }))
import { enterpriseBundleCheckout } from './enterpriseBundleCheckout'

describe('space checkout link', () => {
  it('opens the handoff page on our backend host, not Stripe, with the row attribution', () => {
    expect(enterpriseBundleCheckout('example', 'ENG', { surface: 'plan_usage', baseUrl: 'https://conf-lite.zenuml.com', clickId: 'click-0001' })).toEqual({
      clientReferenceId: 'example__ENG',
      clickId: 'click-0001',
      url: 'https://conf-lite.zenuml.com/bundle-checkout?ref=example__ENG&space=ENG&surface=plan_usage&click=click-0001',
    })
  })

  it('uses the running variant backend host by default', () => {
    const { url } = enterpriseBundleCheckout('example', 'ENG', { surface: 'upgrade_prompt', clickId: 'click-0001' })
    expect(new URL(url).origin).toBe('https://conf-stg-lite.zenuml.com')
    expect(url).not.toContain('buy.stripe.com')
  })

  it('makes a click id the handoff page accepts', () => {
    const { clickId, url } = enterpriseBundleCheckout('example', 'ENG', { surface: 'plan_usage' })
    expect(clickId).toMatch(/^[A-Za-z0-9-]{8,64}$/)
    expect(new URL(url).searchParams.get('click')).toBe(clickId)
  })

  it('keeps the real space key for display and the sanitised one for Stripe', () => {
    const c = enterpriseBundleCheckout('example', '~abc123', { surface: 'plan_usage', clickId: 'click-0001' })
    expect(c.clientReferenceId).toBe('example___abc123')
    expect(new URL(c.url).searchParams.get('space')).toBe('~abc123')
    expect(enterpriseBundleCheckout('example', 'A'.repeat(250), { surface: 'plan_usage' }).clientReferenceId).toHaveLength(200)
  })
})
