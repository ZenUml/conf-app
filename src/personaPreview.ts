import { createApp, h } from 'vue'
import './assets/tailwind.css'
import BystanderNotice from './components/UpgradePrompt/BystanderNotice.vue'
import HeavyCreatorPrompt from './components/UpgradePrompt/HeavyCreatorPrompt.vue'
import ComparisonView from './components/UpgradePrompt/ComparisonView.vue'

const params = new URLSearchParams(location.search)
const variant = params.get('variant') ?? 'bystander'

const variants: Record<string, () => ReturnType<typeof h>> = {
  bystander: () => h(BystanderNotice, {
    visible: true,
    spaceKey: 'ENG',
    requesterDisplayName: 'Eagle Xiao',
    onClose: () => {},
    onShowHeavyCreator: () => {},
  }),
  comparison: () => h(ComparisonView, {
    visible: true,
    upgradeUrl: 'https://example.com/upgrade',
    enterpriseBundleUrl: 'https://example.com/bundle',
    onClose: () => {},
  }),
  'heavy-admin-medium': () => h(HeavyCreatorPrompt, {
    visible: true,
    personalAuthored: 60,
    tenantSizeEstimate: 'medium_or_larger' as const,
    confluenceAdmin: true,
    upgradeUrl: 'https://example.com/upgrade',
    enterpriseBundleUrl: 'https://example.com/bundle',
    onClose: () => {},
  }),
  'heavy-non-admin': () => h(HeavyCreatorPrompt, {
    visible: true,
    personalAuthored: 60,
    tenantSizeEstimate: 'small_likely' as const,
    confluenceAdmin: false,
    upgradeUrl: 'https://example.com/upgrade',
    enterpriseBundleUrl: 'https://example.com/bundle',
    onClose: () => {},
  }),
  'heavy-admin-small': () => h(HeavyCreatorPrompt, {
    visible: true,
    personalAuthored: 60,
    tenantSizeEstimate: 'small_likely' as const,
    confluenceAdmin: true,
    upgradeUrl: 'https://example.com/upgrade',
    enterpriseBundleUrl: 'https://example.com/bundle',
    onClose: () => {},
  }),
}

const render = variants[variant] ?? variants.bystander

createApp({ render }).mount('#app')
