/**
 * Side-effect-free rules used by the Lite paywall. Keeping these decisions
 * separate from feature-flag, storage, and Forge reads makes their business
 * boundaries explicit and lets executable specifications run without a
 * browser or network runtime.
 */
export const MACROS_LIMIT = 100
export const PAYWALL_WARNING_THRESHOLD = 85

export type PaywallPolicySource = 'default_on' | 'exemption' | 'fail_open'

export interface PaywallPolicyDecision {
  source: PaywallPolicySource
  enabled: boolean
}

/**
 * The Lite policy is on by default. An explicit exemption disables it;
 * an unknown policy value or a non-Lite product fails open.
 */
export function resolvePaywallPolicy(input: {
  isLite: boolean
  paywallExempt: boolean | undefined
}): PaywallPolicyDecision {
  if (!input.isLite || input.paywallExempt === undefined) {
    return { source: 'fail_open', enabled: false }
  }
  if (input.paywallExempt) {
    return { source: 'exemption', enabled: false }
  }
  return { source: 'default_on', enabled: true }
}

export interface PaywallDecision {
  actionRequired: boolean
  shouldBlockActions: boolean
  severity: 'normal' | 'warning' | 'critical'
}

/**
 * Evaluate the existing threshold, exemption/feature-policy, product, and
 * paid-space rules. This deliberately contains no runtime integrations.
 */
export function evaluatePaywallDecision(input: {
  macroCount: number
  isLite: boolean
  isPaid: boolean
  paywallEnabled: boolean
}): PaywallDecision {
  const severity = input.macroCount >= MACROS_LIMIT
    ? 'critical'
    : input.macroCount >= PAYWALL_WARNING_THRESHOLD
      ? 'warning'
      : 'normal'

  const actionRequired = input.isLite
    && !input.isPaid
    && input.macroCount >= PAYWALL_WARNING_THRESHOLD
    && input.paywallEnabled

  const shouldBlockActions = !input.isPaid
    && input.isLite
    && input.macroCount >= MACROS_LIMIT
    && input.paywallEnabled

  return { actionRequired, shouldBlockActions, severity }
}
