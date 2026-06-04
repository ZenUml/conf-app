import { ref, computed } from 'vue'
import getFeatureFlagsForCurrentDomain from "@/apis/featureFlags"
import macroMetrics from "@/services/MacroMetrics"
import { getClientDomain } from "@/utils/ContextParameters/ContextParameters"
import globals from '@/model/globals'
import { callRemote } from '@/utils/requestUtil'
import { writeTargetingMarker, toMarkerSeverity } from '@/utils/paywall/warningBanner'

export const MACROS_LIMIT = 100
const WARNING_THRESHOLD = 85
const BASE_UPGRADE_URL = 'https://marketplace.atlassian.com/apps/1218380/zenuml-sequence-diagram'
const BASE_LEARN_MORE_URL = 'https://zenuml.com/upgrade'

const macrosCreated = ref<number>(0)
const customerSuccessServiceEnabled = ref<boolean>(false)
const spacePaidStatus = ref<boolean>(false)
const currentSpaceKey = ref<string>('')

let macroMetricsLoaded = false;
let cssFlagLoaded = false;
let spacePaidStatusLoaded = false;
let spaceKeyLoaded = false;

export function useCustomerSuccessService() {
  const actionRequired = computed(() => {
    if (!globals.apWrapper.isLite()) return false
    if (spacePaidStatus.value) return false
    return macrosCreated.value >= WARNING_THRESHOLD && customerSuccessServiceEnabled.value
  })

  const shouldBlockActions = computed(() => {
    if (spacePaidStatus.value) {
      console.log('✅ Space is paid - bypassing all restrictions')
      return false
    }

    const isLite = globals.apWrapper.isLite()
    const shouldBlock = macrosCreated.value >= MACROS_LIMIT && customerSuccessServiceEnabled.value && isLite
    console.log('🚫 shouldBlockActions check:', {
      macrosCreated: macrosCreated.value,
      macrosLimit: MACROS_LIMIT,
      featureFlagEnabled: customerSuccessServiceEnabled.value,
      isLite,
      spacePaid: spacePaidStatus.value,
      shouldBlock
    })
    return shouldBlock
  })

  const severity = computed(() => {
    if (macrosCreated.value >= MACROS_LIMIT) return 'critical'
    if (macrosCreated.value >= WARNING_THRESHOLD) return 'warning'
    return 'normal'
  })

  const upgradeUrl = computed(() => {
    const domain = getClientDomain()
    return `${BASE_UPGRADE_URL}?domain=${domain}`
  })

  const enterpriseBundleUrl = computed(() => {
    return 'https://buy.stripe.com/cNifZifkN7hzavK12H7IY05'
  })

  const learnMoreUrl = computed(() => {
    const domain = getClientDomain()
    return `${BASE_LEARN_MORE_URL}?domain=${domain}`
  })

  async function loadMacroMetrics(): Promise<void> {
    if (macroMetricsLoaded) {
      return;
    }

    try {
      if (localStorage.mockMacroCount) {
        const mockCount = parseInt(localStorage.mockMacroCount)
        if (!isNaN(mockCount) && mockCount >= 0) {
          macrosCreated.value = mockCount
          console.log('🧪 Using mock macro count:', macrosCreated.value)
          macroMetricsLoaded = true;
          return;
        }
      }

      const metrics = await macroMetrics.getMacroMetrics()
      if (metrics?.total) {
        macrosCreated.value = metrics.total
      }
      macroMetricsLoaded = true;
    } catch (error) {
      console.error('Error loading macro metrics:', error)
    }
  }

  async function loadCSSFeatureFlag(): Promise<void> {
    if (cssFlagLoaded) {
      console.log('🏁 Feature flag already loaded, skipping')
      return;
    }

    try {
      if (localStorage.mockCSSEnabled !== undefined) {
        customerSuccessServiceEnabled.value = localStorage.mockCSSEnabled === 'true'
        console.log('🧪 Using mock CSS Feature Flag:', customerSuccessServiceEnabled.value)
        cssFlagLoaded = true;
        return;
      }

      console.log('🔍 Loading CUSTOMER_SUCCESS_SERVICE feature flag...')
      const flags: any = await getFeatureFlagsForCurrentDomain(['CUSTOMER_SUCCESS_SERVICE'])
      customerSuccessServiceEnabled.value = !!flags.CUSTOMER_SUCCESS_SERVICE
      console.log('✅ Feature flag loaded:', {
        CUSTOMER_SUCCESS_SERVICE: flags.CUSTOMER_SUCCESS_SERVICE,
        enabled: customerSuccessServiceEnabled.value,
      })
      cssFlagLoaded = true;
    } catch (error) {
      console.error("❌ Error loading CSS feature flag:", error);
    }
  }

  async function loadSpaceKey(): Promise<void> {
    if (spaceKeyLoaded) return;

    if (localStorage.mockSpaceKey) {
      currentSpaceKey.value = localStorage.mockSpaceKey
      spaceKeyLoaded = true
      return;
    }

    try {
      const space = await globals.apWrapper.getCurrentSpace()
      currentSpaceKey.value = space?.key || ''
    } catch (e) {
      console.warn('Could not get spaceKey from page context:', e)
    } finally {
      spaceKeyLoaded = true
    }
  }

  async function loadSpacePaidStatus(): Promise<void> {
    if (spacePaidStatusLoaded) {
      console.log('💳 Space paid status already loaded, skipping')
      return;
    }

    if (!globals.apWrapper.isLite()) {
      spacePaidStatus.value = true;
      spacePaidStatusLoaded = true;
      console.log('💳 Full app — skipping space-status check, no restrictions apply')
      return;
    }

    try {
      if (localStorage.mockSpacePaid !== undefined) {
        spacePaidStatus.value = localStorage.mockSpacePaid === 'true'
        console.log('🧪 Using mock space paid status:', spacePaidStatus.value)
        spacePaidStatusLoaded = true;
        return;
      }

      await loadSpaceKey()
      const spaceKey = currentSpaceKey.value

      console.log('🔍 Checking space paid status...')
      const response = await callRemote(`/api/space-status?spaceKey=${encodeURIComponent(spaceKey)}`, 'GET')

      if (response && typeof response.isPaid === 'boolean') {
        spacePaidStatus.value = response.isPaid
        console.log('💳 Space paid status:', {
          isPaid: response.isPaid,
          source: response.source,
        })
      }

      spacePaidStatusLoaded = true;
    } catch (error) {
      console.error("❌ Error loading space paid status:", error);
      spacePaidStatus.value = false;
      spacePaidStatusLoaded = true;
    }
  }

  // Paywall page-banner targeting (Phase 3 redesign). Persist a per-space marker
  // so the global page-banner iframe — which has no live macro context — can
  // decide visibility on a LATER page load purely from localStorage, no backend
  // call (CSAT-style cross-load signal). Single-writer: only the macro iframe
  // writes this key. Lite-only; Full/Diagramly spaces are unrestricted.
  // Identity is derived via the shared helper (getClientDomain + getSpaceKey) so
  // the macro-side write and banner-side read produce byte-identical keys.
  function persistTargetingMarker() {
    if (!globals.apWrapper.isLite()) return;
    try {
      writeTargetingMarker({
        severity: toMarkerSeverity(severity.value),
        macroCount: macrosCreated.value,
        spacePaid: spacePaidStatus.value,
        customerSuccessServiceEnabled: customerSuccessServiceEnabled.value,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[paywall-banner] failed to persist targeting marker', e);
    }
  }

  const initialize = async () => {
    await Promise.all([
      loadMacroMetrics(),
      loadCSSFeatureFlag(),
      loadSpacePaidStatus(),
      loadSpaceKey(),
    ]);
    persistTargetingMarker();
  }

  return {
    macrosCreated,
    spaceKey: currentSpaceKey,
    actionRequired,
    shouldBlockActions,
    severity,
    upgradeUrl,
    enterpriseBundleUrl,
    learnMoreUrl,
    spacePaid: spacePaidStatus,
    initialize,
  }
}

;(useCustomerSuccessService as any).__resetForTests = () => {
  macrosCreated.value = 0
  customerSuccessServiceEnabled.value = false
  spacePaidStatus.value = false
  currentSpaceKey.value = ''
  macroMetricsLoaded = false
  cssFlagLoaded = false
  spacePaidStatusLoaded = false
  spaceKeyLoaded = false
}

export function getUpgradeContext() {
  return {
    macro_count: macrosCreated.value,
    macro_limit: MACROS_LIMIT,
    macro_usage_pct: Math.round((macrosCreated.value / MACROS_LIMIT) * 100),
    space_key: currentSpaceKey.value,
  };
}
