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
    <span class="paywall-banner__text">
      This space is approaching the ZenUML Lite diagram limit ({{ macrosCreated }} of {{ macrosLimit }}).
      Editing may be disabled soon.
    </span>
    <div class="paywall-banner__actions">
      <button
        class="paywall-banner__btn paywall-banner__btn--primary"
        data-testid="paywall-banner-request-extension"
        @click="onRequestExtension"
      >Request extension</button>
      <button
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
import { ref, computed, onMounted } from 'vue'
import { useCustomerSuccessService, MACROS_LIMIT } from '@/composables/useCustomerSuccessService'
import {
  trackUpgradeEvent,
  UpgradeEventName,
  UIComponent,
} from '@/utils/upgradeTracking'
import { getUpgradeContext } from '@/composables/useCustomerSuccessService'
import {
  buildAdvocacyMessage,
  type AdvocacyMessageContext,
} from './buildAdvocacyMessage'
import {
  buildExtensionRequestContext,
  buildExtensionRequestMessage,
  extensionRequestUrl,
} from './buildExtensionRequest'
import { openUrl } from '@/model/globals/forgeGlobal'
import { ENTERPRISE_BUNDLE_ANNUAL_COST } from './upgradePrompt'

const ENTERPRISE_BUNDLE_PRICE = `$${ENTERPRISE_BUNDLE_ANNUAL_COST}/yr/space`

const customerSuccess = useCustomerSuccessService()
const dismissed = ref(false)
const copyState = ref<'default' | 'copied'>('default')
let copyRevertTimer: ReturnType<typeof setTimeout> | null = null

const macrosCreated = customerSuccess.macrosCreated
const macrosLimit = MACROS_LIMIT

const visible = computed(() =>
  !dismissed.value &&
  customerSuccess.actionRequired.value &&
  customerSuccess.severity.value === 'warning'
)

const messageContext = computed<AdvocacyMessageContext>(() => ({
  spaceKey: customerSuccess.spaceKey.value,
  macroCount: macrosCreated.value,
  macrosLimit,
  upgradeUrl: customerSuccess.upgradeUrl.value,
  enterpriseBundleUrl: customerSuccess.enterpriseBundleUrl.value,
  enterpriseBundlePrice: ENTERPRISE_BUNDLE_PRICE,
  macroKind: 'unknown',
}))

onMounted(() => {
  if (visible.value) {
    trackUpgradeEvent(UpgradeEventName.PAYWALL_BANNER_SHOWN, {
      ui_component: UIComponent.BANNER,
      severity: customerSuccess.severity.value,
      ...getUpgradeContext(),
    })
  }
})

function onDismiss() {
  trackUpgradeEvent(UpgradeEventName.PAYWALL_BANNER_DISMISSED, {
    ui_component: UIComponent.BANNER,
    severity: customerSuccess.severity.value,
    ...getUpgradeContext(),
  })
  dismissed.value = true
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
  const message = buildAdvocacyMessage(messageContext.value)
  const copied = await copyToClipboard(message)
  if (copied) {
    trackUpgradeEvent(UpgradeEventName.ADVOCACY_MESSAGE_COPIED, {
      ui_component: UIComponent.BANNER,
      severity: customerSuccess.severity.value,
      ...getUpgradeContext(),
    })
    if (copyRevertTimer) clearTimeout(copyRevertTimer)
    copyState.value = 'copied'
    copyRevertTimer = setTimeout(() => {
      copyState.value = 'default'
      copyRevertTimer = null
    }, 2000)
  }
}

async function onRequestExtension() {
  const requestUrl = extensionRequestUrl()
  const requestContext = buildExtensionRequestContext({
    spaceKey: customerSuccess.spaceKey.value,
    macroCount: macrosCreated.value,
    macrosLimit,
    macroKind: 'unknown',
  })
  const requestMessage = buildExtensionRequestMessage(requestContext)
  await copyToClipboard(requestMessage)
  trackUpgradeEvent(UpgradeEventName.EXTENSION_REQUEST_CLICKED, {
    ui_component: UIComponent.BANNER,
    severity: customerSuccess.severity.value,
    ...getUpgradeContext(),
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
