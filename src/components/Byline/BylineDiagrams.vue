<template>
  <div class="byline" data-testid="byline-diagrams">
    <!-- Header. Present in every state so the shell never shifts between them. -->
    <div class="byline__header">
      <img class="byline__logo" :src="LOGO_SRC" alt="" />
      <span class="byline__heading">Diagrams on this page</span>
      <span v-if="!loading && !failed && diagrams.length" class="byline__pill" data-testid="byline-count">
        {{ diagrams.length }}
      </span>
    </div>

    <!-- Post-create. The diagram is saved and already listed; the only thing
         left is placing it on the page, so this takes over the body until the
         user dismisses it. -->
    <div v-if="createdLink" class="byline__body byline__body--stack" data-testid="byline-created">
      <div class="hero">
        <div class="hero__title">Diagram saved</div>
        <div class="hero__sub">
          {{ createdCopied ? 'Link copied.' : 'Copy this link,' }}
          Paste it into the page where you want the diagram to appear.
        </div>
      </div>
      <div class="linkbox">
        <code class="linkbox__url" data-testid="byline-created-link">{{ createdLink }}</code>
        <button class="btn-secondary" data-testid="byline-copy-link" @click="onCopyCreatedLink">
          {{ createdCopied ? '✓ Copied' : 'Copy link' }}
        </button>
      </div>
      <p class="byline__hint">
        Pasting the link converts it into an embedded diagram — it stays linked to
        this one, so edits show up everywhere it is placed.
      </p>
    </div>

    <!-- State 3: loading. Four skeleton cards, so the grid does not reflow when
         the real cards land. -->
    <div v-else-if="loading" class="byline__body byline__body--grid" data-testid="byline-loading">
      <div v-for="n in 4" :key="n" class="skel" :class="{ 'skel--static': n > 2 }">
        <div class="skel__preview"></div>
        <div class="skel__meta">
          <div class="skel__bar skel__bar--title" :style="{ width: SKELETON_TITLE_WIDTHS[n - 1] }"></div>
          <div class="skel__bar skel__bar--sub" :style="{ width: SKELETON_SUB_WIDTHS[n - 1] }"></div>
        </div>
      </div>
    </div>

    <!-- State 1: the page has diagrams. -->
    <div v-else-if="diagrams.length" class="byline__body byline__body--grid" :class="{ 'byline__body--paged': diagrams.length > 3 }" data-testid="byline-list">
      <div
        v-for="d in diagrams"
        :key="d.id"
        class="card"
        data-testid="byline-item"
        @click="onOpenDiagram(d)"
      >
        <div class="card__preview">
          <img v-if="thumbs[d.id]" class="card__thumb" :src="thumbs[d.id]" alt="" data-testid="byline-thumb" />
          <img v-else class="card__icon" :src="macroIcon(d.diagramType)" alt="" />
        </div>
        <div class="card__meta">
          <div class="card__title" :title="d.title">{{ d.title }}</div>
          <div class="card__row">
            <span class="card__type">{{ label(d.diagramType) }}</span>
            <button
              v-if="d.copyable"
              class="card__action"
              :data-testid="copiedId === d.id ? 'byline-copied' : 'byline-copy-source'"
              @click.stop="onCopySource(d)"
            >{{ copiedId === d.id ? '✓ Copied' : 'Copy source' }}</button>
            <span v-else-if="!thumbs[d.id]" class="card__nopreview">No preview</span>
          </div>
        </div>
      </div>

      <!-- Always the last cell, so the grid is never ragged. -->
      <div class="addtile" data-testid="byline-add-tile" @click="onAddDiagram()">
        <span class="addtile__plus">+</span>
        <span class="addtile__label">Add a diagram</span>
      </div>
    </div>

    <!-- State 4: the listing failed. Creating still works, so the picker stays
         and only the banner explains what happened. -->
    <div v-else-if="failed" class="byline__body byline__body--stack" data-testid="byline-failed">
      <div class="banner">
        <div class="banner__text">
          <div class="banner__title">Couldn't list this page's diagrams</div>
          <div class="banner__sub">Usually restricted content. Adding one still works.</div>
        </div>
        <button class="btn-secondary" data-testid="byline-retry" @click="onRetry">Try again</button>
      </div>
      <div class="typegrid">
        <div
          v-for="t in DIAGRAM_TYPES"
          :key="t.key"
          class="tile"
          :data-testid="`byline-type-${t.key}`"
          @click="onAddDiagram(t.macroType, t.diagramType)"
        >
          <div class="tile__preview">
            <img v-if="t.example" class="tile__example" :src="t.example" alt="" />
            <img v-else class="tile__bigicon" :src="t.icon" alt="" />
          </div>
          <div class="tile__label tile__label--compact">
            <img class="tile__icon" :src="t.icon" alt="" />
            <span class="tile__name">{{ t.name }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- State 2: empty page — the state most users see, and the one that has to
         earn a first diagram. -->
    <div v-else class="byline__body byline__body--stack" data-testid="byline-empty">
      <div class="hero">
        <div class="hero__title">Nothing diagrammed here yet</div>
        <div class="hero__sub">Pick a type — we'll copy a link and open the editor. Paste it where you want the diagram.</div>
      </div>
      <div class="typegrid">
        <div
          v-for="t in DIAGRAM_TYPES"
          :key="t.key"
          class="tile"
          :data-testid="`byline-type-${t.key}`"
          @click="onAddDiagram(t.macroType, t.diagramType)"
        >
          <div class="tile__preview">
            <img v-if="t.example" class="tile__example" :src="t.example" alt="" />
            <img v-else class="tile__bigicon" :src="t.icon" alt="" />
          </div>
          <div class="tile__label">
            <img class="tile__icon" :src="t.icon" alt="" />
            <span class="tile__text">
              <span class="tile__name">{{ t.name }}</span>
              <span class="tile__desc">{{ t.desc }}</span>
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer. Pinned in every state; only the hint and the right slot vary. -->
    <div class="byline__footer">
      <span class="byline__hint">
        <template v-if="createdLink">The diagram is saved whether or not you paste it now.</template>
        <template v-else-if="loading">Reading this page…</template>
        <template v-else-if="failed">Type <code>/zenuml</code> anywhere on the page.</template>
        <template v-else-if="diagrams.length">Click a diagram to jump to it on the page.</template>
        <template v-else>Already editing? Type <code>/zenuml</code> anywhere on the page.</template>
      </span>
      <button
        v-if="createdLink"
        class="btn-primary"
        data-testid="byline-created-done"
        @click="onDismissCreated"
      >Done</button>
      <a
        v-else-if="!loading && !failed && !diagrams.length"
        class="byline__learn"
        href="#"
        data-testid="byline-learn-more"
        @click.prevent="onLearnMore"
      >Learn more</a>
      <button
        v-else
        class="btn-primary"
        :class="{ 'btn-primary--muted': loading || creating }"
        :disabled="loading || creating"
        data-testid="byline-add-diagram"
        @click="onAddDiagram()"
      >Add a diagram</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import globals from '@/model/globals'
import forgeGlobal, { openModal } from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { getSpaceKey } from '@/utils/ContextParameters/ContextParameters'
import { DiagramType } from '@/model/Diagram/Diagram'
import type { MacroTypeValue } from '@/utils/analytics/catalog'
import {
  parsePageDiagrams,
  summarizeDiagrams,
  typeLabel,
  toMacroType,
  toModalDiagramType,
  type PageDiagram,
} from '@/utils/byline/pageDiagrams'
import { indexThumbnails, fetchThumbnailDataUrl } from '@/utils/byline/thumbnails'
import { buildEmbedDeeplink, newlyCreatedId } from '@/utils/embedDeeplink'

const loading = ref(true)
const diagrams = ref<PageDiagram[]>([])
const copiedId = ref<string | null>(null)
/** Separates "this page has no diagrams" (state 2) from "we could not find out"
 *  (state 4). Previously both collapsed into the empty state, which told a user
 *  with restricted content that their diagrams did not exist. */
const failed = ref(false)
/** customContentId -> data: URL. Fills in after the cards paint. */
const thumbs = ref<Record<string, string>>({})

/** Pathological pages exist (demo pages, architecture indexes). Each thumbnail
 *  is its own authenticated round trip, so cap the fan-out — cards past the cap
 *  keep the icon fallback, which is already a supported state. */
const MAX_THUMBNAILS = 12

/** Public-directory assets are referenced RELATIVELY: vite.config sets
 *  `base: './'`, and the Forge CDN serves this app under a hashed path, so a
 *  leading-slash URL resolves against the CDN root and 404s (all four icons and
 *  both example renders came back broken on lite-stg). The proven convention in
 *  this repo is relative — see the DrawIO loader and ForgeGraphEditor's iframe.
 *
 *  It has to be a BOUND src, not a literal one: the Vue SFC compiler rewrites a
 *  static relative `src` attribute into a module import, which fails the build
 *  because these files live in public/ and are never processed by Rollup. Every
 *  other icon here is already bound through DIAGRAM_TYPES / MACRO_ICONS. */
const LOGO_SRC = './image/zenuml_logo.png'

/** Set once the user saves a diagram from the byline editor: the deeplink to
 *  paste onto the page. Its presence switches the modal to the "now paste it"
 *  panel — the diagram exists at that point, so the only thing left is placing
 *  it. */
const createdLink = ref<string | null>(null)
const createdCopied = ref(false)
const creating = ref(false)

const SKELETON_TITLE_WIDTHS = ['70%', '55%', '62%', '48%']
const SKELETON_SUB_WIDTHS = ['40%', '35%', '30%', '26%']

interface TypeTile {
  key: string
  name: string
  desc: string
  icon: string
  example?: string
  macroType: MacroTypeValue
  /** Storage `diagramType`, used to build the paste-to-create link. Distinct
   *  from `macroType`, which is the analytics vocabulary. */
  diagramType: string
}

/** The picker shown on an empty or unreadable page. `macroType` rides on
 *  `byline_create_clicked` so the funnel can be split by what the user reached
 *  for — the tiles are the only place we learn intended type before the editor. */
const DIAGRAM_TYPES: TypeTile[] = [
  {
    key: 'sequence',
    diagramType: DiagramType.Sequence,
    name: 'Sequence',
    desc: 'Who calls what, in order',
    icon: './image/diagram_macro_icon.png',
    example: './image/byline-example-sequence.png',
    macroType: 'sequence',
  },
  {
    key: 'flowchart',
    diagramType: DiagramType.Mermaid,
    name: 'Flowchart',
    desc: 'Mermaid or PlantUML',
    icon: './image/diagram_macro_icon.png',
    example: './image/byline-example-flowchart.png',
    macroType: 'mermaid',
  },
  {
    key: 'graph',
    diagramType: DiagramType.Graph,
    name: 'Graph',
    desc: 'Free-form, DrawIO',
    icon: './image/graph_macro_icon.png',
    macroType: 'graph',
  },
  {
    key: 'openapi',
    diagramType: DiagramType.OpenApi,
    name: 'OpenAPI',
    desc: 'Render a spec inline',
    icon: './image/openapi_macro_icon.png',
    macroType: 'openapi',
  },
]

const MACRO_ICONS: Record<string, string> = {
  [DiagramType.Sequence]: './image/diagram_macro_icon.png',
  [DiagramType.Mermaid]: './image/diagram_macro_icon.png',
  [DiagramType.PlantUml]: './image/diagram_macro_icon.png',
  [DiagramType.Graph]: './image/graph_macro_icon.png',
  [DiagramType.OpenApi]: './image/openapi_macro_icon.png',
  [DiagramType.AsyncApi]: './image/openapi_macro_icon.png',
}

function macroIcon(diagramType: string): string {
  return MACRO_ICONS[diagramType] || './image/diagram_macro_icon.png'
}

const label = typeLabel

// Dwell is measured from mount (when the user's click actually opened this
// iframe), so byline_dismissed can tell a mis-click from a real evaluation.
const openedAt = Date.now()
// Set by any action that makes this a productive open; suppresses the
// "looked and left" event on unmount.
let acted = false
let pageId = ''

function baseProps() {
  return {
    feature_area: 'byline' as const,
    surface: 'byline' as const,
    entry_point: 'byline' as const,
    ...summarizeDiagrams(diagrams.value),
  }
}

async function loadDiagrams() {
  try {
    pageId = await globals.apWrapper._getCurrentPageId()
    const responses = await globals.apWrapper.listPageDiagramContents(pageId)
    diagrams.value = parsePageDiagrams(responses)
    failed.value = false
  } catch (e) {
    // An unreadable page is NOT an empty page. The create path still works, so
    // state 4 keeps the picker and says what happened.
    console.error('[byline] failed to list page diagrams', e)
    diagrams.value = []
    failed.value = true
  } finally {
    loading.value = false
    // Emitted after the list resolves so page_has_diagram / diagram_count are
    // populated — this event IS the Phase 1 readout, and a version of it
    // without those two properties would not answer the question it exists for.
    // Thumbnails are deliberately NOT awaited first: the cards must paint
    // immediately, and delaying the readout behind N image fetches would make
    // byline_opened hostage to attachment latency.
    trackAnalyticsEvent('byline_opened', baseProps())
    void loadThumbnails()
  }
}

onMounted(loadDiagrams)

onBeforeUnmount(() => {
  // Object URLs are never created (thumbnails are inlined as data: URLs), so
  // there is nothing to revoke here.
  if (acted) return
  trackAnalyticsEvent('byline_dismissed', {
    ...baseProps(),
    dwell_ms: Date.now() - openedAt,
  })
})

/**
 * Resolve each listed diagram's backup PNG into an inline thumbnail. Runs after
 * the cards have painted and never blocks them; a page whose diagrams predate
 * the attachment backup just keeps the macro-type icon.
 */
async function loadThumbnails() {
  try {
    const ids = diagrams.value.slice(0, MAX_THUMBNAILS).map(d => d.id)
    if (!ids.length) return
    const attachments = await globals.apWrapper.getAttachmentsV2(pageId)
    const refs = indexThumbnails(attachments as any, ids)
    const resolved = await Promise.all(
      refs.map(async r => ({ id: r.customContentId, dataUrl: await fetchThumbnailDataUrl(r.path) })),
    )
    const next: Record<string, string> = {}
    for (const r of resolved) {
      if (r.dataUrl) next[r.id] = r.dataUrl
    }
    thumbs.value = next
    // Coverage rides on its own event rather than being retrofitted onto
    // byline_opened, which has already fired by now.
    trackAnalyticsEvent('byline_thumbnails_loaded', {
      ...baseProps(),
      thumbnail_count: Object.keys(next).length,
    })
  } catch (e) {
    console.debug('[byline] thumbnail load failed', e)
  }
}

function onRetry() {
  failed.value = false
  loading.value = true
  thumbs.value = {}
  void loadDiagrams()
}

/**
 * Open the clicked diagram in the fullscreen viewer.
 *
 * The design's first choice was scrolling the host page to the macro via a URL
 * fragment, with an explicit instruction to confirm the anchor form against a
 * real rendered page first and to fall back to opening the diagram fullscreen
 * if it could not be made reliable. That confirmation needs a browser, so this
 * takes the documented fallback.
 *
 * `macroMode` MUST be `'fullscreen'`, not `'viewer'`: `isFullscreenMode()`
 * (model/globals/forgeGlobal.ts) is what GenericViewer reads to switch to the
 * centred, full-height layout and drop the inline toolbar. With `'viewer'` the
 * diagram renders in its small inline form pinned to the top-left of a
 * fullscreen modal — which is exactly what shipped and got reported.
 */
async function onOpenDiagram(d: PageDiagram) {
  acted = true
  trackAnalyticsEvent('byline_diagram_opened', {
    ...baseProps(),
    macro_type: toMacroType(d.diagramType) as MacroTypeValue,
  })
  try {
    await openModal({
      resource: 'main',
      size: 'fullscreen',
      context: {
        macroMode: 'fullscreen',
        diagramType: toModalDiagramType(d.diagramType),
        customContentId: d.id,
      },
    })
  } catch (e) {
    console.error('[byline] failed to open diagram', e)
  }
}

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
    macro_type: toMacroType(d.diagramType) as MacroTypeValue,
  })
}

/**
 * Create a diagram from the byline, then hand back a link that places it.
 *
 * Opening the editor with no `customContentId` gives a genuinely new diagram;
 * saving it creates the custom content on this page. The editor cannot tell us
 * the new id — there is no macro to write back to and `view.submit` is invalid
 * on a byline-opened modal — so the id is recovered by diffing the page's
 * diagram list across the modal.
 *
 * Only then is there something to link to. That ordering is the point of this
 * flow: the previous version copied a `/new/<type>` link before any diagram
 * existed, so a user who pasted it got an empty macro they still had to fill in.
 */
async function onAddDiagram(macroType?: MacroTypeValue, diagramType?: string) {
  acted = true
  trackAnalyticsEvent('byline_create_clicked', {
    ...baseProps(),
    ...(macroType ? { macro_type: macroType } : {}),
  })

  const before = diagrams.value.map(d => d.id)
  creating.value = true
  try {
    await openModal({
      resource: 'main',
      size: 'fullscreen',
      context: {
        macroMode: 'editor',
        // Undefined for the generic "Add a diagram" button — the editor opens
        // in its own default type, which is the sequence family.
        diagramType: diagramType ? toModalDiagramType(diagramType) : 'sequence',
      },
      onClose: () => {
        void afterEditorClosed(before, macroType)
      },
    })
  } catch (e) {
    creating.value = false
    console.error('[byline] failed to open the editor', e)
    trackAnalyticsEvent('byline_editor_deeplinked', {
      ...baseProps(),
      result: 'failed',
      failure_reason: (e as any)?.message ? String((e as any).message) : String(e),
    })
  }
}

/**
 * Re-read the page after the editor closes. A new id means the user saved;
 * no new id means they cancelled, and the modal simply returns to the list.
 */
async function afterEditorClosed(before: string[], macroType?: MacroTypeValue) {
  try {
    const responses = await globals.apWrapper.listPageDiagramContents(pageId)
    const after = parsePageDiagrams(responses)
    diagrams.value = after
    const newId = newlyCreatedId(before, after.map(d => d.id))
    if (!newId) {
      trackAnalyticsEvent('byline_create_cancelled', { ...baseProps(), ...(macroType ? { macro_type: macroType } : {}) })
      return
    }
    // Same accessor model/Attachment.ts uses — `globals` is the app singleton
    // (apWrapper etc.) and carries no Forge context.
    const cloudId = forgeGlobal.forgeContext?.cloudId
    const link = buildEmbedDeeplink(cloudId, newId)
    trackAnalyticsEvent('byline_diagram_created', {
      ...baseProps(),
      ...(macroType ? { macro_type: macroType } : {}),
      custom_content_id: String(newId),
      result: link ? 'linked' : 'no_cloud_id',
    })
    if (!link) {
      // The diagram is saved and listed either way; without a cloudId we simply
      // cannot offer the paste link, so say nothing rather than a broken one.
      console.error('[byline] no cloudId available for the deeplink')
      return
    }
    createdLink.value = link
    createdCopied.value = await copyText(link)
    void loadThumbnails()
  } catch (e) {
    console.error('[byline] failed to resolve the created diagram', e)
  } finally {
    creating.value = false
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (e) {
    console.error('[byline] clipboard write failed', e)
    return false
  }
}

async function onCopyCreatedLink() {
  if (!createdLink.value) return
  createdCopied.value = await copyText(createdLink.value)
  trackAnalyticsEvent('advocacy_message_copied', { ...baseProps(), ui_component: 'byline_created_link' })
}

function onDismissCreated() {
  createdLink.value = null
  createdCopied.value = false
}

async function onLearnMore() {
  acted = true
  trackAnalyticsEvent('feedback_link_clicked', { ...baseProps(), source: 'byline_learn_more' })
  try {
    const { router } = await import('@forge/bridge')
    router.open('https://zenuml.com/docs/')
  } catch (e) {
    console.error('[byline] learn-more navigation failed', e)
  }
}
</script>

<style scoped>
/* Fixed 618 x 529 modal (viewportSize: medium). The shell is header / body /
   footer with only the body flexing, so the modal itself never scrolls. */
.byline {
  display: flex;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
  background: #ffffff;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #172b4d;
}

/* Header ------------------------------------------------------------------ */
.byline__header {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px;
  border-bottom: 1px solid #ebecf0;
}
.byline__logo {
  width: 18px;
  height: 18px;
  object-fit: contain;
  display: block;
}
.byline__heading {
  font-size: 15px;
  font-weight: 600;
}
.byline__pill {
  font-size: 12px;
  font-weight: 600;
  color: #5e6c84;
  background: #f4f5f7;
  border-radius: 10px;
  padding: 2px 8px;
}

/* Body -------------------------------------------------------------------- */
.byline__body {
  flex: 1 1 auto;
  min-height: 0;
}
.byline__body--grid {
  padding: 16px 20px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 14px;
  height: 100%;
  box-sizing: border-box;
}
/* Past 3 diagrams the rows stop dividing the height and keep card proportions,
   and only the grid area scrolls. */
.byline__body--paged {
  grid-template-rows: none;
  grid-auto-rows: minmax(150px, 1fr);
  overflow-y: auto;
}
.byline__body--stack {
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-sizing: border-box;
}

/* Diagram card ------------------------------------------------------------ */
.card {
  border: 1px solid #dfe1e6;
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  cursor: pointer;
  background: #fff;
  min-height: 0;
}
.card:hover {
  border-color: #0052cc;
  box-shadow: 0 1px 4px rgba(9, 30, 66, 0.16);
}
.card__preview {
  flex: 1 1 auto;
  min-height: 0;
  background: #fafbfc;
  border-bottom: 1px solid #ebecf0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.card__thumb {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 3px;
  box-sizing: border-box;
  display: block;
}
.card__icon {
  width: 30px;
  height: 30px;
  object-fit: contain;
  opacity: 0.45;
}
.card__meta {
  flex: none;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.card__title {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.card__type {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #5e6c84;
}
.card__action {
  background: none;
  border: none;
  padding: 0;
  font-size: 12px;
  font-weight: 500;
  color: #0052cc;
  cursor: pointer;
  font-family: inherit;
}
.card__action:hover {
  text-decoration: underline;
}
.card__nopreview {
  font-size: 12px;
  color: #5e6c84;
}

/* Add tile ---------------------------------------------------------------- */
.addtile {
  border: 1px dashed #c1c7d0;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #5e6c84;
  cursor: pointer;
  min-height: 0;
}
.addtile:hover {
  border-color: #0052cc;
  color: #0052cc;
  background: #f7f8f9;
}
.addtile__plus {
  font-size: 22px;
  font-weight: 300;
  line-height: 1;
}
.addtile__label {
  font-size: 13px;
  font-weight: 500;
}

/* Empty / failed states --------------------------------------------------- */
.hero {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.hero__title {
  font-size: 17px;
  font-weight: 600;
}
.hero__sub {
  font-size: 13px;
  color: #5e6c84;
  text-wrap: pretty;
}
.typegrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 12px;
  flex: 1 1 auto;
  min-height: 0;
}
.tile {
  border: 1px solid #dfe1e6;
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  cursor: pointer;
  background: #fff;
  min-height: 0;
}
.tile:hover {
  border-color: #0052cc;
  box-shadow: 0 1px 4px rgba(9, 30, 66, 0.16);
}
.tile__preview {
  flex: 1 1 auto;
  min-height: 0;
  background: #fafbfc;
  border-bottom: 1px solid #ebecf0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tile__example {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 3px;
  box-sizing: border-box;
  display: block;
}
.tile__bigicon {
  width: 30px;
  height: 30px;
  object-fit: contain;
  opacity: 0.45;
}
.tile__label {
  flex: none;
  padding: 9px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.tile__icon {
  width: 20px;
  height: 20px;
  object-fit: contain;
  flex: none;
}
.tile__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.tile__name {
  font-size: 13px;
  font-weight: 600;
}
.tile__desc {
  font-size: 12px;
  color: #5e6c84;
}

/* Error banner ------------------------------------------------------------ */
.banner {
  flex: none;
  border: 1px solid #dfe1e6;
  border-radius: 6px;
  background: #fafbfc;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.banner__title {
  font-size: 14px;
  font-weight: 600;
}
.banner__sub {
  font-size: 12px;
  color: #5e6c84;
}
.btn-secondary {
  background: #fff;
  color: #172b4d;
  border: 1px solid #dfe1e6;
  border-radius: 3px;
  padding: 5px 12px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  flex: none;
  /* Required: without it the button wraps to two lines inside space-between. */
  white-space: nowrap;
}
.btn-secondary:hover {
  background: #f4f5f7;
}

/* Loading skeleton -------------------------------------------------------- */
.skel {
  border: 1px solid #dfe1e6;
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #fff;
}
.skel__preview {
  flex: 1 1 auto;
  min-height: 0;
  background: linear-gradient(90deg, #f4f5f7 0%, #ebecf0 40%, #f4f5f7 80%);
  background-size: 320px 100%;
  animation: shimmer 1.2s linear infinite;
}
.skel__meta {
  flex: none;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.skel__bar {
  border-radius: 3px;
  background: linear-gradient(90deg, #f4f5f7 0%, #ebecf0 40%, #f4f5f7 80%);
  background-size: 320px 100%;
  animation: shimmer 1.2s linear infinite;
}
.skel__bar--title {
  height: 10px;
}
.skel__bar--sub {
  height: 8px;
}
/* Cards 3-4 sit still so the eye isn't pulled between four competing shimmers. */
.skel--static .skel__preview {
  background: #f7f8f9;
  animation: none;
}
.skel--static .skel__bar {
  background: #f4f5f7;
  animation: none;
}
@keyframes shimmer {
  0% {
    background-position: -320px 0;
  }
  100% {
    background-position: 320px 0;
  }
}

/* Footer ------------------------------------------------------------------ */
.linkbox {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid #dfe1e6;
  border-radius: 6px;
  background: #fafbfc;
  padding: 10px 12px;
}
.linkbox__url {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: #172b4d;
  background: #f4f5f7;
  border-radius: 3px;
  padding: 4px 6px;
}

.byline__footer {
  flex: none;
  border-top: 1px solid #ebecf0;
  padding: 12px 20px;
  background: #fafbfc;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.byline__hint {
  font-size: 12px;
  color: #5e6c84;
}
.byline__hint code {
  background: #f4f5f7;
  border-radius: 3px;
  padding: 1px 5px;
}
.byline__learn {
  font-size: 13px;
  color: #5e6c84;
  text-decoration: none;
  flex: none;
}
.byline__learn:hover {
  text-decoration: underline;
}
.btn-primary {
  background: #0052cc;
  color: #fff;
  border: none;
  border-radius: 3px;
  padding: 7px 14px;
  font-size: 14px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  flex: none;
  white-space: nowrap;
}
.btn-primary:hover {
  background: #0065ff;
}
.btn-primary--muted,
.btn-primary:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
