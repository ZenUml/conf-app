import {
  evaluatePaywallDecision,
  resolvePaywallPolicy,
  type PaywallDecision,
  type PaywallPolicyDecision,
} from '../../src/utils/paywall/decision.ts'

type Row = Record<'Lite' | 'Paid' | 'Macros' | 'PAYWALL_EXEMPT', string>

/** Fixture for the executable Paywall business-rules specification. */
export class PaywallDecisionFixture {
  private policy: PaywallPolicyDecision = { source: 'fail_open', enabled: false }
  private decision: PaywallDecision = {
    actionRequired: false,
    shouldBlockActions: false,
    severity: 'normal',
  }

  /** The async fixture boundary proves Concordion awaits app-code evaluation. */
  async evaluateRow(row: Row): Promise<void> {
    await Promise.resolve()
    const isLite = row.Lite === 'true'
    const exempt = row.PAYWALL_EXEMPT === 'unknown'
      ? undefined
      : row.PAYWALL_EXEMPT === 'true'
    this.policy = resolvePaywallPolicy({ isLite, paywallExempt: exempt })
    this.decision = evaluatePaywallDecision({
      macroCount: Number(row.Macros),
      isLite,
      isPaid: row.Paid === 'true',
      paywallEnabled: this.policy.enabled,
    })
  }

  policySource(): string { return this.policy.source }
  actionRequired(): boolean { return this.decision.actionRequired }
  shouldBlockActions(): boolean { return this.decision.shouldBlockActions }
  severity(): string { return this.decision.severity }
}
