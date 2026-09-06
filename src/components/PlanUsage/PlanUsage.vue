<template>
  <div class="plan-usage">
    <template v-if="view === 'usage'">
      <h1>Plan and usage</h1>
      <p class="muted">{{ domain }}</p>

      <div v-if="loading" class="muted">Loading usage…</div>
      <div v-else-if="loadError" class="error">Could not load usage data. Try reloading.</div>
      <template v-else>
        <section class="summary">
          <div class="stat">
            <div class="stat-value">{{ totalMacros }}</div>
            <div class="stat-label">Diagrams across the site</div>
          </div>
          <div class="stat">
            <div class="stat-value">{{ overLimitSpaces.length }}</div>
            <div class="stat-label">Spaces over the Lite limit ({{ macrosLimit }})</div>
          </div>
        </section>

        <p v-if="isStale" class="stale-note">
          This count may be a few hours old and can jump between reads — treat it as an estimate,
          not an exact live total.
        </p>

        <section v-if="overLimitSpaces.length" class="space-list">
          <h2>Spaces over the limit</h2>
          <ul>
            <li v-for="s in overLimitSpaces" :key="s.spaceKey">
              <span class="space-key">{{ s.spaceKey }}</span>
              <span class="space-count">{{ s.macroCount }} diagrams</span>
            </li>
          </ul>
        </section>
        <p v-else class="muted">No spaces are currently over the Lite limit.</p>

        <section class="upgrade-block">
          <h2>Full covers every space on this site</h2>
          <p>
            Full removes the per-space diagram limit. Estimated pricing and purchase are handled
            entirely by Atlassian Marketplace — this page does not process payment.
          </p>
          <div class="actions">
            <button class="btn btn-primary" data-testid="plan-usage-request-full" @click="openRequestFullGuide">
              Request Full
            </button>
            <button class="btn btn-secondary" data-testid="plan-usage-purchase" @click="onPurchaseClicked">
              View Full on Marketplace
            </button>
          </div>
        </section>
      </template>
    </template>

    <template v-else>
      <button class="back-link" data-testid="request-full-back" @click="view = 'usage'">← Back to Plan and usage</button>
      <h1>Request Full for your team</h1>
      <p>
        Full removes the diagram limit for every space on this site. Copy the reason below, then
        submit it through Atlassian's own request-to-install flow — an admin on your site handles
        approval and purchase from there. We do not receive a copy of what you submit to Atlassian.
      </p>

      <section class="reason-box">
        <h2>Reason for your admin</h2>
        <pre data-testid="request-full-reason-text">{{ reasonText }}</pre>
        <button class="btn btn-secondary" data-testid="request-full-copy" @click="onCopyReason">
          {{ copyState === 'copied' ? '✓ Copied' : 'Copy reason' }}
        </button>
      </section>

      <div class="actions">
        <button class="btn btn-primary" data-testid="request-full-atlassian" @click="onGoToAtlassian">
          Go to Atlassian
        </button>
      </div>
      <p class="muted small">
        This opens the Full listing on Atlassian Marketplace. If your site shows an in-product
        "request an app" option there, paste the reason above into it — an admin on your site will
        see the request.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { getClientDomain, getSpaceKey } from '@/utils/ContextParameters/ContextParameters'
import forgeGlobal, { openUrl } from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import type { AnalyticsEventName } from '@/utils/analytics/catalog'

const BASE_UPGRADE_URL = 'https://marketplace.atlassian.com/apps/1218380/zenuml-sequence-diagram'

type View = 'usage' | 'request_full'
const view = ref<View>('usage')

const domain = ref('')
const loading = ref(true)
const loadError = ref(false)
const totalMacros = ref(0)
const macrosLimit = ref(100)
const overLimitSpaces = ref<Array<{ spaceKey: string; macroCount: number }>>([])
const isStale = ref<boolean | null>(null)
const copyState = ref<'default' | 'copied'>('default')

const upgradeUrl = computed(() => `${BASE_UPGRADE_URL}?domain=${domain.value}`)

const reasonText = computed(() => {
  const spaceList = overLimitSpaces.value.map((s) => s.spaceKey).join(', ') || getSpaceKey() || 'this space'
  return [
    `Our team uses ZenUML diagrams on Confluence, and we've grown past the Lite plan's per-space limit`,
    `(${macrosLimit.value} diagrams) in: ${spaceList}.`,
    ``,
    `We'd like to move to ZenUML Full so we can keep creating and editing diagrams without hitting`,
    `that limit. Could you approve installing/upgrading to Full for our site?`,
  ].join('\n')
})

async function loadUsage() {
  loading.value = true
  loadError.value = false
  try {
    const baseUrl = forgeGlobal.zenumlRemoteBaseUrl
    const response = await fetch(`${baseUrl}/api/plan-usage?client=${encodeURIComponent(domain.value)}`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    totalMacros.value = data.totalMacros ?? 0
    macrosLimit.value = data.macrosLimit ?? 100
    overLimitSpaces.value = data.overLimitSpaces ?? []
    isStale.value = data.isStale ?? null
  } catch (e) {
    console.error('plan-usage: failed to load', e)
    loadError.value = true
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  domain.value = getClientDomain() || 'unknown_atlassian_domain'
  await loadUsage()
  trackAnalyticsPlanUsage('plan_usage_viewed')
})

function openRequestFullGuide() {
  trackAnalyticsPlanUsage('plan_usage_request_full_clicked')
  view.value = 'request_full'
  trackAnalyticsPlanUsage('request_full_guide_shown')
}

async function onPurchaseClicked() {
  trackAnalyticsPlanUsage('plan_usage_purchase_clicked')
  await openUrl(upgradeUrl.value)
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through
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

async function onCopyReason() {
  const copied = await copyToClipboard(reasonText.value)
  if (copied) {
    trackAnalyticsPlanUsage('request_full_reason_copied')
    copyState.value = 'copied'
    setTimeout(() => { copyState.value = 'default' }, 2000)
  }
}

async function onGoToAtlassian() {
  trackAnalyticsPlanUsage('request_full_atlassian_clicked')
  await openUrl(upgradeUrl.value)
}

// Thin wrapper: the six new plan-usage/request-full events aren't part of
// UpgradeEventName (that enum is scoped to the paywall modal/banner funnel),
// so this calls trackAnalyticsEvent directly with the same feature_area/surface
// shape trackUpgradeEvent uses, rather than growing that enum's scope.
function trackAnalyticsPlanUsage(eventName: AnalyticsEventName) {
  trackAnalyticsEvent(eventName, {
    feature_area: 'upgrade',
    surface: 'dashboard',
    macro_usage_pct: macrosLimit.value ? Math.round((totalMacros.value / macrosLimit.value) * 100) : undefined,
  })
}
</script>

<style scoped>
.plan-usage {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 24px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #172B4D;
}
h1 { font-size: 24px; margin-bottom: 4px; }
h2 { font-size: 16px; margin: 24px 0 8px; }
.muted { color: #626F86; }
.small { font-size: 12px; }
.error { color: #AE2E24; }
.stale-note {
  background: #FFFAE6;
  border: 1px solid #F5CD47;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 13px;
  margin: 12px 0;
}
.summary {
  display: flex;
  gap: 24px;
  margin: 20px 0;
}
.stat {
  border: 1px solid #DFE1E6;
  border-radius: 8px;
  padding: 16px 20px;
  flex: 1;
}
.stat-value { font-size: 28px; font-weight: 600; }
.stat-label { font-size: 13px; color: #626F86; margin-top: 4px; }
.space-list ul { list-style: none; padding: 0; }
.space-list li {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #F1F2F4;
}
.space-key { font-weight: 500; }
.space-count { color: #626F86; }
.upgrade-block {
  margin-top: 32px;
  padding: 20px;
  border: 1px solid #DFE1E6;
  border-radius: 8px;
}
.actions { display: flex; gap: 8px; margin-top: 12px; }
.btn {
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: none;
}
.btn-primary { background: #974F0C; color: #fff; }
.btn-secondary { background: transparent; border: 1px solid #8590A2; color: #44546F; }
.reason-box {
  background: #F7F8F9;
  border-radius: 8px;
  padding: 16px;
  margin: 20px 0;
}
.reason-box pre {
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 14px;
  margin-bottom: 12px;
}
.back-link {
  background: none;
  border: none;
  color: #2675bf;
  cursor: pointer;
  padding: 0;
  margin-bottom: 16px;
  font-size: 14px;
}
</style>
