<template>
  <section
    class="license-notice"
    role="status"
    aria-label="License notice"
    data-testid="license-notice-strip"
  >
    <div class="license-notice-grid">
    <svg class="license-notice-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M13.31 3.79a1.5 1.5 0 0 0-2.62 0L2.68 18.27A1.5 1.5 0 0 0 3.99 20.5h16.02a1.5 1.5 0 0 0 1.31-2.23L13.31 3.79ZM12 8a1 1 0 0 1 1 1v4.5a1 1 0 1 1-2 0V9a1 1 0 0 1 1-1Zm0 8a1.1 1.1 0 1 1 0 2.2A1.1 1.1 0 0 1 12 16Z"
      />
    </svg>
    <div class="license-notice-text">
      <p class="license-notice-title">No active license</p>
      <p class="license-notice-body">
        This diagram stays viewable. Ask your Confluence admin to subscribe to remove the watermark.
      </p>
    </div>
    <div class="license-notice-cta">
      <button
        type="button"
        class="license-notice-btn"
        data-testid="license-notice-upgrade"
        @click="onUpgrade"
      >
        Upgrade on Marketplace
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4 2h6v6M10 2 3 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
    <p class="license-notice-help">
      Can't upgrade? Email
      <!-- A button that copies, not a mailto link: mailto does nothing in the Forge sandbox. -->
      <button
        type="button"
        class="license-notice-email"
        data-testid="license-notice-email"
        title="Copy email address"
        :data-copied="copied ? '' : undefined"
        @click="onCopyEmail"
      >{{ SUPPORT_EMAIL }}</button>
      or
      <button
        type="button"
        class="license-notice-link"
        data-testid="license-notice-ticket"
        @click="onTicket"
      >submit a support ticket</button>.
    </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { openUrl } from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { MARKETPLACE_UPGRADE_URL, SUPPORT_EMAIL, SUPPORT_TICKET_URL } from '@/features/licenseNotice/licenseNotice'

const COPIED_MS = 1400

const props = defineProps<{
  surface: 'viewer' | 'fullscreen'
  macroType: string
}>()

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

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

onBeforeUnmount(() => clearTimeout(copiedTimer))

async function onUpgrade() {
  trackAnalyticsEvent('license_notice_upgrade_clicked', baseProps())
  try {
    await openUrl(MARKETPLACE_UPGRADE_URL)
  } catch (e) {
    console.error('[license-notice] could not open the Marketplace page', e)
  }
}

function onCopyEmail() {
  // Show the confirmation first: the clipboard promise can stay pending in a
  // sandboxed iframe, and the address is selectable text either way.
  copied.value = true
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => { copied.value = false }, COPIED_MS)
  trackAnalyticsEvent('license_notice_email_copied', baseProps())
  navigator.clipboard?.writeText(SUPPORT_EMAIL).catch(() => {})
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
/* Atlassian design tokens with light-theme fallbacks; the tokens switch the
   colours when the host page runs in dark mode. */
.license-notice {
  /* Inside .viewer-canvas, where LicenseWatermark (z-index 1) covers the whole
     box: sit above it, still below the floating pills (z-index 5). */
  position: relative;
  z-index: 2;
  /* The query container; a container cannot restyle itself, so the grid
     lives on the inner .license-notice-grid. */
  container-type: inline-size;
  margin: 0 12px 12px;
  background: var(--ds-background-warning, #fff7f2);
  border: 1px solid var(--ds-border-warning, #fedec8);
  border-radius: 6px;
  color: var(--ds-text, #172b4d);
  font-size: 14px;
  line-height: 20px;
  animation: license-notice-rise 0.32s cubic-bezier(0.2, 0.7, 0.2, 1) 0.25s both;
}
.license-notice-grid {
  display: grid;
  grid-template-columns: 20px 1fr auto;
  column-gap: 10px;
  align-items: center;
  padding: 12px 12px 0 14px;
}
@keyframes license-notice-rise {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}
.license-notice-icon {
  align-self: start;
  margin-top: 1px;
  color: var(--ds-icon-warning, #e56910);
}
.license-notice-title {
  margin: 0;
  font-weight: 600;
}
.license-notice-body {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--ds-text-subtle, #44546f);
  text-wrap: pretty;
}
.license-notice-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 3px;
  background: var(--ds-background-brand-bold, #0c66e4);
  color: var(--ds-text-inverse, #fff);
  font: inherit;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.12s ease, transform 0.08s ease;
}
.license-notice-btn:hover { background: var(--ds-background-brand-bold-hovered, #0055cc); }
.license-notice-btn:active {
  background: var(--ds-background-brand-bold-pressed, #09326c);
  transform: scale(0.98);
}
.license-notice-btn svg { transition: transform 0.16s ease; }
.license-notice-btn:hover svg { transform: translate(1px, -1px); }
.license-notice-help {
  grid-column: 1 / -1;
  margin: 12px -12px 0 -14px;
  padding: 8px 14px 9px 44px;
  border-top: 1px solid var(--ds-border-warning, #fedec8);
  font-size: 12px;
  line-height: 18px;
  color: var(--ds-text-subtlest, #626f86);
  text-wrap: pretty;
}
.license-notice-email,
.license-notice-link {
  font: inherit;
  background: none;
  border: 0;
  cursor: pointer;
}
.license-notice-email {
  position: relative;
  margin: 0 -2px;
  padding: 0 2px;
  border-radius: 3px;
  color: var(--ds-text, #172b4d);
  cursor: copy;
  user-select: text;
  text-decoration: underline dotted;
  text-underline-offset: 2px;
  text-decoration-color: var(--ds-text-subtlest, #626f86);
  transition: background 0.12s;
}
.license-notice-email:hover { background: var(--ds-background-neutral, #f1f2f4); }
.license-notice-email[data-copied]::after {
  content: 'Copied';
  position: absolute;
  left: 50%;
  bottom: calc(100% + 6px);
  transform: translateX(-50%);
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--ds-background-neutral-bold, #44546f);
  color: var(--ds-text-inverse, #fff);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
  animation: license-notice-pop 0.18s ease-out both;
}
@keyframes license-notice-pop {
  from { opacity: 0; transform: translate(-50%, 3px); }
}
.license-notice-link {
  padding: 0;
  color: var(--ds-link, #0c66e4);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.license-notice-link:hover { color: var(--ds-link-pressed, #0055cc); }
.license-notice-btn:focus-visible,
.license-notice-email:focus-visible,
.license-notice-link:focus-visible {
  outline: 2px solid var(--ds-border-focused, #388bff);
  outline-offset: 2px;
}
/* Narrow macro column: the button goes full width under the text. */
@container (max-width: 520px) {
  .license-notice-grid { grid-template-columns: 20px 1fr; row-gap: 12px; }
  .license-notice-cta { grid-column: 2; }
  .license-notice-btn { width: 100%; }
  .license-notice-help { margin-top: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .license-notice,
  .license-notice-btn,
  .license-notice-btn svg,
  .license-notice-email,
  .license-notice-email[data-copied]::after { animation: none; transition: none; }
}
</style>
