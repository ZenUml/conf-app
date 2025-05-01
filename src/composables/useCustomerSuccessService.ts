import { ref, computed } from 'vue'
import getFeatureFlagsForCurrentDomain from "@/apis/featureFlags"
import { trackEvent } from "@/utils/window"
import macroMetrics from "@/services/MacroMetrics"
import { getClientDomain } from "@/utils/ContextParameters/ContextParameters"

// Constants that both components use
export const MACROS_LIMIT = 100
const WARNING_THRESHOLD = 85
const BASE_UPGRADE_URL = 'https://zenuml.com/upgrade/'

// Promise to ensure CSS feature flag is loaded and tracked only once
let loadCssFlagPromise: Promise<void> | null = null;

export function useCustomerSuccessService() {
  const macrosCreated = ref<number>(0)
  const customerSuccessServiceEnabled = ref<boolean>(false)

  const actionRequired = computed(() => {
    return macrosCreated.value >= WARNING_THRESHOLD && customerSuccessServiceEnabled.value
  })

  const upgradeUrl = computed(() => {
    const domain = getClientDomain()
    return `${BASE_UPGRADE_URL}?domain=${domain}`
  })

  async function loadMacroMetrics(): Promise<void> {
    const metrics = await macroMetrics.getMacroMetrics()
    if (metrics?.total) {
      macrosCreated.value = metrics.total
    }
  }

  async function loadCSSFeatureFlag(): Promise<void> {
    // If the promise already exists, return it to prevent re-execution
    if (loadCssFlagPromise) {
      return loadCssFlagPromise;
    }

    // Create the promise to fetch the flag and track the event
    loadCssFlagPromise = (async () => {
      try {
        const customerSuccessService: any = await getFeatureFlagsForCurrentDomain(['CUSTOMER_SUCCESS_SERVICE'])
        customerSuccessServiceEnabled.value = !!customerSuccessService.CUSTOMER_SUCCESS_SERVICE
        trackEvent('', customerSuccessServiceEnabled.value ? 'css-enabled' : 'css-disabled', 'conversion')
      } catch (error) {
        console.error("Error loading CSS feature flag:", error);
        // Optionally reset the promise on error so it can be retried?
        // loadCssFlagPromise = null;
      }
    })();

    return loadCssFlagPromise;
  }

  const initialize = async () => {
    await loadMacroMetrics();
    await loadCSSFeatureFlag();
  }

  return {
    macrosCreated,
    actionRequired,
    upgradeUrl,
    initialize
  }
}
