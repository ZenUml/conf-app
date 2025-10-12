import { ref, computed } from 'vue'
import getFeatureFlagsForCurrentDomain from "@/apis/featureFlags"
import { trackEvent } from "@/utils/window"
import macroMetrics from "@/services/MacroMetrics"
import { getClientDomain } from "@/utils/ContextParameters/ContextParameters"

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

  const upgradeUrl = computed(() => {
    const domain = getClientDomain()
    return `${BASE_UPGRADE_URL}?domain=${domain}`
  })

  const enterpriseBundleUrl = computed(() => {
    return 'https://buy.stripe.com/fZucN67SlgS933i9zd7IY03'
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
      return;
    }

    try {
      const customerSuccessService: any = await getFeatureFlagsForCurrentDomain(['CUSTOMER_SUCCESS_SERVICE'])
      customerSuccessServiceEnabled.value = !!customerSuccessService.CUSTOMER_SUCCESS_SERVICE
      if (customerSuccessServiceEnabled.value) {
        trackEvent('', 'css-enabled', 'conversion')
      }
      cssFlagLoaded = true;
    } catch (error) {
      console.error("Error loading CSS feature flag:", error);
    }
  }

  const initialize = async () => {
    await loadMacroMetrics();
    await loadCSSFeatureFlag();
  }

  return {
    macrosCreated,
    actionRequired,
    upgradeUrl,
    enterpriseBundleUrl,
    learnMoreUrl,
    initialize
  }
}
