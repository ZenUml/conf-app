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
        <!-- Deliberately does NOT keep claiming the link is on the clipboard.
             The automatic copy happens once, at save; anything the user copies
             afterwards silently replaces it, and a panel that still says "it's
             on your clipboard" would be lying by the time they get to the
             editor. State the copy as an event that happened, and keep the
             button available to make it true again. -->
        <div v-if="hostInEditor" class="hero__sub" data-testid="byline-created-sub-editing">
          {{ createdCopied
            ? "We copied the link for you. Paste it into the page where you want the diagram — copy again any time."
            : 'Copy the link, then paste it into the page where you want the diagram.' }}
        </div>
        <div v-else class="hero__sub">
          {{ createdCopied
            ? 'We copied the link for you. Open the editor and paste it where you want the diagram — copy again any time.'
            : 'Copy the link, then open the editor and paste it where you want the diagram.' }}
        </div>
      </div>
      <div class="linkbox">
        <code class="linkbox__url" data-testid="byline-created-link">{{ createdLink }}</code>
        <!-- The label flashes and reverts rather than latching on '✓ Copied'.
             A permanently-copied button reads as done, so a user whose
             clipboard was overwritten in between had no signal that clicking
             again would help — and no feedback when they did. -->
        <button class="btn-secondary" data-testid="byline-copy-link" @click="onCopyCreatedLink">
          {{ linkJustCopied ? '✓ Copied' : 'Copy link' }}
        </button>
      </div>
      <p v-if="navFailed" class="byline__hint" data-testid="byline-nav-failed">
        We couldn't open the page editor from here. Edit the page yourself and
        paste the link — the diagram is already saved.
      </p>
      <p v-else class="byline__hint">
        Pasting the link places this diagram on the page as a normal macro — you
        can edit it there like any other.
      </p>
    </div>

    <!-- The editor closed but the page could not be re-read, so we cannot say
         whether a diagram was saved. Never fall through to the list: that would
         wipe visible diagrams and report a save as a cancellation. -->
    <div v-else-if="createUnresolved" class="byline__body byline__body--stack" data-testid="byline-create-unresolved">
      <div class="banner">
        <div class="banner__text">
          <div class="banner__title">Couldn't check what you saved</div>
          <div class="banner__sub">If you saved a diagram it's on the page — we just can't read the list right now.</div>
        </div>
        <button class="btn-secondary" data-testid="byline-retry-create" @click="onRetryCreate">Try again</button>
      </div>
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
    <div v-else-if="diagrams.length" class="byline__body byline__body--grid" :class="{ 'byline__body--paged': diagrams.length > 4 }" data-testid="byline-list">
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
        <div class="hero__sub">Pick a type and draw it. We'll give you a link to drop anywhere on the page.</div>
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

    <!-- Add-a-diagram tiles. Sits AFTER the whole v-if/v-else-if chain above,
         never inside it: a v-else-if must immediately follow its sibling, so a
         plain v-if wedged between two branches re-parents everything after it
         and the trailing v-else starts rendering alongside the created-link
         panel instead of as its alternative.

         Same tiles as the empty state, laid out in one row — a page that
         already has diagrams is exactly where the next one gets added, so the
         picker has to be as reachable here as it is on a blank page. Shown only
         alongside the list; the empty and failed states carry their own grid. -->
    <div v-if="!createdLink && !createUnresolved && !loading && diagrams.length" class="addtiles" data-testid="byline-type-strip">
      <div class="addtiles__label">Add a diagram</div>
      <div class="typegrid typegrid--row">
        <div
          v-for="t in DIAGRAM_TYPES"
          :key="t.key"
          class="tile"
          :class="{ 'tile--busy': creating }"
          :data-testid="`byline-type-${t.key}`"
          @click="!creating && onAddDiagram(t.macroType, t.diagramType)"
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

    <!-- Footer. Pinned in every state; only the hint and the right slot vary. -->
    <div class="byline__footer">
      <span class="byline__hint">
        <template v-if="createdLink && hostInEditor">Paste it anywhere on the page — the diagram is already saved.</template>
        <template v-else-if="createdLink">Saved either way — you can paste the link any time.</template>
        <template v-else-if="createUnresolved">Nothing was lost — retry when you're ready.</template>
        <template v-else-if="loading">Reading this page…</template>
        <template v-else-if="failed">Type <code>/zenuml</code> anywhere on the page.</template>
        <template v-else-if="diagrams.length">Click a diagram to jump to it on the page.</template>
        <template v-else>Already editing? Type <code>/zenuml</code> anywhere on the page.</template>
      </span>
      <!-- Already in the editor: "Open editor" would navigate to where the user
           already is, reloading the editor they are typing in. The only thing
           left for them is the paste, so the panel just gets out of the way. -->
      <template v-if="createdLink && hostInEditor">
        <button
          class="btn-primary"
          data-testid="byline-created-done"
          @click="onDismissCreated"
        >Done</button>
      </template>
      <template v-else-if="createdLink">
        <a
          class="byline__learn"
          href="#"
          data-testid="byline-created-done"
          @click.prevent="onDismissCreated"
        >Not now</a>
        <button
          class="btn-primary"
          data-testid="byline-open-editor"
          @click="onOpenEditorToPaste"
        >Open editor</button>
      </template>
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
import { getSpaceKey, NO_SPACE_CONTEXT } from '@/utils/ContextParameters/ContextParameters'
import { DiagramType } from '@/model/Diagram/Diagram'
import type { MacroTypeValue } from '@/utils/analytics/catalog'
import {
  parsePageDiagrams,
  summarizeDiagrams,
  summarizeListing,
  typeLabel,
  toMacroType,
  toModalDiagramType,
  type ListingHealth,
  type PageDiagram,
} from '@/utils/byline/pageDiagrams'
import { indexThumbnails, fetchThumbnailDataUrl } from '@/utils/byline/thumbnails'
import { isHostPageInEditor } from '@/utils/byline/hostEditor'
import { buildDiagramDeeplink, newlyCreatedId } from '@/utils/embedDeeplink'
import { BYLINE_MODAL_ORIGIN } from '@/utils/paywall/modalOrigin'

const loading = ref(true)
const diagrams = ref<PageDiagram[]>([])
const copiedId = ref<string | null>(null)
/** Separates "this page has no diagrams" (state 2) from "we could not find out"
 *  (state 4). Previously both collapsed into the empty state, which told a user
 *  with restricted content that their diagrams did not exist. */
const failed = ref(false)
/** Set when the post-editor re-read of the page failed, so we cannot say whether
 *  the user saved. Distinct from `failed` (the initial listing) because the
 *  recovery is different: the diagram may already exist and be counted. */
const createUnresolved = ref(false)
/** The arguments of the create that `createUnresolved` refers to, so its retry
 *  can re-run the same diff instead of starting over. */
let pendingCreate: { before: string[]; macroType?: MacroTypeValue } | null = null
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
/** Did the automatic copy at save time succeed. Drives the wording once, and
 *  never latches the button — see `linkJustCopied`. */
const createdCopied = ref(false)
/** Transient "✓ Copied" acknowledgement on the copy button, set by both the
 *  automatic and the manual copy and cleared after COPY_FLASH_MS so the button
 *  returns to an obviously-clickable state. */
const linkJustCopied = ref(false)
const COPY_FLASH_MS = 2000
let copyFlashTimer: ReturnType<typeof setTimeout> | undefined
const creating = ref(false)
/** The "Open editor" handoff could not navigate. The diagram is saved and the
 *  link is on the clipboard, so the panel stays and only says so. */
const navFailed = ref(false)

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

/**
 * Whether the host page is already in the editor. Read once at mount: the
 * byline iframe is booted by Confluence per host render, so it cannot outlive a
 * view↔edit transition, and re-reading it per event would only add noise.
 *
 * Carried on every byline event, not just the ones that branch on it. Neither
 * signal it derives from is verifiable from this container, and the detection
 * quietly degrading to `false` looks exactly like "nobody opens the byline
 * while editing" — a claim that must be readable from data rather than assumed.
 */
const hostInEditor = isHostPageInEditor(forgeGlobal.forgeContext)

function baseProps() {
  return {
    feature_area: 'byline' as const,
    surface: 'byline' as const,
    entry_point: 'byline' as const,
    host_in_editor: hostInEditor,
    ...summarizeDiagrams(diagrams.value),
  }
}

const LISTING_TOTAL_FAILURE: ListingHealth = { failed_type_count: 0, listing_failed: true }

/** byline_opened must fire exactly once per modal open — see the catalog entry.
 *  onRetry re-runs this loader, so the emit below is guarded and a retry gets
 *  its own event instead. */
let openedTracked = false

async function loadDiagrams() {
  let health: ListingHealth = LISTING_TOTAL_FAILURE
  try {
    pageId = await globals.apWrapper._getCurrentPageId()
    const responses = await globals.apWrapper.listPageDiagramContents(pageId)
    health = summarizeListing(responses)
    diagrams.value = parsePageDiagrams(responses)
    // An unreadable page is NOT an empty page. The create path still works, so
    // state 4 keeps the picker and says what happened.
    //
    // This — not the catch — is what a 403 or a rate-limit actually looks like:
    // the listing resolves with error bodies rather than rejecting, so reading
    // `failed` off a thrown exception alone left the banner unreachable and
    // showed a user with restricted content the "nothing here yet" state.
    failed.value = health.listing_failed
  } catch (e) {
    console.error('[byline] failed to list page diagrams', e)
    diagrams.value = []
    failed.value = true
    health = LISTING_TOTAL_FAILURE
  } finally {
    loading.value = false
    // Emitted after the list resolves so page_has_diagram / diagram_count are
    // populated — this event IS the Phase 1 readout, and a version of it
    // without those two properties would not answer the question it exists for.
    // Thumbnails are deliberately NOT awaited first: the cards must paint
    // immediately, and delaying the readout behind N image fetches would make
    // byline_opened hostage to attachment latency.
    if (openedTracked) {
      trackAnalyticsEvent('byline_list_retried', {
        ...baseProps(),
        ...health,
        result: health.listing_failed ? 'failed' : 'recovered',
      })
    } else {
      openedTracked = true
      trackAnalyticsEvent('byline_opened', { ...baseProps(), ...health })
    }
    void loadThumbnails()
  }
}

onMounted(loadDiagrams)

onBeforeUnmount(() => {
  // Object URLs are never created (thumbnails are inlined as data: URLs), so
  // there is nothing to revoke here.
  if (copyFlashTimer) clearTimeout(copyFlashTimer)
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
  // Its own event, not byline_diagram_opened: copying the DSL is not opening
  // the diagram, and counting both as index engagement would make that number
  // read higher than the behaviour it is meant to describe.
  trackAnalyticsEvent('byline_diagram_source_copied', {
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
        // The paywall gate already fires on this path — the editor mounts with
        // no customContentId, so tryPageEditorPaywall takes its create branch
        // exactly as an insert-menu create does. This marker does not change
        // WHETHER it fires, only that the resulting events say `byline_create`
        // instead of `page_editor_create`, so a byline create dying at the limit
        // is countable against byline_create_clicked.
        origin: BYLINE_MODAL_ORIGIN,
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
    const health = summarizeListing(responses)
    if (health.listing_failed) {
      // An unreadable re-read cannot tell us whether the user saved, and the
      // listing resolves rather than rejects, so this used to land on the
      // success path: the list was overwritten with an empty one (wiping
      // diagrams the user could see a moment ago), the diff found no new id, and
      // byline_create_cancelled fired for a diagram that WAS saved — and is
      // already counted against the Lite 100-macro limit — with no paste link.
      // That inverts the very funnel byline_create_cancelled exists to measure.
      // Hold the list, say so, and offer a retry.
      pendingCreate = { before, macroType }
      createUnresolved.value = true
      trackAnalyticsEvent('byline_diagram_created', {
        ...baseProps(),
        ...(macroType ? { macro_type: macroType } : {}),
        ...health,
        result: 'listing_failed',
      })
      return
    }
    createUnresolved.value = false
    pendingCreate = null
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
    // Typed link only. There is deliberately no fall back to the 3-segment
    // buildEmbedDeeplink form: it pastes as a READ-ONLY embed rather than the
    // editable macro the byline promises, and its (host, cloudId, contentId)
    // signature meant the two-argument call built
    // `https://<cloudId>/d/<newId>/undefined` — a URL no autoConvert matcher
    // claims, and always truthy, so the unlinkable branch below could never be
    // reached and `result` was always 'linked'. (`tsc --noEmit` does not
    // type-check .vue files, which is why the arity mismatch stayed green.)
    const created = after.find(d => d.id === newId)
    const link = buildDiagramDeeplink(toMacroType(created?.diagramType || ''), cloudId || '', newId)
    trackAnalyticsEvent('byline_diagram_created', {
      ...baseProps(),
      ...(macroType ? { macro_type: macroType } : {}),
      custom_content_id: String(newId),
      // buildDiagramDeeplink returns undefined for a missing cloudId or a type
      // outside DEEPLINK_TYPES; every picker tile is in that set, so the second
      // case means the saved diagram's stored type was not what we asked for.
      result: link ? 'linked' : (cloudId ? 'unlinkable_type' : 'no_cloud_id'),
    })
    if (!link) {
      // The diagram is saved and listed either way; we simply cannot offer the
      // paste link, so say nothing rather than hand over a broken one.
      console.error('[byline] no deeplink available for the created diagram', { cloudId: !!cloudId })
      return
    }
    createdLink.value = link
    // Copy for the user immediately — the next thing they do is paste — but
    // treat it as best-effort. The button below stays live either way.
    await copyCreatedLink('auto')
    void loadThumbnails()
  } catch (e) {
    console.error('[byline] failed to resolve the created diagram', e)
    pendingCreate = { before, macroType }
    createUnresolved.value = true
  } finally {
    creating.value = false
  }
}

/** Re-run the post-editor diff against the SAME `before` snapshot, so a diagram
 *  saved before the failed re-read is still recognised as new. */
function onRetryCreate() {
  if (!pendingCreate) return
  const { before, macroType } = pendingCreate
  createUnresolved.value = false
  creating.value = true
  void afterEditorClosed(before, macroType)
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

function flashCopied() {
  linkJustCopied.value = true
  if (copyFlashTimer) clearTimeout(copyFlashTimer)
  copyFlashTimer = setTimeout(() => {
    linkJustCopied.value = false
    copyFlashTimer = undefined
  }, COPY_FLASH_MS)
}

/**
 * Copy the paste link, from either trigger.
 *
 * `copy_trigger` splits the automatic copy at save from a deliberate re-copy.
 * They answer different questions: 'auto' failing is a clipboard-permission
 * problem in the Forge iframe (the write is not user-gesture-initiated on that
 * path, which is exactly why the manual button has to exist), while a run of
 * 'manual' events on one created link means the automatic copy is not
 * surviving to the paste and the handoff needs rethinking.
 */
async function copyCreatedLink(trigger: 'auto' | 'manual'): Promise<boolean> {
  if (!createdLink.value) return false
  const copied = await copyText(createdLink.value)
  createdCopied.value = copied
  if (copied) flashCopied()
  trackAnalyticsEvent('advocacy_message_copied', {
    ...baseProps(),
    ui_component: 'byline_created_link',
    copy_trigger: trigger,
    result: copied ? 'copied' : 'failed',
  })
  return copied
}

function onCopyCreatedLink() {
  void copyCreatedLink('manual')
}

/**
 * Hand off to the page editor with the link already on the clipboard, so the
 * paste is the user's next keystroke.
 *
 * Deliberately a click rather than an automatic redirect after the copy: this
 * navigation reloads the host page and cannot be undone, and if the clipboard
 * write failed (`createdCopied` false) an automatic jump would strand the user
 * in an editor with nothing to paste. The diagram is already saved either way.
 */
async function onOpenEditorToPaste() {
  try {
    // Compared against the sentinel, NOT `|| ''`: getSpaceKey returns the string
    // 'no_space_context' rather than an empty value, so the old fallback never
    // fired and the sentinel went straight into the URL — navigating to
    // /wiki/spaces/no_space_context/pages/edit-v2/<pageId>, which 404s, while
    // byline_editor_deeplinked still reported result: 'after_create'. The
    // diagram is saved and the link is on the clipboard, so the recoverable
    // outcome is to say the editor could not be opened, not to jump nowhere.
    const spaceKey = getSpaceKey()
    if (!spaceKey || spaceKey === NO_SPACE_CONTEXT) {
      console.error('[byline] no space key in context; cannot open the page editor')
      navFailed.value = true
      trackAnalyticsEvent('byline_editor_deeplinked', {
        ...baseProps(),
        result: 'failed',
        failure_reason: 'no_space_context',
      })
      return
    }
    const { router } = await import('@forge/bridge')
    await router.navigate(`/wiki/spaces/${spaceKey}/pages/edit-v2/${pageId}`)
    trackAnalyticsEvent('byline_editor_deeplinked', { ...baseProps(), result: 'after_create' })
  } catch (e) {
    console.error('[byline] editor navigation failed', e)
    navFailed.value = true
    trackAnalyticsEvent('byline_editor_deeplinked', {
      ...baseProps(),
      result: 'failed',
      failure_reason: (e as any)?.message ? String((e as any).message) : String(e),
    })
  }
}

/**
 * Ask Confluence to close the byline view.
 *
 * Forge documents `view.close()` as "request the closure of the current view.
 * For example, close a modal" — with no stated module restrictions, but also no
 * statement that it works for confluence:contentBylineItem specifically. So it
 * is attempted, never depended on: the caller always applies the in-app
 * dismissal too, which is what the user gets if the request is a no-op.
 */
async function requestCloseView(): Promise<'closed' | 'unsupported' | 'failed'> {
  try {
    const { view } = await import('@forge/bridge')
    if (typeof (view as any)?.close !== 'function') return 'unsupported'
    await (view as any).close()
    return 'closed'
  } catch (e) {
    console.error('[byline] could not close the byline view', e)
    return 'failed'
  }
}

/**
 * Dismiss the post-create panel.
 *
 * In the editor this is the end of the whole flow: the diagram is saved, the
 * link is on the clipboard, and the user's next keystroke is the paste. Merely
 * clearing `createdLink` falls through to the diagram list, which puts a panel
 * over the page they need to click into — so ask Confluence to close the view
 * as well. The state reset still runs either way, so a close request that does
 * nothing leaves the previous behaviour rather than a stuck panel.
 */
async function onDismissCreated() {
  const closing = hostInEditor ? requestCloseView() : null
  createdLink.value = null
  createdCopied.value = false
  linkJustCopied.value = false
  if (copyFlashTimer) clearTimeout(copyFlashTimer)
  copyFlashTimer = undefined
  if (!closing) return
  // Whether a byline item can close itself is not something this repo can
  // verify without a real Confluence editor, so record the outcome instead of
  // assuming it.
  trackAnalyticsEvent('byline_view_close_requested', {
    ...baseProps(),
    result: await closing,
  })
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
  /* Columns adapt to the viewport instead of being pinned at two: the modal is
     fullscreen, where 1fr 1fr would give two absurdly wide cards on a desktop
     and the same two on a laptop. */
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  /* Rows size to content, capped, rather than dividing the modal in two. A
     fixed `1fr 1fr` reserved a second row even for a single diagram — visible
     as an empty band — and at a larger viewport it either stretched two cards
     over the whole modal or left half of it blank. */
  grid-auto-rows: minmax(150px, 300px);
  align-content: start;
  gap: 14px;
  height: 100%;
  box-sizing: border-box;
  overflow-y: auto;
}
.byline__body--paged {
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
/* Same sizing contract as .byline__body--grid, and for the same reason: the
   modal is `viewportSize: fullscreen`, so anything told to fill the container
   fills a whole desktop screen. The original `1fr 1fr` rows with `flex: 1 1
   auto` divided the viewport between four tiles, which on a laptop rendered a
   ~1000×800px preview per type. Cap the row height and stop stretching; the
   tiles are a picker, not the content. */
.typegrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  grid-auto-rows: 190px;
  gap: 12px;
  align-content: start;
  flex: none;
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

/* Sits between the scrolling body and the footer, so it never scrolls away. */
.addtiles {
  flex: none;
  padding: 12px 20px;
  border-top: 1px solid #ebecf0;
  background: #fff;
}
.addtiles__label {
  font-size: 12px;
  color: #5e6c84;
  margin-bottom: 8px;
}
/* One row of four, with a short preview: enough to recognise the type at a
   glance without taking the height the list needs. */
.typegrid--row {
  grid-template-columns: repeat(4, 1fr);
  /* Height comes from the 64px preview + label, not the base 190px cap. */
  grid-auto-rows: auto;
  gap: 10px;
  flex: none;
}
.typegrid--row .tile__preview {
  flex: none;
  height: 64px;
}
.typegrid--row .tile__label {
  padding: 7px 10px;
}
.tile--busy {
  opacity: 0.5;
  cursor: default;
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
