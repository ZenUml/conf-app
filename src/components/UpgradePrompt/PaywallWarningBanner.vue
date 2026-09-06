<template>
  <div
    v-if="visible"
    class="paywall-banner"
    role="status"
    aria-live="polite"
    data-testid="paywall-warning-banner"
  >
    <svg class="paywall-banner__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
    <span v-if="audience === 'space_admin'" class="paywall-banner__text">
      You administer this space, and it is over the ZenUML Lite diagram limit
      ({{ macroCount }} of {{ macrosLimit }}). Your team can keep creating and editing
      diagrams — consider upgrading to Full so this space stays covered.
    </span>
    <span v-else class="paywall-banner__text">
      This space is over the ZenUML Lite diagram limit ({{ macroCount }} of {{ macrosLimit }}).
      You can keep creating and editing diagrams — ask a space admin about upgrading to Full.
    </span>
    <!-- Space admins get a purchase path they can execute alone: the Enterprise
         Bundle is per-space and paid by card, so unlike the Marketplace upgrade
         it needs no Confluence SITE admin. Everyone else gets the advocacy copy,
         because for them the next step really is to ask someone. -->
    <div class="paywall-banner__actions">
      <button
        class="paywall-banner__btn paywall-banner__btn--primary"
        data-testid="paywall-banner-plan-usage"
        @click="onViewPlanUsage"
      >View plan and usage</button>
      <button
        v-if="audience === 'space_admin'"
        class="paywall-banner__btn paywall-banner__btn--secondary"
        data-testid="paywall-banner-unlock-space"
        @click="onUnlockSpace"
      >Unlock this space — {{ ENTERPRISE_BUNDLE_PRICE }}</button>
      <button
        class="paywall-banner__btn paywall-banner__btn--secondary"
        data-testid="paywall-banner-request-extension"
        @click="onRequestExtension"
      >Request extension</button>
      <button
        v-if="audience !== 'space_admin'"
        class="paywall-banner__btn paywall-banner__btn--secondary"
        :data-testid="copyState === 'copied' ? 'paywall-banner-copied' : 'paywall-banner-copy-admin'"
        @click="onCopyAdminMessage"
      >
        <template v-if="copyState === 'copied'">✓ Copied</template>
        <template v-else>Copy admin message</template>
      </button>
    </div>
    <button
      class="paywall-banner__dismiss"
      aria-label="Dismiss warning"
      data-testid="paywall-banner-dismiss"
      @click="onDismiss"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useCustomerSuccessService, MACROS_LIMIT } from '@/composables/useCustomerSuccessService'
import {
  trackUpgradeEvent,
  UpgradeEventName,
  bundleClientReferenceId,
} from '@/utils/upgradeTracking'
import {
  buildAdvocacyMessage,
  type AdvocacyMessageContext,
} from './buildAdvocacyMessage'
import {
  buildExtensionRequestContext,
  buildExtensionRequestMessage,
  buildExtensionRequestUrl,
} from './buildExtensionRequest'
import { getView, openUrl, navigateToAppPage } from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { ENTERPRISE_BUNDLE_ANNUAL_COST } from './upgradePrompt'
import {
  deriveWarningBannerIdentity,
  readTargetingMarker,
  readMacroActivityMarker,
  recordBannerShown,
  recordBannerDismissed,
  isWarningBannerVisible,
  bannerAudience,
  readDismissalMarker,
  type WarningBannerIdentity,
  type BannerAudience,
} from '@/utils/paywall/warningBanner'
import { readProbeMarker } from '@/utils/paywall/spaceAdminProbe'

/**
 * `isSpaceAdmin` is supplied by the page-banner host (routes/pageBanner.ts)
 * rather than re-derived here, because the host is where the Phase 5b flag is
 * resolved. Deriving it locally would show admin copy to a flagged-off admin who
 * happens to also qualify as a recent author.
 */
const props = withDefaults(defineProps<{ isSpaceAdmin?: boolean }>(), { isSpaceAdmin: false })

// The page-banner iframe has NO live macro context — `macrosCreated` in the
// composable is 0 here. Everything that describes the space (count, severity,
// spaceKey) comes from the targeting marker the macro iframe wrote earlier; we
// only borrow the composable's PURE url builders (they depend on getClientDomain
// only, not on initialize() having run).
const ENTERPRISE_BUNDLE_PRICE = `$${ENTERPRISE_BUNDLE_ANNUAL_COST}/yr/space`
const customerSuccess = useCustomerSuccessService()

const macrosLimit = MACROS_LIMIT
const copyState = ref<'default' | 'copied'>('default')
let copyRevertTimer: ReturnType<typeof setTimeout> | null = null

// Evaluate the visibility gate SYNCHRONOUSLY in setup so the first render is
// already correct — no false→true flash, and the gate result drives v-if from
// frame one. Side effects (impression analytics, or view.close on a fail)
// happen in onMounted. forgeIndex already gated cheaply before mounting us;
// this re-check guards the standalone / raced case and fails closed.
let identity: WarningBannerIdentity = { clientDomain: 'unknown', spaceKey: 'unknown' }
let severity: 'none' | 'warning' | 'critical' = 'warning'
let passesGate = false
let macroCountValue = 0
const isSpaceAdmin = props.isSpaceAdmin
let spaceAdminCount: number | undefined
try {
  identity = deriveWarningBannerIdentity()
  const targeting = readTargetingMarker(identity)
  spaceAdminCount = readProbeMarker(identity)?.adminCount
  passesGate =
    !!targeting &&
    isWarningBannerVisible(
      targeting,
      readDismissalMarker(identity),
      readMacroActivityMarker(identity),
      Date.now(),
      isSpaceAdmin
    )
  if (passesGate && targeting) {
    macroCountValue = targeting.macroCount
    severity = targeting.severity
  }
} catch (e) {
  console.warn('[paywall-banner] gate evaluation failed; closing', e)
  passesGate = false
}

const audience: BannerAudience = bannerAudience(isSpaceAdmin)

const visible = ref(passesGate)
const macroCount = ref(macroCountValue)

async function closeBannerView() {
  const activeView = await getView()
  await activeView.close()
}

onMounted(() => {
  // Mirrors CsatBanner: any failure on the pageBanner path must end in
  // view.close() — never a stranded empty banner frame.
  try {
    if (!passesGate) {
      void closeBannerView()
      return
    }
    // Impression: bump the show counter and emit the denominator event.
    recordBannerShown(identity)
    trackUpgradeEvent(UpgradeEventName.PAYWALL_BANNER_SHOWN, {
      surface: 'page_banner',
      severity,
      ...bannerContext(),
    })
  } catch (e) {
    console.warn('[paywall-banner] mount failed; closing', e)
    void closeBannerView()
  }
})

/** Analytics context derived from the marker (NOT getUpgradeContext(), whose
 * composable refs are 0 in this iframe). */
function bannerContext() {
  return {
    macro_count: macroCount.value,
    macro_limit: macrosLimit,
    space_key: identity.spaceKey,
    macro_usage_pct: Math.round((macroCount.value / macrosLimit) * 100),
    // Phase 5b: every banner event carries the audience so the funnel splits by
    // who was actually addressed. Without this the two populations are pooled
    // and the whole experiment is unreadable.
    is_space_admin: isSpaceAdmin,
    banner_audience: audience,
    ...(spaceAdminCount === undefined ? {} : { space_admin_count: spaceAdminCount }),
  }
}

function messageContext(): AdvocacyMessageContext {
  return {
    spaceKey: identity.spaceKey,
    macroCount: macroCount.value,
    macrosLimit,
    upgradeUrl: customerSuccess.upgradeUrl.value,
    enterpriseBundleUrl: customerSuccess.enterpriseBundleUrl.value,
    enterpriseBundlePrice: ENTERPRISE_BUNDLE_PRICE,
    macroKind: 'unknown',
  }
}

function onDismiss() {
  // Snooze, not kill: stamp dismissedAt to start the 7-day window. The banner
  // returns afterwards because the underlying problem is unchanged.
  recordBannerDismissed(identity)
  trackUpgradeEvent(UpgradeEventName.PAYWALL_BANNER_DISMISSED, {
    surface: 'page_banner',
    severity,
    ...bannerContext(),
  })
  visible.value = false
  void closeBannerView()
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to execCommand
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.top = '-9999px'
    textarea.setAttribute('readonly', '')
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

async function onCopyAdminMessage() {
  const message = buildAdvocacyMessage(messageContext())
  const copied = await copyToClipboard(message)
  if (copied) {
    trackUpgradeEvent(UpgradeEventName.ADVOCACY_MESSAGE_COPIED, {
      surface: 'page_banner',
      severity,
      ...bannerContext(),
    })
    if (copyRevertTimer) clearTimeout(copyRevertTimer)
    copyState.value = 'copied'
    copyRevertTimer = setTimeout(() => {
      copyState.value = 'default'
      copyRevertTimer = null
    }, 2000)
  }
}

/**
 * Space-admin-only CTA. Goes straight to the Enterprise Bundle checkout because
 * that is the one purchase a space admin can complete without escalating: it is
 * scoped to the space they already administer and paid by card. The Marketplace
 * upgrade — the only other rail — requires a Confluence SITE admin, which a
 * space admin is not, and which we cannot detect at all.
 */
/**
 * Primary CTA (Lite paywall redesign phase 2): the banner's entry point into
 * the site-level "Plan and usage" page, which is where the Request-Full
 * guidance flow lives. Falls back to the Marketplace upgrade URL in the rare
 * case navigateToAppPage can't resolve our own app/environment ids from the
 * running iframe's location (see forgeGlobal.ts buildAppPageUrl).
 */
async function onViewPlanUsage() {
  trackAnalyticsEvent('plan_usage_viewed', {
    feature_area: 'upgrade',
    surface: 'page_banner',
    entry_point: 'route',
    ...bannerContext(),
  })
  const navigated = await navigateToAppPage('zenuml-plan-usage')
  if (!navigated) {
    await openUrl(customerSuccess.upgradeUrl.value)
  }
}

async function onUnlockSpace() {
  const bundleUrl = customerSuccess.enterpriseBundleUrl.value
  const reference = bundleClientReferenceId(bundleUrl)
  trackUpgradeEvent(UpgradeEventName.PAYWALL_BUNDLE_CTA_CLICKED, {
    surface: 'page_banner',
    severity,
    bundle_price_usd: ENTERPRISE_BUNDLE_ANNUAL_COST,
    ...(reference !== undefined ? { client_reference_id: reference } : {}),
    ...bannerContext(),
  })
  await openUrl(bundleUrl)
}

async function onRequestExtension() {
  const requestContext = buildExtensionRequestContext({
    spaceKey: identity.spaceKey,
    macroCount: macroCount.value,
    macrosLimit,
    macroKind: 'unknown',
  })
  const requestUrl = buildExtensionRequestUrl(requestContext)
  const requestMessage = buildExtensionRequestMessage(requestContext)
  // Clipboard copy is a safety net: JSM drops the prefill params if the user
  // navigates within the portal before submitting.
  await copyToClipboard(requestMessage)
  trackUpgradeEvent(UpgradeEventName.EXTENSION_REQUEST_CLICKED, {
    surface: 'page_banner',
    severity,
    ...bannerContext(),
  })
  await openUrl(requestUrl)
}
</script>

<style scoped>
.paywall-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 14px;
  background: #FFFAE6;
  border-bottom: 1px solid #F5CD47;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 12px;
  color: #172B4D;
  line-height: 1.4;
  width: 100%;
  box-sizing: border-box;
  flex-shrink: 0;
}

.paywall-banner__icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: #974F0C;
}

.paywall-banner__text {
  flex: 1;
  color: #44546F;
  min-width: 0;
}

.paywall-banner__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.paywall-banner__btn {
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  border: none;
  white-space: nowrap;
}

.paywall-banner__btn--primary {
  background: #974F0C;
  color: #fff;
}
.paywall-banner__btn--primary:hover {
  background: #7A3F0A;
}

.paywall-banner__btn--secondary {
  background: transparent;
  color: #44546F;
  border: 1px solid #8590A2;
}
.paywall-banner__btn--secondary:hover {
  background: #F1F2F4;
  color: #172B4D;
}

.paywall-banner__dismiss {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #626F86;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
}
.paywall-banner__dismiss:hover {
  background: #F1F2F4;
  color: #172B4D;
}
</style>
