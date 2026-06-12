<template>
  <!-- Success state replaces the form entirely — the user is done. -->
  <div v-if="submitted" class="rounded-md border border-green-200 bg-green-50 px-3 py-2" data-testid="extension-form-success">
    <p class="text-xs text-green-900 leading-5">
      Request sent. Our team will review it and reply to <strong>{{ email }}</strong> — usually within one business day.
    </p>
  </div>

  <form v-else @submit.prevent="onSubmit" data-testid="extension-request-form">
    <p class="text-xs text-blue-950 leading-5 mb-2">
      The extension is free — no payment, no admin needed. Enter your email and
      we'll file the request with your space details attached.
    </p>
    <div class="flex items-center gap-2">
      <input
        v-model.trim="email"
        type="email"
        required
        placeholder="you@company.com"
        data-testid="extension-email-input"
        class="min-w-0 flex-1 rounded border border-blue-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        :disabled="submitting"
      />
      <button
        type="submit"
        data-testid="extension-form-submit-btn"
        class="shrink-0 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-50"
        :disabled="submitting || !emailValid"
      >{{ submitting ? 'Sending…' : 'Send request' }}</button>
    </div>
    <p v-if="errorMessage" class="mt-1 text-[11px] text-red-700" data-testid="extension-form-error">
      {{ errorMessage }}
      <a
        v-if="showFallbackLink"
        href="#"
        class="underline"
        data-testid="extension-form-fallback-link"
        @click.prevent="onFallbackToPortal"
      >Open the support portal instead</a>
    </p>
  </form>
</template>

<script lang="ts">
// localStorage lives in the Forge iframe origin — same persistence model as
// paywallContinueAttempts. One email per browser profile is enough.
export const EMAIL_STORAGE_KEY = 'extensionRequestEmail'
</script>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { trackUpgradeEvent, UpgradeEventName, UIComponent } from '@/utils/upgradeTracking'
import { getUpgradeContext } from '@/composables/useCustomerSuccessService'
import type { PaywallActionType } from '@/utils/paywall/mountPaywallGate'
import {
  buildExtensionRequestContext,
  buildExtensionRequestUrl,
  type ExtensionRequestContext,
} from './buildExtensionRequest'
import type { MacroKind } from './buildAdvocacyMessage'
import { callRemote } from '@/utils/requestUtil'
import { openUrl } from '@/model/globals/forgeGlobal'

const props = defineProps<{
  spaceKey: string
  macroCount: number
  macrosLimit: number
  macroKind: MacroKind
  actionType?: PaywallActionType
}>()

const email = ref('')
const submitting = ref(false)
const submitted = ref(false)
const errorMessage = ref('')
const showFallbackLink = ref(false)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const emailValid = computed(() => EMAIL_RE.test(email.value))

function requestContext(): ExtensionRequestContext {
  return buildExtensionRequestContext({
    spaceKey: props.spaceKey,
    macroCount: props.macroCount,
    macrosLimit: props.macrosLimit,
    macroKind: props.macroKind,
  })
}

function eventPayload() {
  return {
    action_type: props.actionType,
    ui_component: UIComponent.MODAL,
    ...getUpgradeContext(),
  }
}

onMounted(() => {
  try {
    email.value = localStorage.getItem(EMAIL_STORAGE_KEY) || ''
  } catch { /* storage unavailable — start blank */ }
  trackUpgradeEvent(UpgradeEventName.EXTENSION_FORM_VIEWED, eventPayload())
})

async function onSubmit() {
  if (!emailValid.value || submitting.value) return
  submitting.value = true
  errorMessage.value = ''
  showFallbackLink.value = false

  const ctx = requestContext()
  try {
    const result = await callRemote('/api/extension-request', 'POST', {
      email: email.value,
      clientDomain: ctx.clientDomain,
      spaceKey: ctx.spaceKey,
      macroCount: ctx.macroCount,
      macrosLimit: ctx.macrosLimit,
      macroKind: ctx.macroKind,
      productType: ctx.productType,
      appVersion: ctx.appVersion,
      accountId: ctx.userAccountId,
      pageId: ctx.pageId,
    })
    try {
      localStorage.setItem(EMAIL_STORAGE_KEY, email.value)
    } catch { /* non-fatal */ }
    submitted.value = true
    trackUpgradeEvent(UpgradeEventName.EXTENSION_FORM_SUBMITTED, {
      ...eventPayload(),
      issue_key: result?.issueKey ?? null,
    })
  } catch (e: any) {
    const message = String(e?.message || e)
    const rateLimited = message.includes('429')
    errorMessage.value = rateLimited
      ? 'You already have a request in our queue today — our team has it.'
      : "Couldn't send the request from here."
    showFallbackLink.value = !rateLimited
    trackUpgradeEvent(UpgradeEventName.EXTENSION_FORM_FAILED, {
      ...eventPayload(),
      error: rateLimited ? 'rate_limited' : 'request_failed',
    })
  } finally {
    submitting.value = false
  }
}

// Fallback to the legacy portal deep-link when our endpoint fails. Reuses the
// legacy event so the old funnel keeps measuring exactly what it always did.
async function onFallbackToPortal() {
  const url = buildExtensionRequestUrl(requestContext())
  trackUpgradeEvent(UpgradeEventName.EXTENSION_REQUEST_CLICKED, {
    ...eventPayload(),
    copied_request_details: false,
    request_url: url,
    fallback_from_form: true,
  })
  await openUrl(url)
}
</script>
