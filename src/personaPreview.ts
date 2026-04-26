import { createApp, h } from 'vue'
import './assets/tailwind.css'
import BystanderNotice from './components/UpgradePrompt/BystanderNotice.vue'
import HeavyCreatorPrompt from './components/UpgradePrompt/HeavyCreatorPrompt.vue'
import ComparisonView from './components/UpgradePrompt/ComparisonView.vue'
import DebugBar from './components/Debug/DebugBar.vue'

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
  'heavy-creator': () => h(HeavyCreatorPrompt, {
    visible: true,
    personalAuthored: 60,
    tenantSizeEstimate: 'small_likely' as const,
    upgradeUrl: 'https://example.com/upgrade',
    enterpriseBundleUrl: 'https://example.com/bundle',
    onClose: () => {},
  }),
  'debug-bar-clean': () => {
    for (const k of [
      'mockCSSEnabled','mockMacroCount','mockSpacePaid','mockPersonaAwarePaywall',
      'mockPersonalAuthored','mockTenantSizeEstimate','mockPersonaThreshold','mockNotifyAdmin',
    ]) localStorage.removeItem(k)
    return h(DebugBar)
  },
  'debug-bar-bystander': () => {
    localStorage.setItem('mockCSSEnabled', 'true')
    localStorage.setItem('mockMacroCount', '120')
    localStorage.setItem('mockSpacePaid', 'false')
    localStorage.setItem('mockPersonaAwarePaywall', 'true')
    localStorage.setItem('mockPersonalAuthored', '0')
    localStorage.setItem('mockTenantSizeEstimate', 'small_likely')
    localStorage.setItem('mockNotifyAdmin', '{"notified":true,"adminCount":1}')
    return h(DebugBar)
  },
}

const render = variants[variant] ?? variants.bystander

createApp({ render }).mount('#app')
