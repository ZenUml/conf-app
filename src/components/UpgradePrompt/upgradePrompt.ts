import type { Feature } from '@/components/UpgradePrompt/PricingOptionCard.vue'

export const MARKETPLACE_FEATURES: Feature[] = [
  { text: 'Unlimited macros (all spaces)', type: 'positive' },
  { text: 'Org-wide license', type: 'positive' },
  { text: 'Charges ALL users', type: 'warning', bold: true },
]

export const ENTERPRISE_BUNDLE_FEATURES: Feature[] = [
  { text: 'Unlimited macros and unlimited users (this space)', type: 'positive' },
  { text: 'Enterprise plan for https://app.zenuml.com', type: 'positive' },
  { text: 'Plus plan for https://diagramly.ai', type: 'positive' },
  { text: 'No Confluence Admin permission required', type: 'positive', bold: true },
  { text: 'Each space requires its own license', type: 'warning', bold: true },
]

export const MARKETPLACE_BEST_FOR = 'Multiple spaces heavily use this app'
export const ENTERPRISE_BUNDLE_BEST_FOR = 'Large user base but only a few spaces heavily use this app'

export const ENTERPRISE_BUNDLE_ANNUAL_COST = 299
export const ENTERPRISE_BUNDLE_MIN_MACROS = 100
