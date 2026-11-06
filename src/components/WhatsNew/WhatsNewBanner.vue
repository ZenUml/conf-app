<template>
  <div v-if="visible" class="whatsnew" data-testid="whats-new-banner">
    <div class="whatsnew__line">
      <svg class="whatsnew__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
        <path d="M19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z" />
      </svg>
      <span class="whatsnew__text">
        <strong>What's new in {{ productName }}:</strong> {{ release.headline }}
      </span>
      <button
        type="button"
        class="whatsnew__btn"
        data-testid="whats-new-toggle"
        :aria-expanded="expanded"
        aria-controls="whats-new-items"
        @click="onToggle"
      >{{ expanded ? 'Hide' : "See what's new" }}</button>
      <button
        type="button"
        class="whatsnew__dismiss"
        aria-label="Dismiss"
        data-testid="whats-new-dismiss"
        @click="onDismiss"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>

    <ul v-if="expanded" id="whats-new-items" class="whatsnew__items">
      <li v-for="item in release.items" :key="item.id" class="whatsnew__item" data-testid="whats-new-item">
        <span class="whatsnew__item-title">{{ item.title }}</span>
        <span class="whatsnew__item-body">{{ item.body }}</span>
        <button
          v-if="item.url"
          type="button"
          class="whatsnew__link"
          data-testid="whats-new-link"
          @click="onLink(item)"
        >Learn more</button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getView, openUrl } from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { deriveUnplacedIdentity } from '@/utils/byline/unplacedMarker'
import { readUnplacedProperty } from '@/utils/byline/unplacedProperty'
import type { WhatsNewItem, WhatsNewRelease } from '@/utils/whatsNew/releases'
import { recordWhatsNewDismissed, recordWhatsNewShown } from '@/utils/whatsNew/state'

/**
 * "What's new" — release notes as an inline, expandable page-banner strip.
 *
 * Inline rather than a dialog on purpose: a @forge/bridge Modal opened from the
 * confluence:pageBanner module is accepted (the bridge resolves `true`) and
 * then never rendered, while the identical call from a macro iframe opens one
 * (spot check on lite-stg, 2026-10-03). The strip expands in place instead;
 * Confluence resizes the banner iframe to fit, as it does for the unplaced
 * notice's diagram list.
 *
 * The host (routes/pageBanner.ts) already ran the synchronous gate — live
 * release, audience marker, not dismissed, under the impression cap — and
 * hands over the release. What is left here is the one thing the host cannot
 * see: whether the separately gated unplaced-diagram module is painting on this
 * page. That module is its own iframe, so the host's priority cascade cannot
 * reach it, and two strips stacked on one page is what Atlassian's "no more
 * than one banner at a time" rule forbids. One property read settles it, and it
 * is paid only on loads that would otherwise show — at most WHATS_NEW_MAX_SHOWS
 * per release per browser.
 */
const props = defineProps<{ release: WhatsNewRelease }>()

const visible = ref(false)
const expanded = ref(false)

const productName = computed(() =>
  import.meta.env.PRODUCT_TYPE === 'diagramly' ? 'Diagramly' : 'ZenUML'
)

const baseProps = () => ({
  feature_area: 'whats_new' as const,
  surface: 'page_banner' as const,
  whats_new_release_id: props.release.id,
})

async function closeBanner() {
  try {
    const view = await getView()
    await view.close()
  } catch (e) {
    console.debug('[whats-new] view close failed', e)
  }
}

onMounted(async () => {
  // Mounted on a page load the host admitted. Every path that does not show
  // the strip must end in view.close() — never a stranded empty banner frame.
  try {
    const identity = deriveUnplacedIdentity()
    if (identity) {
      // Fail CLOSED, as the unplaced fallback does: only 'absent' proves the
      // gated module is not painting. A missed announcement re-arms on the next
      // load; a stacked banner cannot be taken back.
      const property = await readUnplacedProperty(identity.pageId)
      if (property.status !== 'absent') {
        trackAnalyticsEvent('whats_new_banner_evaluated', { ...baseProps(), result: 'yielded_unplaced' })
        await closeBanner()
        return
      }
    }

    const showCount = recordWhatsNewShown(props.release.id)
    visible.value = true
    trackAnalyticsEvent('whats_new_banner_evaluated', { ...baseProps(), result: 'shown' })
    trackAnalyticsEvent('whats_new_banner_shown', { ...baseProps(), whats_new_show_count: showCount })
  } catch (e) {
    console.warn('[whats-new] banner mount failed; closing', e)
    trackAnalyticsEvent('whats_new_banner_evaluated', { ...baseProps(), result: 'failed' })
    await closeBanner()
  }
})

function onToggle() {
  expanded.value = !expanded.value
  if (expanded.value) trackAnalyticsEvent('whats_new_banner_expanded', baseProps())
}

async function onDismiss() {
  // Persist before closing: view.close() tears the iframe down.
  recordWhatsNewDismissed(props.release.id)
  trackAnalyticsEvent('whats_new_banner_dismissed', {
    ...baseProps(),
    whats_new_expanded: expanded.value,
  })
  visible.value = false
  await closeBanner()
}

async function onLink(item: WhatsNewItem) {
  if (!item.url) return
  trackAnalyticsEvent('whats_new_link_clicked', { ...baseProps(), whats_new_item_id: item.id })
  // router.open under Forge; a raw target="_blank" anchor is dropped by the
  // iframe sandbox (no allow-popups).
  await openUrl(item.url)
}
</script>

<style scoped>
.whatsnew {
  padding: 7px 14px;
  background: #F3F0FF;
  border-bottom: 1px solid #B8ACF6;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 12px;
  color: #172B4D;
  line-height: 1.4;
  width: 100%;
  box-sizing: border-box;
}

.whatsnew__line {
  display: flex;
  align-items: center;
  gap: 10px;
}

.whatsnew__icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: #5E4DB2;
}

.whatsnew__text {
  flex: 1 1 auto;
  min-width: 0;
}

.whatsnew__btn {
  flex-shrink: 0;
  border-radius: 3px;
  border: none;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  background: rgba(9, 30, 66, 0.06);
  color: #172B4D;
}

.whatsnew__btn:hover {
  background: rgba(9, 30, 66, 0.12);
}

.whatsnew__dismiss {
  flex-shrink: 0;
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
  color: #626F86;
  display: flex;
  align-items: center;
}

.whatsnew__dismiss:hover {
  color: #172B4D;
}

.whatsnew__items {
  list-style: none;
  margin: 6px 0 2px 24px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.whatsnew__item {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
}

.whatsnew__item-title {
  font-weight: 600;
}

.whatsnew__item-body {
  color: #44546F;
}

.whatsnew__link {
  background: none;
  border: none;
  padding: 0;
  font-size: 12px;
  font-family: inherit;
  color: #0C66E4;
  cursor: pointer;
}

.whatsnew__link:hover {
  text-decoration: underline;
}
</style>
