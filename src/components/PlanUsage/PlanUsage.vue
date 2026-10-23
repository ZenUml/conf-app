<template>
  <div class="plan-usage" :class="{ 'plan-usage--wide': view === 'locations' }">
    <template v-if="view === 'usage'">
      <h1>Plan and usage</h1>
      <p class="domain">{{ domain }}</p>

      <div v-if="loading" class="muted">Loading usage…</div>
      <div v-else-if="loadError" class="error">Could not load usage data. Try reloading.</div>
      <template v-else>
        <section class="stats">
          <div class="stat">
            <div class="stat-value">{{ totalMacros.toLocaleString() }}</div>
            <div class="stat-label">Diagrams on this site</div>
            <button type="button" class="link-btn" data-testid="plan-usage-view-locations" @click="openLocations">
              View locations
            </button>
          </div>
          <div class="stat stat--divided">
            <div class="stat-value" :class="{ 'stat-value--warn': overLimitSpaces.length > 0 }">{{ overLimitSpaces.length }}</div>
            <div class="stat-label">Spaces over the Lite limit of {{ macrosLimit }}</div>
          </div>
        </section>
        <p class="stats-note" data-testid="plan-usage-count-note">Both counts update every few hours.</p>

        <template v-if="overLimitSpaces.length">
          <h2 class="section-title">Spaces over the limit</h2>
          <table class="space-table">
            <thead><tr><th>Space</th><th class="num">Diagrams / limit</th></tr></thead>
            <tbody>
              <tr v-for="s in overLimitSpaces" :key="s.spaceKey">
                <td class="space-key">{{ s.spaceKey }}</td>
                <td class="num space-count">{{ s.macroCount.toLocaleString() }} / {{ macrosLimit.toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
        </template>
        <p v-else class="muted">No spaces are currently over the Lite limit.</p>

        <section class="upgrade-block">
          <h2 class="section-title">Upgrade to Full</h2>
          <p class="upgrade-copy">
            Full removes the per-space limit on every space on this site. Atlassian Marketplace
            handles pricing and purchase.
          </p>
          <div class="actions">
            <button type="button" class="btn btn-primary" data-testid="plan-usage-request-full" @click="openRequestFullGuide">
              Request Full
            </button>
            <button type="button" class="btn btn-secondary" data-testid="plan-usage-purchase" @click="onPurchaseClicked">
              View on Marketplace
            </button>
          </div>
        </section>
      </template>
    </template>

    <DiagramLocations
      v-else-if="view === 'locations'"
      :spaces="spaces"
      :total-macros="totalMacros"
      @back="view = 'usage'"
    />

    <template v-else>
      <button type="button" class="back-link" data-testid="request-full-back" @click="view = 'usage'">← Plan and usage</button>

      <h1>Request Full</h1>
      <p class="request-intro">
        Copy this reason, then send it with the request option on Atlassian Marketplace. A site
        admin approves and buys Full.
      </p>

      <section class="reason-box">
        <p class="reason-label">Reason</p>
        <pre class="reason-text" data-testid="request-full-reason-text">{{ reasonText }}</pre>
      </section>

      <div class="actions">
        <button type="button" class="btn btn-secondary" data-testid="request-full-copy" @click="onCopyReason">
          {{ copyState === 'copied' ? 'Copied' : 'Copy reason' }}
        </button>
        <button type="button" class="btn btn-primary" data-testid="request-full-atlassian" @click="onGoToAtlassian">
          Open Marketplace
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { getClientDomain, getSpaceKey } from '@/utils/ContextParameters/ContextParameters'
import forgeGlobal, { openUrl } from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import type { AnalyticsEventName } from '@/utils/analytics/catalog'
import DiagramLocations from '@/components/PlanUsage/DiagramLocations.vue'
import type { SpaceSummary } from '@/utils/planUsage/diagramLocations'

const BASE_UPGRADE_URL = 'https://marketplace.atlassian.com/apps/1218380/zenuml-sequence-diagram'

type View = 'usage' | 'locations' | 'request_full'
const view = ref<View>('usage')

const domain = ref('')
const loading = ref(true)
const loadError = ref(false)
const totalMacros = ref(0)
const macrosLimit = ref(100)
const overLimitSpaces = ref<Array<{ spaceKey: string; macroCount: number }>>([])
// Every space with a reported stored-diagram count, for the Diagram-locations
// screen (#848). The list itself is fetched there, per space, as the viewer.
const spaces = ref<SpaceSummary[]>([])
const isStale = ref<boolean | null>(null)
const copyState = ref<'default' | 'copied'>('default')

const upgradeUrl = computed(() => `${BASE_UPGRADE_URL}?domain=${domain.value}`)

const reasonText = computed(() => {
  const spaceList = overLimitSpaces.value.length
    ? overLimitSpaces.value.map((s) => `${s.spaceKey} (${s.macroCount.toLocaleString()} diagrams)`).join(', ')
    : getSpaceKey() || 'this space'
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
    // A backend deployed before `spaces` existed (the Pages and Forge bundles
    // ship in one pipeline but not in one instant) still names the over-limit
    // spaces, so offer those rather than a false "nothing to browse".
    spaces.value = Array.isArray(data.spaces)
      ? data.spaces
      : overLimitSpaces.value.map((s) => ({ spaceKey: s.spaceKey, macroCount: s.macroCount, lastUpdated: data.lastUpdated ?? null }))
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

// "View diagram locations" on the count card. The screen tracks its own
// plan_usage_locations_* events, so nothing fires here beyond the view swap.
function openLocations() {
  view.value = 'locations'
}

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
/* Colour tokens: Radix slate/amber steps for neutrals and warning, Atlaskit
   blue for the primary action and links (matches Confluence). Defined once
   here; DiagramLocations.vue repeats the same names on its own root. */
.plan-usage {
  --pu-text-high: #1C2024; /* Radix slate12 */
  --pu-text-low: #60646C; /* Radix slate11 */
  --pu-text-disabled: #8B8D98; /* Radix slate9 */
  --pu-hairline: #D9D9E0; /* Radix slate6 */
  --pu-control-border: #CDCED6; /* Radix slate7 */
  --pu-bg-subtle: #F9F9FB; /* Radix slate2 */
  --pu-warning: #AB6400; /* Radix amber11 */
  --pu-primary: #0C66E4; /* Atlaskit blue */
  max-width: 720px;
  margin: 0 auto;
  padding: 40px 24px 80px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 20px;
  color: var(--pu-text-high);
}
/* The Diagram-locations table has five columns and needs the wider column. */
.plan-usage--wide { max-width: 1072px; }
h1 { font-size: 24px; font-weight: 600; line-height: 32px; margin: 0; }
.domain { font-size: 12px; line-height: 16px; color: var(--pu-text-low); margin: 0 0 24px; }
.muted { color: var(--pu-text-low); margin: 0; }
.error { color: var(--pu-warning); margin: 0; }

.section-title { font-size: 14px; font-weight: 600; line-height: 20px; margin: 24px 0 8px; }

.stats { display: grid; grid-template-columns: 1fr 1fr; }
.stat { padding-right: 24px; }
.stat--divided { border-left: 0.5px solid var(--pu-hairline); padding-left: 24px; padding-right: 0; }
.stat-value { font-size: 24px; font-weight: 500; line-height: 32px; font-variant-numeric: tabular-nums; }
.stat-value--warn { color: var(--pu-warning); }
.stat-label { font-size: 12px; line-height: 16px; color: var(--pu-text-low); }
.stats-note {
  font-size: 12px;
  line-height: 16px;
  color: var(--pu-text-low);
  border-top: 0.5px solid var(--pu-hairline);
  padding-top: 12px;
  margin: 16px 0 0;
}

.link-btn {
  font: inherit;
  font-weight: 500;
  color: var(--pu-primary);
  background: none;
  border: none;
  padding: 0;
  margin-top: 8px;
  cursor: pointer;
}
.link-btn:hover { text-decoration: underline; }

table.space-table { width: 400px; max-width: 100%; border-collapse: collapse; }
.space-table th {
  height: 32px;
  text-align: left;
  font-size: 12px;
  font-weight: 400;
  line-height: 16px;
  color: var(--pu-text-low);
  padding: 0;
  border-bottom: 0.5px solid var(--pu-control-border);
}
.space-table td { height: 40px; padding: 0; border-bottom: 0.5px solid var(--pu-hairline); font-weight: 500; }
.space-table .num { text-align: right; }
.space-count { color: var(--pu-warning); font-variant-numeric: tabular-nums; }

.upgrade-copy { color: var(--pu-text-low); max-width: 560px; margin: 0 0 16px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }

.btn {
  font: inherit;
  font-weight: 500;
  height: 32px;
  padding: 0 12px;
  border-radius: 6px;
  cursor: pointer;
  border: 0.5px solid transparent;
}
.btn-primary { background: var(--pu-primary); color: #FFFFFF; }
.btn-secondary { background: #FFFFFF; color: var(--pu-text-high); border-color: var(--pu-control-border); }
.btn:focus-visible, .link-btn:focus-visible, .back-link:focus-visible { outline: 2px solid var(--pu-primary); outline-offset: 2px; }

.back-link {
  font: inherit;
  font-weight: 500;
  color: var(--pu-text-low);
  background: none;
  border: none;
  padding: 0;
  margin: 0 0 16px;
  cursor: pointer;
}
.back-link:hover { color: var(--pu-text-high); }

.request-intro { color: var(--pu-text-low); max-width: 560px; margin: 8px 0 24px; }

.reason-box {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--pu-bg-subtle);
  border: 0.5px solid var(--pu-control-border);
  border-radius: 6px;
  padding: 16px;
  margin: 0 0 16px;
}
.reason-label { font-size: 12px; line-height: 16px; color: var(--pu-text-low); margin: 0; }
.reason-text { white-space: pre-wrap; font-family: inherit; font-size: 14px; line-height: 20px; color: var(--pu-text-high); margin: 0; }
</style>
