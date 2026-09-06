<template>
  <div class="plan-usage">
    <template v-if="view === 'usage'">
      <h1>Plan and usage</h1>
      <p class="domain">{{ domain }}</p>

      <div v-if="loading" class="muted">Loading usage…</div>
      <div v-else-if="loadError" class="error">Could not load usage data. Try reloading.</div>
      <template v-else>
        <section class="stat-grid">
          <div class="stat-card">
            <div class="stat-value">{{ totalMacros.toLocaleString() }}</div>
            <div class="stat-label">Diagrams across the site</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{{ overLimitSpaces.length }}</div>
            <div class="stat-label">Spaces over the Lite limit ({{ macrosLimit }})</div>
          </div>
        </section>

        <p v-if="isStale" class="stale-note">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>
          This count may be a few hours old and can shift between reads — treat it as an estimate,
          not an exact live total.
        </p>

        <template v-if="overLimitSpaces.length">
          <p class="section-title">Spaces over the limit</p>
          <div class="space-table-wrap">
            <table class="space-table">
              <thead><tr><th>Space</th><th>Diagrams</th><th>Status</th></tr></thead>
              <tbody>
                <tr v-for="s in overLimitSpaces" :key="s.spaceKey">
                  <td class="space-key">{{ s.spaceKey }}</td>
                  <td class="space-count">{{ s.macroCount.toLocaleString() }}</td>
                  <td><span class="badge-overlimit">Over limit</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
        <p v-else class="muted">No spaces are currently over the Lite limit.</p>

        <section class="upgrade-block">
          <p class="section-title">Full covers every space on this site</p>
          <p class="upgrade-copy">
            Full removes the per-space diagram limit. Estimated pricing and purchase are handled
            entirely by Atlassian Marketplace — this page does not process payment.
          </p>
          <div class="actions">
            <button class="btn btn-primary" data-testid="plan-usage-request-full" @click="openRequestFullGuide">
              Request Full
            </button>
            <button class="btn btn-neutral" data-testid="plan-usage-purchase" @click="onPurchaseClicked">
              View Full on Marketplace
            </button>
          </div>
        </section>
      </template>
    </template>

    <template v-else>
      <div class="step-row">
        <button type="button" class="back-link" data-testid="request-full-back" @click="view = 'usage'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
          Plan and usage
        </button>
        <span class="step-label">Step 2 of 2 · Request Full</span>
      </div>

      <h1 class="request-title">Request Full for your team</h1>
      <p class="request-intro">
        Full removes the diagram limit for every space on this site. Copy the reason below, then
        submit it through Atlassian's own request-to-install flow — an admin on your site handles
        approval and purchase from there. We do not receive a copy of what you submit to Atlassian.
      </p>

      <section class="reason-box">
        <p class="section-title">Reason for your admin</p>
        <pre class="reason-text" data-testid="request-full-reason-text">{{ reasonText }}</pre>
        <button class="btn btn-aui" data-testid="request-full-copy" @click="onCopyReason">
          <template v-if="copyState === 'copied'">✓ Copied</template>
          <template v-else>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3"/></svg>
            Copy reason
          </template>
        </button>
      </section>

      <div class="actions">
        <button class="btn btn-primary" data-testid="request-full-atlassian" @click="onGoToAtlassian">
          Go to Atlassian
        </button>
      </div>
      <p class="atlassian-note">
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
/* Tokens copied from docs/handoffs/local-crm-design-source/_ds/colors_and_type.css
   (DESIGN.md's source-of-truth) — this codebase inlines hex values in scoped
   component CSS rather than importing that file (see PaywallWarningBanner.vue,
   GetStarted.vue), so this component follows the same convention. */
.plan-usage {
  max-width: 720px;
  margin: 0 auto;
  padding: 40px 24px 80px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: #172B4D; /* --neutral-text */
}
h1 { font-size: 20px; font-weight: 600; line-height: 1.3; margin: 0 0 4px; }
.domain { font-size: 13px; color: #6B778C; margin: 0 0 24px; } /* --neutral-subtle */
.muted { color: #6B778C; }
.error { color: #CA3521; } /* --color-danger */

.section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.025em;
  color: #6B778C;
  margin: 0 0 8px;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}
.stat-card {
  background: #FFFFFF;
  border: 1px solid #E5E7EB; /* --gray-200, matches --border */
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); /* --shadow-sm */
  padding: 20px;
}
.stat-value { font-size: 36px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
.stat-label { font-size: 12px; color: #6B778C; margin-top: 4px; }

.stale-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  background: #F9FAFB; /* --gray-50 */
  border: 1px solid #E5E7EB;
  border-radius: 6px;
  padding: 9px 12px;
  font-size: 12px;
  color: #6B778C;
  margin: 0 0 24px;
}
.stale-note svg { flex-shrink: 0; margin-top: 1px; color: #9CA3AF; } /* --gray-400 */

.space-table-wrap {
  background: #FFFFFF;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  overflow: hidden;
  margin-bottom: 32px;
}
table.space-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.space-table th {
  text-align: left;
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.025em;
  color: #6B778C;
  padding: 12px 16px;
  border-bottom: 1px solid #E5E7EB;
}
.space-table td { padding: 11px 16px; border-bottom: 1px solid #F3F4F6; } /* --gray-100 */
.space-table tr:last-child td { border-bottom: none; }
.space-key { font-weight: 600; }
.space-count { font-variant-numeric: tabular-nums; color: #172B4D; }
.badge-overlimit {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: #FDF6E3;
  border: 1px solid #F5E2A3;
  color: #7A5A00;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  padding: 3px 9px;
  border-radius: 9999px;
}
.badge-overlimit::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: #E2B203; } /* --color-warning */

.upgrade-block { border-top: 1px solid #E5E7EB; padding-top: 24px; margin-top: 8px; }
.upgrade-copy { font-size: 14px; color: #6B778C; line-height: 1.55; margin: 0 0 16px; max-width: 58ch; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }

.btn {
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background-color 200ms, color 200ms, border-color 200ms;
}
.btn:focus-visible { outline: 2px solid #3B82F6; outline-offset: 2px; } /* --color-blue-500 */
.btn-primary { background: #2563EB; color: #fff; } /* --color-blue-600 */
.btn-primary:hover { background: #1D4ED8; } /* --color-blue-700 */
.btn-neutral { background: transparent; color: #6B7280; border-color: transparent; } /* --gray-500 */
.btn-neutral:hover { background: #F3F4F6; color: #374151; } /* --gray-100 / --gray-700 */

/* AUI variant (DESIGN.md 8.1: bg-[#091E4224] rounded-[3px] text-[#172B4D]) —
   more visible than .btn-neutral without competing with the blue primary CTA.
   Used for Copy reason, which most users complete before the primary action. */
.btn-aui {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(9, 30, 66, 0.14);
  color: #172B4D;
  border-radius: 3px;
}
.btn-aui:hover { background: rgba(9, 30, 66, 0.22); }
.btn-aui svg { flex-shrink: 0; }

.step-row { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.back-link {
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  color: #6B778C;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 0;
  display: flex;
  align-items: center;
  gap: 4px;
}
.back-link:hover { color: #172B4D; }
.back-link svg { color: #9CA3AF; }
.step-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.025em;
  color: #9CA3AF;
  padding-left: 12px;
  border-left: 1px solid #E5E7EB;
}

h1.request-title { font-size: 28px; margin-bottom: 8px; } /* --fs-h2 */
.request-intro { font-size: 14px; color: #6B778C; line-height: 1.6; max-width: 58ch; margin: 0 0 24px; }

.reason-box {
  background: #FFFFFF;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  padding: 20px;
  margin: 0 0 20px;
}
.reason-box .section-title { margin-bottom: 12px; }
.reason-text {
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.6;
  color: #172B4D;
  margin: 0 0 12px;
}
.atlassian-note { font-size: 12px; color: #9CA3AF; margin-top: 12px; max-width: 58ch; }
</style>
