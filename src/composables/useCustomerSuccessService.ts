import { ref, computed } from 'vue'
import type { MacroCountSource, PaywallPolicySource } from '@/utils/analytics/catalog'
import getFeatureFlagsForCurrentDomain from "@/apis/featureFlags"
import macroMetrics from "@/services/MacroMetrics"
import { getClientDomain, getSpaceKey } from "@/utils/ContextParameters/ContextParameters"
import globals from '@/model/globals'
import { callRemote } from '@/utils/requestUtil'
import { writeTargetingMarker, toMarkerSeverity } from '@/utils/paywall/warningBanner'

export const MACROS_LIMIT = 100
const WARNING_THRESHOLD = 85
const BASE_UPGRADE_URL = 'https://marketplace.atlassian.com/apps/1218380/zenuml-sequence-diagram'
const BASE_LEARN_MORE_URL = 'https://zenuml.com/upgrade'

const macrosCreated = ref<number>(0)
// Where `macrosCreated` came from / why it is unusable — the #302 fail-open
// signal, surfaced on `paywall_gate_evaluated`. 'undefined' pre-read and when
// the read returns undefined; 'zero' when the read returns total:0.
const macroCountSource = ref<MacroCountSource>('undefined')
// Which policy produced the effective Lite paywall decision (lite-paywall-
// default-on). Starts 'fail_open' (the safe default before a real decision
// is loaded) and stays 'fail_open' for the whole session on a non-Lite
// variant, a missing/unreadable/malformed PAYWALL_EXEMPT lookup, or a
// rejected /feature-flags call. Rides on paywall_gate_evaluated.
const policySource = ref<PaywallPolicySource>('fail_open')
// Effective paywall-enabled boolean — kept under its legacy CSS name for
// compatibility (return value `cssEnabled`, the page-banner marker's
// `customerSuccessServiceEnabled` field, and saved Mixpanel queries). `true`
// only when `policySource` is 'default_on'.
const customerSuccessServiceEnabled = ref<boolean>(false)
const spacePaidStatus = ref<boolean>(false)
// Which grant satisfied spacePaidStatus — 'user_license' (per-requester
// extension), 'space_license' (whole-space extension or a paid plan), or
// 'paid_rail' (D1 ForgeInstallation trial-window suppression — see
// functions/api/space-status.ts checkPaidRail). Undefined when the space
// isn't paid. Rides on paywall_gate_evaluated.
const spacePaidSource = ref<'user_license' | 'space_license' | 'paid_rail' | undefined>(undefined)
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
    // client_reference_id rides the Payment Link into the Checkout Session and
    // comes back verbatim in Stripe's payment records, so a $299 payment can
    // be attributed to tenant+space without asking the customer to type
    // anything. Stripe accepts only [A-Za-z0-9_-] (≤200 chars) and silently
    // drops the whole parameter otherwise — sanitise, because personal space
    // keys start with "~". Prefer currentSpaceKey (same identity the KV space
    // license is granted against) and fall back to the synchronous context
    // read before it loads.
    const reference = `${getClientDomain()}__${currentSpaceKey.value || getSpaceKey()}`
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 200)
    return `https://buy.stripe.com/cNifZifkN7hzavK12H7IY05?client_reference_id=${reference}`
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
          macroCountSource.value = 'mock'
          console.log('🧪 Using mock macro count:', macrosCreated.value)
          macroMetricsLoaded = true;
          return;
        }
      }

      const metrics = await macroMetrics.getMacroMetrics()
      if (metrics?.total) {
        macrosCreated.value = metrics.total
        macroCountSource.value = metrics.source === 'kv' ? 'kv' : 'collect'
      } else if (metrics) {
        // Read returned an object but total is 0/falsy (empty / under-return) —
        // #302 fail-open: gate sees 0 and does not fire on an over-limit space.
        macroCountSource.value = 'zero'
      } else {
        // Read returned undefined (KV miss + collect failed, or an outer throw
        // swallowed inside getMacroMetrics) — the other #302 fail-open path.
        macroCountSource.value = 'undefined'
      }
      macroMetricsLoaded = true;
    } catch (error) {
      console.error('Error loading macro metrics:', error)
      macroCountSource.value = 'undefined'
    }
  }

  // Resolve the fixed Lite paywall policy: on by default, unless the backend
  // returns an explicit exemption, unless the lookup itself is unavailable
  // (missing/malformed KV, rejected fetch) — in which case the decision fails
  // open. Non-Lite variants never make the PAYWALL_EXEMPT lookup at all; the
  // effective paywall stays disabled for the whole session.
  async function loadPaywallPolicy(): Promise<void> {
    if (cssFlagLoaded) {
      console.log('🏁 Paywall policy already loaded, skipping')
      return;
    }

    if (!globals.apWrapper.isLite()) {
      // Leave the effective paywall disabled and do not request the new
      // feature at all — Full/Diagramly/AsyncAPI have no paywall.
      policySource.value = 'fail_open'
      customerSuccessServiceEnabled.value = false
      cssFlagLoaded = true;
      return;
    }

    try {
      if (localStorage.mockCSSEnabled !== undefined) {
        // Legacy-named dev/test override, retained as the effective decision
        // override (design doc): 'true' behaves like default_on, 'false'
        // behaves like an explicit exemption. Does not traverse the real
        // PAYWALL_EXEMPT lookup.
        const mockEnabled = localStorage.mockCSSEnabled === 'true'
        policySource.value = mockEnabled ? 'default_on' : 'exemption'
        customerSuccessServiceEnabled.value = mockEnabled
        console.log('🧪 Using mock CSS Feature Flag:', customerSuccessServiceEnabled.value)
        cssFlagLoaded = true;
        return;
      }

      console.log('🔍 Loading PAYWALL_EXEMPT feature flag...')
      const flags: any = await getFeatureFlagsForCurrentDomain(['PAYWALL_EXEMPT'])
      if (typeof flags.PAYWALL_EXEMPT !== 'boolean') {
        // Absent property: missing/unreadable/malformed KV, or the lookup
        // itself failed inside getFeatureFlagsForCurrentDomain (which turns
        // any transport error into `{}`). Fail open — never treat "unknown"
        // as "safe to restrict".
        policySource.value = 'fail_open'
        customerSuccessServiceEnabled.value = false
      } else if (flags.PAYWALL_EXEMPT) {
        policySource.value = 'exemption'
        customerSuccessServiceEnabled.value = false
      } else {
        policySource.value = 'default_on'
        customerSuccessServiceEnabled.value = true
      }
      console.log('✅ Paywall policy loaded:', {
        PAYWALL_EXEMPT: flags.PAYWALL_EXEMPT,
        policySource: policySource.value,
        enabled: customerSuccessServiceEnabled.value,
      })
    } catch (error) {
      console.error("❌ Error loading paywall policy:", error);
      policySource.value = 'fail_open'
      customerSuccessServiceEnabled.value = false
    } finally {
      // Mark loaded even on failure: an unavailable decision is resolved for
      // this iframe's lifecycle, not retried into a surprise mid-session
      // restriction.
      cssFlagLoaded = true;
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
        spacePaidSource.value = response.isPaid ? response.source : undefined
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

  /**
   * Load the paywall inputs, and by default record the targeting marker.
   *
   * `persistMarker: false` is for READERS of the paywall decision that are not
   * the macro iframe. The targeting marker is single-writer by design (see the
   * module comment in utils/paywall/warningBanner.ts): only the macro iframe
   * writes it, when a macro renders. A second writer breaks that two ways —
   * it can create a marker on a page where no macro rendered, which is enough
   * on its own to make the warning banner eligible for a space admin; and
   * because the write is a full overwrite, a degraded read (macro count 0)
   * would clobber a good marker with severity 'none' and SUPPRESS a banner
   * that should have shown.
   *
   * The Lite byline's create-limit pre-check (BylineDiagrams.vue) is the first
   * such reader: it needs `shouldBlockActions` and nothing else.
   */
  const initialize = async ({ persistMarker = true }: { persistMarker?: boolean } = {}) => {
    await Promise.all([
      loadMacroMetrics(),
      loadPaywallPolicy(),
      loadSpacePaidStatus(),
      loadSpaceKey(),
    ]);
    if (persistMarker) persistTargetingMarker();
  }

  return {
    macrosCreated,
    macroCountSource,
    spaceKey: currentSpaceKey,
    actionRequired,
    shouldBlockActions,
    severity,
    upgradeUrl,
    enterpriseBundleUrl,
    learnMoreUrl,
    spacePaid: spacePaidStatus,
    spacePaidSource,
    // Legacy-named alias of the effective paywall-enabled boolean, kept for
    // saved-query compatibility until downstream consumers migrate to
    // paywallPolicySource.
    cssEnabled: customerSuccessServiceEnabled,
    paywallPolicySource: policySource,
    initialize,
  }
}

;(useCustomerSuccessService as any).__resetForTests = () => {
  macrosCreated.value = 0
  macroCountSource.value = 'undefined'
  policySource.value = 'fail_open'
  customerSuccessServiceEnabled.value = false
  spacePaidStatus.value = false
  spacePaidSource.value = undefined
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
