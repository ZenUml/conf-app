<template>
  <div class="license-notice-strip" data-testid="license-notice-strip">
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
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { openUrl } from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { MARKETPLACE_UPGRADE_URL } from '@/features/licenseNotice/licenseNotice'

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
</script>

<style scoped>
.license-notice-strip {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 12px;
  color: #6b7280;
  font-size: 12px;
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
