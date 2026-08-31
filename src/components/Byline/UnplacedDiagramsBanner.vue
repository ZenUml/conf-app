<template>
  <div
    v-if="visible"
    class="unplaced"
    role="status"
    aria-live="polite"
    data-testid="unplaced-banner"
  >
    <div class="unplaced__line">
      <svg class="unplaced__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 5h18v14H3z" />
        <path d="m8 12 3 3 5-6" />
      </svg>
      <!-- Says where the diagram IS before it says where it is not: "saved on
           this page" is the part that stops a user reading this as a broken
           macro, and it is the reason the link below can place it. -->
      <span class="unplaced__text" data-testid="unplaced-banner-text">
        <template v-if="rows.length === 1">
          <strong>{{ rows[0].title || 'A diagram' }}</strong> is saved on this page but isn't placed on it.
        </template>
        <template v-else>
          {{ rows.length }} diagrams are saved on this page but aren't placed on it.
        </template>
      </span>

      <!-- One diagram is one action, so the list would be ceremony around a
           single button. More than one and the summary alone cannot say WHICH,
           so the rows carry that — behind a toggle, because this banner sits
           above every load of the page and must not own the fold. -->
      <button
        v-if="rows.length === 1"
        type="button"
        class="unplaced__btn unplaced__btn--primary"
        :data-testid="copiedId === rows[0].id ? 'unplaced-banner-copied' : 'unplaced-banner-copy'"
        @click="onCopy(rows[0])"
      >{{ copiedId === rows[0].id ? '✓ Link copied' : 'Copy link' }}</button>
      <button
        v-else
        type="button"
        class="unplaced__btn unplaced__btn--primary"
        data-testid="unplaced-banner-toggle"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >{{ expanded ? 'Hide' : 'Show diagrams' }}</button>

      <button
        class="unplaced__dismiss"
        aria-label="Dismiss"
        data-testid="unplaced-banner-dismiss"
        @click="onDismiss"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- The instruction, not a restatement of the problem: a link on the
         clipboard is only half the job, and pasting a URL into the editor being
         enough IS the surprising step. Shown once the copy lands, where it is
         the next thing to do. -->
    <div v-if="copiedId" class="unplaced__hint" data-testid="unplaced-banner-hint">
      Edit this page and paste the link where you want the diagram — Confluence turns it into the diagram itself.
    </div>

    <div v-if="expanded && rows.length > 1" class="unplaced__rows">
      <div v-for="d in rows" :key="d.id" class="unplaced__row" data-testid="unplaced-banner-row">
        <span class="unplaced__row-title" :title="d.title">{{ d.title || 'Untitled diagram' }}</span>
        <span class="unplaced__row-type">{{ typeLabel(d.diagramType) }}</span>
        <button
          type="button"
          class="unplaced__btn unplaced__btn--secondary"
          :data-testid="copiedId === d.id ? 'unplaced-banner-copied' : 'unplaced-banner-copy'"
          @click="onCopy(d)"
        >{{ copiedId === d.id ? '✓ Link copied' : 'Copy link' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeUnmount, onMounted } from 'vue'
import globals from '@/model/globals'
import forgeGlobal, { getView } from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import type { MacroTypeValue } from '@/utils/analytics/catalog'
import { toMacroType, typeLabel } from '@/utils/byline/pageDiagrams'
import { buildDiagramDeeplink } from '@/utils/embedDeeplink'
import {
  deriveUnplacedIdentity,
  readUnplacedMarker,
  recordUnplacedBannerDismissed,
  recordUnplacedBannerResolved,
  recordUnplacedBannerShown,
  type UnplacedDiagramEntry,
  type UnplacedIdentity,
} from '@/utils/byline/unplacedMarker'

/**
 * "Saved here, but on no page" — said on the surface that is actually read.
 *
 * The byline already labels these diagrams (`isUnplaced` in BylineDiagrams.vue),
 * but its iframe boots only when the byline item is CLICKED: 5 opens against
 * 39,197 macro views. So the one fact a user needs — a diagram they saved is
 * costing them a Lite macro slot and rendering nowhere — is told exclusively to
 * people who go looking for it. This banner mounts with the page.
 *
 * It is deliberately the SECOND half of the check. The candidate gate
 * (isUnplacedBannerCandidate, run inside decidePageBanner) is synchronous
 * localStorage, so a page with no marker costs nothing at all. Only past that
 * gate does this component spend the one full-page ADF read that turns a
 * remembered verdict into a current one.
 *
 * That verification is not optional. The marker records what the byline saw,
 * and the user may have pasted the link a second later; a banner insisting a
 * placed diagram is missing would be worse than no banner. So there are exactly
 * three outcomes, and two of them close the iframe:
 *
 *   - the scan proves some entries are still unreferenced → show them
 *   - the scan finds them all placed → record it, so this marker version never
 *     costs another read, and close
 *   - the scan fails → close. We never claim what we could not verify.
 */
const visible = ref(false)
const expanded = ref(false)
const rows = ref<UnplacedDiagramEntry[]>([])
const copiedId = ref<string | null>(null)
const COPY_FLASH_MS = 4000
let copyFlashTimer: ReturnType<typeof setTimeout> | null = null

let identity: UnplacedIdentity | null = null
let markerUpdatedAt = ''

const baseProps = () => ({
  feature_area: 'byline' as const,
  surface: 'page_banner' as const,
})

async function closeBanner() {
  try {
    const view = await getView()
    await view.close()
  } catch (e) {
    console.debug('[unplaced-banner] view close failed', e)
  }
}

onMounted(async () => {
  // The page banner mounts on every Confluence page. Every path out of here
  // that does not show something must end in view.close() — never a stranded
  // empty banner frame holding a reserved slot open.
  try {
    identity = deriveUnplacedIdentity()
    const marker = identity ? readUnplacedMarker(identity) : null
    if (!identity || !marker || marker.entries.length === 0) {
      await closeBanner()
      return
    }
    markerUpdatedAt = marker.updatedAt
    const markerAgeMs = Date.now() - Date.parse(marker.updatedAt)

    // No initializeContext() here: the page-banner host (routes/pageBanner.ts)
    // awaits it before mounting, and it is not free.
    const referenced = await globals.apWrapper.referencedCustomContentIds()
    // `undefined` is "the page ADF could not be read", NOT "no macros" — the
    // same distinction the byline's own scan turns on. Treating them alike here
    // would announce every saved diagram as missing on any page we merely
    // failed to read.
    if (!referenced) {
      trackAnalyticsEvent('unplaced_banner_evaluated', {
        ...baseProps(),
        result: 'scan_failed',
        unplaced_marker_age_ms: markerAgeMs,
      })
      await closeBanner()
      return
    }

    const placed = new Set(referenced)
    const stillUnplaced = marker.entries.filter(e => !placed.has(e.id))
    if (stillUnplaced.length === 0) {
      // Stale marker: the user has placed them since. Record it against this
      // marker version so the next load exits at the synchronous gate instead
      // of buying the same ADF read again.
      recordUnplacedBannerResolved(identity, marker.updatedAt)
      trackAnalyticsEvent('unplaced_banner_evaluated', {
        ...baseProps(),
        result: 'all_placed',
        unplaced_count: 0,
        unplaced_marker_age_ms: markerAgeMs,
      })
      await closeBanner()
      return
    }

    rows.value = stillUnplaced
    visible.value = true
    recordUnplacedBannerShown(identity)
    trackAnalyticsEvent('unplaced_banner_evaluated', {
      ...baseProps(),
      result: 'unplaced',
      unplaced_count: stillUnplaced.length,
      unplaced_marker_age_ms: markerAgeMs,
    })
    trackAnalyticsEvent('unplaced_banner_shown', {
      ...baseProps(),
      unplaced_count: stillUnplaced.length,
    })
  } catch (e) {
    console.warn('[unplaced-banner] mount failed; closing', e)
    await closeBanner()
  }
})

onBeforeUnmount(() => {
  if (copyFlashTimer) clearTimeout(copyFlashTimer)
})

/**
 * Copy the link that places the diagram, exactly as the byline's Copy URL does
 * — same builder, same event, different `ui_component`. Pasting the link into
 * the editor is the whole repair: Confluence auto-converts it into the macro
 * that renders this diagram.
 */
async function onCopy(entry: UnplacedDiagramEntry) {
  const cloudId = forgeGlobal.forgeContext?.cloudId
  const link = buildDiagramDeeplink(toMacroType(entry.diagramType), cloudId || '', entry.id)
  if (!link) {
    // Say nothing rather than put a broken URL on the clipboard.
    console.error('[unplaced-banner] no deeplink available', { cloudId: !!cloudId })
    trackAnalyticsEvent('advocacy_message_copied', {
      ...baseProps(),
      ui_component: 'page_banner_unplaced_link',
      macro_type: toMacroType(entry.diagramType) as MacroTypeValue,
      result: cloudId ? 'unlinkable_type' : 'no_cloud_id',
    })
    return
  }
  const copied = await copyText(link)
  if (copied) {
    copiedId.value = entry.id
    if (copyFlashTimer) clearTimeout(copyFlashTimer)
    copyFlashTimer = setTimeout(() => {
      copiedId.value = null
      copyFlashTimer = null
    }, COPY_FLASH_MS)
  }
  trackAnalyticsEvent('advocacy_message_copied', {
    ...baseProps(),
    ui_component: 'page_banner_unplaced_link',
    macro_type: toMacroType(entry.diagramType) as MacroTypeValue,
    copy_trigger: 'manual',
    result: copied ? 'copied' : 'failed',
  })
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (e) {
    console.error('[unplaced-banner] clipboard write failed', e)
    return false
  }
}

/**
 * Dismissal is scoped to the marker version, not snoozed for a window: these
 * diagrams stay silent for as long as they are the ones unplaced, and a NEW
 * one re-arms the banner. "Not now, about these" — never "never again".
 */
function onDismiss() {
  if (identity) recordUnplacedBannerDismissed(identity, markerUpdatedAt)
  trackAnalyticsEvent('unplaced_banner_dismissed', {
    ...baseProps(),
    unplaced_count: rows.value.length,
  })
  visible.value = false
  void closeBanner()
}
</script>

<style scoped>
.unplaced {
  padding: 7px 14px;
  background: #E9F2FF;
  border-bottom: 1px solid #A6C5F7;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 12px;
  color: #172B4D;
  line-height: 1.4;
  width: 100%;
  box-sizing: border-box;
}

.unplaced__line {
  display: flex;
  align-items: center;
  gap: 10px;
}

.unplaced__icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: #0055CC;
}

.unplaced__text {
  flex: 1 1 auto;
  min-width: 0;
}

.unplaced__btn {
  flex-shrink: 0;
  border-radius: 3px;
  border: none;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}

.unplaced__btn--primary {
  background: #0C66E4;
  color: #FFFFFF;
}

.unplaced__btn--primary:hover {
  background: #0055CC;
}

.unplaced__btn--secondary {
  background: rgba(9, 30, 66, 0.06);
  color: #172B4D;
}

.unplaced__btn--secondary:hover {
  background: rgba(9, 30, 66, 0.12);
}

.unplaced__dismiss {
  flex-shrink: 0;
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
  color: #626F86;
  display: flex;
  align-items: center;
}

.unplaced__dismiss:hover {
  color: #172B4D;
}

.unplaced__hint {
  margin: 4px 0 0 24px;
  color: #44546F;
}

.unplaced__rows {
  margin: 6px 0 2px 24px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.unplaced__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.unplaced__row-title {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
}

.unplaced__row-type {
  flex: 1 1 auto;
  color: #626F86;
}
</style>
