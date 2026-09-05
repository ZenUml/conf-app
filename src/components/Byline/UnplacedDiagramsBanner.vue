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
      <!-- One click finishes the job. The four-step alternative — copy, open
           the editor, paste, publish — is what the user already abandoned once;
           that is why this diagram is unplaced. Copy link stays as the fallback
           for a reader who cannot edit the page (see `canEdit`). -->
      <!-- One click finishes the job. The four-step alternative — copy, open
           the editor, paste, publish — is what the user already abandoned once;
           that is why this diagram is unplaced. -->
      <button
        v-if="rows.length === 1 && canEdit"
        type="button"
        class="unplaced__btn unplaced__btn--primary"
        :disabled="addingId === rows[0].id"
        data-testid="unplaced-banner-add"
        @click="onAddToPage(rows[0])"
      >{{ addingId === rows[0].id ? 'Adding…' : 'Add to page' }}</button>
      <!-- Copy link stays even when the button works: placing it HERE is not the
           only reason to want the link — sending it to someone, or putting the
           diagram on a different page, are both real — and it is the fallback
           when the write is refused. -->
      <button
        v-if="rows.length === 1"
        type="button"
        class="unplaced__btn"
        :class="canEdit ? 'unplaced__btn--secondary' : 'unplaced__btn--primary'"
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
    <div v-if="addFailure" class="unplaced__hint" data-testid="unplaced-banner-add-failed">
      {{ addFailure }}
    </div>
    <div v-else-if="copiedId" class="unplaced__hint" data-testid="unplaced-banner-hint">
      Edit this page and paste the link where you want the diagram — Confluence turns it into the diagram itself.
    </div>

    <div v-if="expanded && rows.length > 1" class="unplaced__rows">
      <div v-for="d in rows" :key="d.id" class="unplaced__row" data-testid="unplaced-banner-row">
        <span class="unplaced__row-title" :title="d.title">{{ d.title || 'Untitled diagram' }}</span>
        <span class="unplaced__row-type">{{ typeLabel(d.diagramType) }}</span>
        <button
          v-if="canEdit"
          type="button"
          class="unplaced__btn unplaced__btn--primary"
          :disabled="addingId === d.id"
          data-testid="unplaced-banner-add"
          @click="onAddToPage(d)"
        >{{ addingId === d.id ? 'Adding…' : 'Add to page' }}</button>
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
  hasExhaustedShows,
  isDismissalQuiet,
  readUnplacedBannerMarker,
  readUnplacedMarker,
  recordUnplacedBannerDismissed,
  recordUnplacedBannerResolved,
  recordUnplacedBannerShown,
  UNPLACED_MARKER_TTL_MS,
  type UnplacedDiagramEntry,
  type UnplacedIdentity,
} from '@/utils/byline/unplacedMarker'
import { clearUnplacedProperty, readUnplacedProperty } from '@/utils/byline/unplacedProperty'
import { higherPriorityBannerPending } from '@/utils/banners/priority'
import { addDiagramToPage } from '@/utils/byline/addToPage'

/**
 * "Saved here, but on no page" — said on the surface that is actually read.
 *
 * The byline already labels these diagrams (`isUnplaced` in BylineDiagrams.vue),
 * but its iframe boots only when the byline item is CLICKED: 5 opens against
 * 39,197 macro views. So the one fact a user needs — a diagram they saved is
 * costing them a Lite macro slot and rendering nowhere — is told exclusively to
 * people who go looking for it. This banner mounts with the page.
 *
 * It is deliberately the SECOND half of the check, and which store it reads is
 * the host's decision (`source`), not this component's:
 *
 *   - `property` — the dedicated `zenuml-unplaced-banner` module, which
 *     Confluence gated server-side on the content property. Reaching this
 *     component at all means the page HAS a record, so there is no local gate
 *     to run. This is the cross-user path: everyone who opens the page is told.
 *   - `marker` — the shared page-banner host, off the per-browser localStorage
 *     fallback written when the property write was denied. Creator-only reach.
 *
 * Either way the record is verified before anything is said. It states what the
 * byline saw, and the user may have pasted the link a second later; a banner
 * insisting a placed diagram is missing would be worse than no banner. So there
 * are exactly three outcomes, and two of them close the iframe:
 *
 *   - the scan proves some entries are still unreferenced → show them
 *   - the scan finds them all placed → retire the record (DELETE the property /
 *     stamp the marker resolved) so this never costs another read, and close
 *   - the scan fails → close. We never claim what we could not verify.
 */
const props = withDefaults(defineProps<{ source?: 'property' | 'marker' }>(), {
  source: 'marker',
})

const visible = ref(false)
const expanded = ref(false)
const rows = ref<UnplacedDiagramEntry[]>([])
const copiedId = ref<string | null>(null)
const addingId = ref<string | null>(null)
/** Set only when a write could not land, so the copy fallback has a reason. */
const addFailure = ref<string | null>(null)
/**
 * Whether to offer the one-click place at all.
 *
 * Starts true and flips off the first time a write comes back 'forbidden'.
 * Deliberately optimistic: knowing up front would cost a permissions request on
 * every banner load, to spare a minority one refused click — and the refusal is
 * handled, with the link offered in its place.
 */
const canEdit = ref(true)
const COPY_FLASH_MS = 4000
let copyFlashTimer: ReturnType<typeof setTimeout> | null = null

let identity: UnplacedIdentity | null = null
/** The version of whichever record admitted this load — property or marker. */
let recordUpdatedAt = ''

const baseProps = () => ({
  feature_area: 'byline' as const,
  surface: 'page_banner' as const,
  unplaced_source: props.source,
})

async function closeBanner() {
  try {
    const view = await getView()
    await view.close()
  } catch (e) {
    console.debug('[unplaced-banner] view close failed', e)
  }
}

/**
 * Read whichever store the host says admitted this load.
 *
 * The property read is one REST call, and it happens only on a page Confluence
 * has already confirmed carries the property — the gate means we are never
 * paying it speculatively.
 */
async function readRecord(): Promise<{ entries: UnplacedDiagramEntry[]; updatedAt: string } | null> {
  if (!identity) return null
  if (props.source === 'property') {
    const read = await readUnplacedProperty(identity.pageId)
    // The display condition said the property exists, so anything but a clean
    // read here is a state we cannot describe — say nothing.
    if (read.status !== 'ok' || read.value.entries.length === 0) return null
    return read.value
  }
  const marker = readUnplacedMarker(identity)
  if (!marker || marker.entries.length === 0) return null
  // The fallback exists for browsers whose property write was DENIED. If the
  // property turns out to exist anyway — a second author's write landed — then
  // the gated module is already showing this page's notice, and continuing here
  // would stack two banners saying the same thing. `viaProperty` cannot catch
  // that case: it records only what THIS browser managed to write.
  //
  // Fail CLOSED: only `absent` proves no gated module can be painting. A read
  // that 403s or errors leaves that open, and a stacked banner is a worse
  // outcome than a missed one — this notice re-arms on the next load, and the
  // gated module reaches everyone anyway on exactly the pages where the read
  // being unreadable is most likely to mean "the property is there".
  const property = await readUnplacedProperty(identity.pageId)
  if (property.status !== 'absent') return null
  return marker
}

onMounted(async () => {
  // The page banner mounts on every Confluence page. Every path out of here
  // that does not show something must end in view.close() — never a stranded
  // empty banner frame holding a reserved slot open.
  try {
    identity = deriveUnplacedIdentity()
    if (!identity) {
      await closeBanner()
      return
    }

    // Stand down for a banner that outranks this one. Two Confluence modules
    // means two iframes, and the host's priority cascade cannot reach this one
    // — so it asks the same question from the same synchronous reads. Checked
    // before the record, so yielding costs no request at all.
    //
    // It can over-yield: CsatBanner re-runs an async suppression check and may
    // still close itself, leaving this load with no banner where one was
    // possible. That is the trade the ordering already accepts — this notice is
    // the one that keeps, and it re-arms on the next load.
    const higher = higherPriorityBannerPending()
    if (higher) {
      trackAnalyticsEvent('unplaced_banner_evaluated', {
        ...baseProps(),
        result: 'yielded',
        suppressed_by: higher,
      })
      await closeBanner()
      return
    }

    // Dismissal lives in localStorage for BOTH sources, and deliberately so:
    // one person deciding they do not want to see this must not silence it for
    // everyone else on a shared page.
    //
    // Checked FIRST, and without the record, because on the property path
    // Confluence gates on page state and cannot know this user said no — so a
    // dismissing user would buy a REST call on every load of the page forever.
    // The quiet window is short enough that a genuinely new diagram still
    // surfaces the next day, where the version-scoped check below takes over.
    if (isDismissalQuiet(identity)) {
      await closeBanner()
      return
    }

    const record = await readRecord()
    if (!record) {
      // Reaching here on the property path means the gate fired but the record
      // did not read back — forbidden, malformed, or already emptied. It is a
      // real load with a real cost, so it is reported rather than swallowed:
      // the catalog promises this event fires on every load past the gate.
      trackAnalyticsEvent('unplaced_banner_evaluated', {
        ...baseProps(),
        result: 'record_unreadable',
      })
      await closeBanner()
      return
    }
    recordUpdatedAt = record.updatedAt
    const recordAgeMs = Date.now() - Date.parse(record.updatedAt)

    if (readUnplacedBannerMarker(identity).dismissedFor === record.updatedAt) {
      await closeBanner()
      return
    }

    // Stale beyond the TTL: nobody has re-confirmed this in a month. Stop
    // buying an ADF read for it on every load — the same bound the marker gate
    // applies, now applied to the property, which Confluence will otherwise
    // keep booting forever.
    if (Number.isFinite(recordAgeMs) && recordAgeMs > UNPLACED_MARKER_TTL_MS) {
      trackAnalyticsEvent('unplaced_banner_evaluated', {
        ...baseProps(),
        result: 'expired',
        unplaced_marker_age_ms: recordAgeMs,
      })
      await closeBanner()
      return
    }

    // Shown enough times already for this exact record. Placing the diagram or
    // dismissing the notice ends it properly; this only stops the nagging.
    if (hasExhaustedShows(identity, record.updatedAt)) {
      trackAnalyticsEvent('unplaced_banner_evaluated', {
        ...baseProps(),
        result: 'shows_exhausted',
        unplaced_count: record.entries.length,
        unplaced_marker_age_ms: recordAgeMs,
      })
      await closeBanner()
      return
    }

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
        unplaced_marker_age_ms: recordAgeMs,
      })
      await closeBanner()
      return
    }

    const placed = new Set(referenced)
    const stillUnplaced = record.entries.filter(e => !placed.has(e.id))
    if (stillUnplaced.length === 0) {
      // Stale record: the user has placed them since. Retire it so the next
      // load does not buy the same ADF read again — for the property that means
      // DELETING it, which takes the page off the display-condition gate
      // entirely and stops the iframe booting at all. A viewer without
      // permission to delete it simply fails here; the record stays and the
      // next reader pays one more read, which is the cost of not letting a
      // reader silence a page-level fact they cannot verify away.
      if (props.source === 'property') {
        // Reported, not assumed: a reader without delete permission leaves the
        // record standing, and every later reader keeps paying the ADF read.
        // Silent, that looks identical to a clean retire.
        const cleared = await clearUnplacedProperty(identity.pageId)
        trackAnalyticsEvent('unplaced_property_write', {
          ...baseProps(),
          result: cleared,
          unplaced_count: 0,
        })
      } else {
        recordUnplacedBannerResolved(identity, record.updatedAt)
      }
      trackAnalyticsEvent('unplaced_banner_evaluated', {
        ...baseProps(),
        result: 'all_placed',
        unplaced_count: 0,
        unplaced_marker_age_ms: recordAgeMs,
      })
      await closeBanner()
      return
    }

    rows.value = stillUnplaced
    visible.value = true
    recordUnplacedBannerShown(identity, record.updatedAt)
    trackAnalyticsEvent('unplaced_banner_evaluated', {
      ...baseProps(),
      result: 'unplaced',
      unplaced_count: stillUnplaced.length,
      unplaced_marker_age_ms: recordAgeMs,
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
 * Place the diagram on the page, in one click.
 *
 * On success the row is gone and the record is retired immediately rather than
 * left for the next load's verification: the page just changed, and a banner
 * that keeps naming a diagram the user has visibly placed is the exact wrong
 * answer. When the last row goes, so does the banner.
 */
async function onAddToPage(entry: UnplacedDiagramEntry) {
  if (!identity || addingId.value) return
  addingId.value = entry.id
  addFailure.value = null
  const { result, pageMacroCount } = await addDiagramToPage(identity.pageId, entry)
  addingId.value = null
  trackAnalyticsEvent('diagram_added_to_page', {
    ...baseProps(),
    macro_type: toMacroType(entry.diagramType) as MacroTypeValue,
    result,
    ...(pageMacroCount === undefined ? {} : { page_macro_count: pageMacroCount }),
  })

  if (result === 'forbidden') {
    // Expected on a notice that reaches every reader: a reader is not always an
    // author. Hand over the link instead of leaving a button that cannot work.
    canEdit.value = false
    addFailure.value = 'You do not have permission to edit this page — copy the link and send it to someone who does.'
    return
  }
  if (result === 'conflict') {
    addFailure.value = 'Someone edited the page while we were adding it. Reload and try again.'
    return
  }
  if (result === 'failed') {
    addFailure.value = "Couldn't add it to the page. Copy the link and paste it into the editor instead."
    canEdit.value = false
    return
  }

  // 'added' or 'already_present' — either way the page now renders it.
  rows.value = rows.value.filter(r => r.id !== entry.id)
  if (rows.value.length === 0) {
    if (props.source === 'property') void clearUnplacedProperty(identity.pageId)
    else recordUnplacedBannerResolved(identity, recordUpdatedAt)
    visible.value = false
    void closeBanner()
  }
}

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
  if (identity) recordUnplacedBannerDismissed(identity, recordUpdatedAt)
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
