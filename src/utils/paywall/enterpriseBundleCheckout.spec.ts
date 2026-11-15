import { describe, expect, it } from 'vitest'
import { enterpriseBundleCheckout } from './enterpriseBundleCheckout'
describe('space checkout attribution', () => {
  it('attributes checkout to the explicit row', () => {
    expect(enterpriseBundleCheckout('example', 'ENG')).toEqual({ clientReferenceId: 'example__ENG', url: 'https://buy.stripe.com/cNifZifkN7hzavK12H7IY05?client_reference_id=example__ENG' })
  })
  it('preserves personal-space sanitization and Stripe length limit', () => {
    expect(enterpriseBundleCheckout('example', '~abc123').clientReferenceId).toBe('example___abc123')
    expect(enterpriseBundleCheckout('example', 'A'.repeat(250)).clientReferenceId).toHaveLength(200)
  })
})
