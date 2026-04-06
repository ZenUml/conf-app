import { ref, computed } from 'vue'
import getFeatureFlagsForCurrentDomain from "@/apis/featureFlags"
import { trackUpgradeEvent, UpgradeEventName } from "@/utils/upgradeTracking"
import macroMetrics from "@/services/MacroMetrics"
import { getClientDomain } from "@/utils/ContextParameters/ContextParameters"
import globals from '@/model/globals'
import { callRemote } from '@/utils/requestUtil'

// Constants that both components use
export const MACROS_LIMIT = 100
const WARNING_THRESHOLD = 85
const BASE_UPGRADE_URL = 'https://marketplace.atlassian.com/apps/1218380/zenuml-sequence-diagram'
const BASE_LEARN_MORE_URL = 'https://zenuml.com/upgrade'

// Shared reactive state across all component instances
const macrosCreated = ref<number>(0)
const customerSuccessServiceEnabled = ref<boolean>(false)
const spacePaidStatus = ref<boolean>(false)

// Cache flags to track if data has been loaded
let macroMetricsLoaded = false;
let cssFlagLoaded = false;
let spacePaidStatusLoaded = false;

export function useCustomerSuccessService() {
  const actionRequired = computed(() => {
    if (!globals.apWrapper.isLite()) return false
    if (spacePaidStatus.value) return false
    return macrosCreated.value >= WARNING_THRESHOLD && customerSuccessServiceEnabled.value
  })

  const shouldBlockActions = computed(() => {
    // If space is paid, never block actions
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
      // Check for mock override (for testing)
      if (localStorage.mockMacroCount) {
        const mockCount = parseInt(localStorage.mockMacroCount)
        if (!isNaN(mockCount) && mockCount >= 0) {
          macrosCreated.value = mockCount
          console.log('🧪 Using mock macro count:', macrosCreated.value)
          macroMetricsLoaded = true;
          return;
        }
      }
      
      // Normal platform data
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
      // Check for mock override first (for testing)
      if (localStorage.mockCSSEnabled !== undefined) {
        customerSuccessServiceEnabled.value = localStorage.mockCSSEnabled === 'true'
        console.log('🧪 Using mock CSS Feature Flag:', customerSuccessServiceEnabled.value)
        cssFlagLoaded = true;
        return;
      }

      console.log('🔍 Loading CUSTOMER_SUCCESS_SERVICE feature flag...')
      const customerSuccessService: any = await getFeatureFlagsForCurrentDomain(['CUSTOMER_SUCCESS_SERVICE'])
      customerSuccessServiceEnabled.value = !!customerSuccessService.CUSTOMER_SUCCESS_SERVICE
      console.log('✅ Feature flag loaded:', {
        CUSTOMER_SUCCESS_SERVICE: customerSuccessService.CUSTOMER_SUCCESS_SERVICE,
        enabled: customerSuccessServiceEnabled.value
      })
      if (customerSuccessServiceEnabled.value) {
        trackUpgradeEvent(UpgradeEventName.FEATURE_ENABLED, {
          feature_name: 'customer_success_service',
        })
      }
      cssFlagLoaded = true;
    } catch (error) {
      console.error("❌ Error loading CSS feature flag:", error);
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
      // Check for mock override first (for testing)
      if (localStorage.mockSpacePaid !== undefined) {
        spacePaidStatus.value = localStorage.mockSpacePaid === 'true'
        console.log('🧪 Using mock space paid status:', spacePaidStatus.value)
        spacePaidStatusLoaded = true;
        return;
      }

      // Get spaceKey from the page context to pass to the KV-based license check
      let spaceKey = ''
      try {
        const space = await globals.apWrapper.getCurrentSpace()
        spaceKey = space?.key || ''
      } catch (e) {
        console.warn('Could not get spaceKey from page context:', e)
      }

      console.log('🔍 Checking space paid status...')
      const response = await callRemote(`/api/space-status?spaceKey=${encodeURIComponent(spaceKey)}`, 'GET')

      if (response && typeof response.isPaid === 'boolean') {
        spacePaidStatus.value = response.isPaid
        console.log('💳 Space paid status:', {
          isPaid: response.isPaid,
          source: response.source,
          licenseStatus: response.licenseStatus,
          accountType: response.accountType
        })

        if (response.isPaid) {
          trackUpgradeEvent(UpgradeEventName.FEATURE_ENABLED, {
            feature_name: 'paid_space_detected',
            source: response.source
          })
        }
      }

      spacePaidStatusLoaded = true;
    } catch (error) {
      console.error("❌ Error loading space paid status:", error);
      // Default to false (unpaid) if we can't determine the status
      spacePaidStatus.value = false;
      spacePaidStatusLoaded = true;
    }
  }

  const initialize = async () => {
    // Load all data in parallel for better performance
    await Promise.all([
      loadMacroMetrics(),
      loadCSSFeatureFlag(),
      loadSpacePaidStatus()
    ]);
  }

  return {
    macrosCreated,
    actionRequired,
    shouldBlockActions,
    severity,
    upgradeUrl,
    enterpriseBundleUrl,
    learnMoreUrl,
    spacePaid: spacePaidStatus,
    initialize
  }
}

/**
 * Get upgrade context data to include in tracking events
 * Returns current macro usage information
 */
export function getUpgradeContext() {
  return {
    macro_count: macrosCreated.value,
    macro_limit: MACROS_LIMIT,
    macro_usage_pct: Math.round((macrosCreated.value / MACROS_LIMIT) * 100),
  };
}
