<template>
  <div class="template-offer" role="region" aria-label="ZenUML page template" data-testid="template-offer-banner">
    <template v-if="state === 'created'">
      <strong>Template created.</strong>
      <span>Anyone creating a page in this space can now choose <em>Diagram page</em> under Templates.</span>
      <button class="template-offer__ghost" data-testid="template-offer-close" @click="closeBanner">Close</button>
    </template>
    <template v-else>
      <strong>This space has {{ macroCount }} diagrams.</strong>
      <span>Add a <em>Diagram page</em> template so your team starts new pages with a diagram in place.</span>
      <button class="template-offer__primary" data-testid="template-offer-create" :disabled="state === 'creating'" @click="create">
        {{ state === 'creating' ? 'Creating…' : 'Create template' }}
      </button>
      <button class="template-offer__ghost" data-testid="template-offer-dismiss" :disabled="state === 'creating'" @click="dismiss">Not now</button>
      <span v-if="state === 'failed'" class="template-offer__error" role="alert">{{ failureMessage }}</span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { view } from '@forge/bridge'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { deriveWarningBannerIdentity } from '@/utils/paywall/warningBanner'
import { buildMacroTemplateAdf } from '@/utils/template/macroTemplateAdf'
import { createSpaceTemplate, TemplateCreateError, type TemplateCreateReason } from '@/utils/template/createSpaceTemplate'
import { markTemplateCreated, markTemplateOfferDismissed } from '@/utils/template/templateOfferMarker'
import { liteAppIdentity } from '@/utils/template/variantApp'

const { macroCount } = defineProps<{ macroCount: number }>()
const state = ref<'idle' | 'creating' | 'created' | 'failed'>('idle')
const failureReason = ref<TemplateCreateReason | 'context_unavailable'>('unexpected')
const identity = deriveWarningBannerIdentity()

function analyticsContext() {
  return {
    feature_area: 'confluence' as const,
    surface: 'page_banner' as const,
    macro_type: 'sequence' as const,
    ui_component: 'template_offer',
    macro_count: macroCount,
  }
}

function messageFor(reason: typeof failureReason.value): string {
  if (reason === 'forbidden') return 'You do not have permission to create templates in this space. You can ask a space admin to create one.'
  if (reason === 'context_unavailable') return 'ZenUML could not confirm this page context. Reload the page and try again.'
  return 'ZenUML could not create the template. You can still add one under Space settings → Templates.'
}

onMounted(() => {
  trackAnalyticsEvent('template_offer_shown', analyticsContext())
})

async function closeBanner(): Promise<void> {
  await view.close()
}

async function create(): Promise<void> {
  if (state.value === 'creating' || state.value === 'created') return
  state.value = 'creating'
  failureReason.value = 'unexpected'
  trackAnalyticsEvent('template_offer_clicked', analyticsContext())

  try {
    if (!identity.clientDomain || !identity.spaceKey || identity.clientDomain === 'unknown' || identity.spaceKey === 'unknown') {
      failureReason.value = 'context_unavailable'
      throw new Error('missing Forge space identity')
    }
    const { environmentId, environmentType } = forgeGlobal.forgeContext || {}
    if (!environmentId || !environmentType) {
      failureReason.value = 'context_unavailable'
      throw new Error('missing Forge environment identity')
    }
    const { appId, macroKey } = liteAppIdentity()
    await createSpaceTemplate({
      spaceKey: identity.spaceKey,
      adf: buildMacroTemplateAdf({ appId, environmentId, environmentType, macroKey }),
    })
    markTemplateCreated(identity)
    trackAnalyticsEvent('template_created', { ...analyticsContext(), template_id: 'sequence-space-template' })
    state.value = 'created'
  } catch (error) {
    if (error instanceof TemplateCreateError) failureReason.value = error.reason
    trackAnalyticsEvent('template_create_failed', { ...analyticsContext(), failure_reason: failureReason.value })
    state.value = 'failed'
  }
}

async function dismiss(): Promise<void> {
  if (state.value === 'creating') return
  markTemplateOfferDismissed(identity)
  trackAnalyticsEvent('template_offer_dismissed', analyticsContext())
  await closeBanner()
}

const failureMessage = computed(() => messageFor(failureReason.value))
</script>

<style scoped>
.template-offer { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; min-height: 46px; box-sizing: border-box; padding: 8px 20px; border-bottom: 1px solid var(--ds-border, #dfe1e6); background: var(--ds-background-information, #e9f2ff); color: var(--ds-text, #172b4d); font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.template-offer__primary, .template-offer__ghost { padding: 5px 10px; border: 0; border-radius: 3px; cursor: pointer; }
.template-offer__primary { background: var(--ds-background-brand-bold, #0c66e4); color: var(--ds-text-inverse, #fff); }
.template-offer__ghost { background: transparent; color: var(--ds-text-subtle, #44546f); }
.template-offer__primary:disabled, .template-offer__ghost:disabled { cursor: default; opacity: .65; }
.template-offer__error { flex-basis: 100%; color: var(--ds-text-danger, #ae2a19); }
</style>
