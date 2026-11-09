<template>
  <div class="license-notice-strip" data-testid="license-notice-strip">
    <div class="license-notice-strip-row">
      <span class="license-notice-strip-text">This app has no active license. Ask your Confluence admin to subscribe.</span>
      <button
        type="button"
        class="license-notice-strip-btn"
        data-testid="license-notice-upgrade"
        @click="onUpgrade"
      >
        Upgrade on Marketplace
      </button>
    </div>
    <div class="license-notice-strip-row">
      <span class="license-notice-strip-text">
        Can't upgrade? Email
        <!-- Plain text on purpose: clicking a mailto link in the Forge sandbox does nothing. -->
        <span class="license-notice-strip-email" data-testid="license-notice-email">{{ SUPPORT_EMAIL }}</span>
        or
        <button
          type="button"
          class="license-notice-strip-link"
          data-testid="license-notice-ticket"
          @click="onTicket"
        >submit a support ticket</button>.
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { openUrl } from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { MARKETPLACE_UPGRADE_URL, SUPPORT_EMAIL, SUPPORT_TICKET_URL } from '@/features/licenseNotice/licenseNotice'

const props = defineProps<{
  surface: 'viewer' | 'fullscreen'
  macroType: string
}>()

function baseProps() {
  return {
    feature_area: 'license_notice' as const,
    surface: props.surface,
    macro_type: props.macroType as any,
  }
}

// Once per mount: the parent mounts this only while the notice is visible.
onMounted(() => {
  trackAnalyticsEvent('license_notice_shown', baseProps())
})

async function onUpgrade() {
  trackAnalyticsEvent('license_notice_upgrade_clicked', baseProps())
  try {
    await openUrl(MARKETPLACE_UPGRADE_URL)
  } catch (e) {
    console.error('[license-notice] could not open the Marketplace page', e)
  }
}

async function onTicket() {
  trackAnalyticsEvent('license_notice_ticket_clicked', baseProps())
  try {
    await openUrl(SUPPORT_TICKET_URL)
  } catch (e) {
    console.error('[license-notice] could not open the support portal', e)
  }
}
</script>

<style scoped>
.license-notice-strip {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
  color: #6b7280;
  font-size: 12px;
}
.license-notice-strip-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.license-notice-strip-email {
  color: #172b4d;
  user-select: text;
}
.license-notice-strip-link {
  border: 0;
  padding: 0;
  background: transparent;
  color: #0c66e4;
  font-size: inherit;
  text-decoration: underline;
  cursor: pointer;
}
.license-notice-strip-btn {
  border: 1px solid #d1d5db;
  background: transparent;
  color: #172b4d;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.license-notice-strip-btn:hover {
  background: #f4f5f7;
}
</style>
