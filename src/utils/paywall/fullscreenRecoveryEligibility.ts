import { MACROS_LIMIT } from '@/composables/useCustomerSuccessService';

/** Recovery is only for confirmed over-limit spaces; ordinary Fullscreen never needs a grant. */
export function isFullscreenRecoveryEligible(input: {
  isLite: boolean; count: number; countSource: string; paidKnown: boolean; paid: boolean;
  policySource: string; spaceKey: string | undefined;
}): boolean {
  return input.isLite && input.paidKnown && !input.paid
    && ['default_on', 'exemption'].includes(input.policySource)
    && ['kv', 'collect', 'mock'].includes(input.countSource)
    && Number.isFinite(input.count) && input.count >= MACROS_LIMIT
    && typeof input.spaceKey === 'string' && input.spaceKey.length > 0;
}
