<template>
  <div class="byline" data-testid="byline-diagrams">
    <div v-if="loading" class="byline__loading" data-testid="byline-loading">Loading diagrams…</div>

    <template v-else>
      <div v-if="diagrams.length" class="byline__list" data-testid="byline-list">
        <div class="byline__heading">
          {{ diagrams.length }} {{ diagrams.length === 1 ? 'diagram' : 'diagrams' }} on this page
        </div>
        <ul class="byline__items">
          <li v-for="d in diagrams" :key="d.id" class="byline__item" data-testid="byline-item">
            <span class="byline__badge">{{ label(d.diagramType) }}</span>
            <span class="byline__title" :title="d.title">{{ d.title }}</span>
            <button
              v-if="d.copyable"
              class="byline__link"
              :data-testid="copiedId === d.id ? 'byline-copied' : 'byline-copy-source'"
              @click="onCopySource(d)"
            >{{ copiedId === d.id ? '✓ Copied' : 'Copy source' }}</button>
          </li>
        </ul>
      </div>

      <div v-else class="byline__empty" data-testid="byline-empty">
        <div class="byline__heading">No diagrams on this page yet</div>
        <p class="byline__hint">
          Sequence diagrams, flowcharts, graphs and API specs live inline on the page.
        </p>
      </div>

      <div class="byline__cta">
        <button class="byline__btn" data-testid="byline-add-diagram" @click="onAddDiagram">
          Add a diagram
        </button>
        <p class="byline__hint">
          Opens this page in the editor. Type <code>/zenuml</code> where you want the diagram.
        </p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import globals from '@/model/globals'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { getSpaceKey } from '@/utils/ContextParameters/ContextParameters'
import {
  parsePageDiagrams,
  summarizeDiagrams,
  typeLabel,
  type PageDiagram,
} from '@/utils/byline/pageDiagrams'

const loading = ref(true)
const diagrams = ref<PageDiagram[]>([])
const copiedId = ref<string | null>(null)

// Dwell is measured from mount (when the user's click actually opened this
// iframe), so byline_dismissed can tell a mis-click from a real evaluation.
const openedAt = Date.now()
// Set by any action that makes this a productive open; suppresses the
// "looked and left" event on unmount.
let acted = false
let pageId = ''

const label = typeLabel

function baseProps() {
  return {
    feature_area: 'byline' as const,
    surface: 'byline' as const,
    entry_point: 'byline' as const,
    ...summarizeDiagrams(diagrams.value),
  }
}

onMounted(async () => {
  try {
    pageId = await globals.apWrapper._getCurrentPageId()
    const responses = await globals.apWrapper.listPageDiagramContents(pageId)
    diagrams.value = parsePageDiagrams(responses)
  } catch (e) {
    // An unreadable page lists nothing; the create CTA still works, which is
    // the half of this modal that matters for activation.
    console.error('[byline] failed to list page diagrams', e)
    diagrams.value = []
  } finally {
    loading.value = false
    // Emitted after the list resolves so page_has_diagram / diagram_count are
    // populated — this event IS the Phase 1 readout, and a version of it
    // without those two properties would not answer the question it exists for.
    trackAnalyticsEvent('byline_opened', baseProps())
  }
})

onBeforeUnmount(() => {
  if (acted) return
  trackAnalyticsEvent('byline_dismissed', {
    ...baseProps(),
    dwell_ms: Date.now() - openedAt,
  })
})

async function onCopySource(d: PageDiagram) {
  acted = true
  try {
    await navigator.clipboard.writeText(d.source)
    copiedId.value = d.id
    setTimeout(() => {
      if (copiedId.value === d.id) copiedId.value = null
    }, 2000)
  } catch (e) {
    console.error('[byline] clipboard write failed', e)
  }
  trackAnalyticsEvent('byline_diagram_opened', {
    ...baseProps(),
    macro_type: d.diagramType as any,
  })
}

async function onAddDiagram() {
  acted = true
  trackAnalyticsEvent('byline_create_clicked', baseProps())
  try {
    const spaceKey = getSpaceKey() || ''
    const { router } = await import('@forge/bridge')
    // edit-v2 is the current Confluence editor route; the same one
    // DebugBar.vue navigates to for a page view.
    await router.navigate(`/wiki/spaces/${spaceKey}/pages/edit-v2/${pageId}`)
    trackAnalyticsEvent('byline_editor_deeplinked', baseProps())
  } catch (e) {
    // Kept distinct from byline_create_clicked on purpose: an intent to create
    // that never reached the editor is the failure this split exists to expose.
    console.error('[byline] editor navigation failed', e)
    trackAnalyticsEvent('byline_editor_deeplinked', {
      ...baseProps(),
      result: 'failed',
      failure_reason: (e as any)?.message ? String((e as any).message) : String(e),
    })
  }
}
</script>

<style scoped>
.byline {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #172b4d;
  padding: 16px;
}
.byline__heading {
  font-weight: 600;
  margin-bottom: 8px;
}
.byline__items {
  list-style: none;
  margin: 0 0 16px;
  padding: 0;
}
.byline__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #ebecf0;
}
.byline__badge {
  flex: none;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #5e6c84;
  background: #f4f5f7;
  border-radius: 3px;
  padding: 2px 6px;
}
.byline__title {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.byline__link {
  flex: none;
  background: none;
  border: none;
  padding: 0;
  color: #0052cc;
  cursor: pointer;
  font-size: 13px;
}
.byline__link:hover {
  text-decoration: underline;
}
.byline__empty {
  margin-bottom: 16px;
}
.byline__hint {
  color: #5e6c84;
  font-size: 12px;
  margin: 6px 0 0;
}
.byline__cta {
  border-top: 1px solid #ebecf0;
  padding-top: 12px;
}
.byline__btn {
  background: #0052cc;
  color: #fff;
  border: none;
  border-radius: 3px;
  padding: 6px 12px;
  font-size: 14px;
  cursor: pointer;
}
.byline__btn:hover {
  background: #0065ff;
}
.byline__loading {
  color: #5e6c84;
}
code {
  background: #f4f5f7;
  border-radius: 3px;
  padding: 0 4px;
}
</style>
