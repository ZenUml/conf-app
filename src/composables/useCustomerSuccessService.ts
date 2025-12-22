import { ref, computed } from 'vue'
import getFeatureFlagsForCurrentDomain from "@/apis/featureFlags"
import { trackUpgradeEvent, UpgradeEventName } from "@/utils/upgradeTracking"
import macroMetrics from "@/services/MacroMetrics"
import { getClientDomain } from "@/utils/ContextParameters/ContextParameters"
import globals from '@/model/globals'

// Constants that both components use
export const MACROS_LIMIT = 100
const WARNING_THRESHOLD = 85
const BASE_UPGRADE_URL = 'https://marketplace.atlassian.com/apps/1218380/zenuml-sequence-diagram'
const BASE_LEARN_MORE_URL = 'https://zenuml.com/upgrade'

// Shared reactive state across all component instances
const macrosCreated = ref<number>(0)
const customerSuccessServiceEnabled = ref<boolean>(false)

// Cache flags to track if data has been loaded
let macroMetricsLoaded = false;
let cssFlagLoaded = false;

export function useCustomerSuccessService() {
  const actionRequired = computed(() => {
    return macrosCreated.value >= WARNING_THRESHOLD && customerSuccessServiceEnabled.value
  })

  const shouldBlockActions = computed(() => {
    const isLite = globals.apWrapper.isLite()
    const shouldBlock = macrosCreated.value >= MACROS_LIMIT && customerSuccessServiceEnabled.value && isLite
    console.log('🚫 shouldBlockActions check:', {
      macrosCreated: macrosCreated.value,
      macrosLimit: MACROS_LIMIT,
      featureFlagEnabled: customerSuccessServiceEnabled.value,
      isLite,
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

  const initialize = async () => {
    await loadMacroMetrics();
    await loadCSSFeatureFlag();
  }

  return {
    macrosCreated,
    actionRequired,
    shouldBlockActions,
    severity,
    upgradeUrl,
    enterpriseBundleUrl,
    learnMoreUrl,
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
