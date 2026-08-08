<template>
  <div class="byline" data-testid="byline-diagrams">
    <!-- Header. Present in every state so the shell never shifts — but it NAMES
         the state it sits above rather than the module. A fixed "Diagrams on
         this page" sat over "Nothing diagrammed here yet" on the majority of
         pages, which is the one thing a title must never do. -->
    <div class="byline__header">
      <img class="byline__logo" :src="LOGO_SRC" alt="" />
      <span class="byline__heading" data-testid="byline-heading">{{ heading }}</span>
    </div>

    <!-- Post-create. The diagram is saved and already listed; the only thing
         left is placing it on the page, so this takes over the body until the
         user dismisses it.

         The link is on the clipboard by now, so the panel leads with that fact
         and the URL itself is demoted to a quiet row. Showing a raw deeplink as
         the headline made a developer artifact compete with the button that
         actually finishes the job. -->
    <div v-if="createdLink" class="byline__body byline__body--created" data-testid="byline-created">
      <div class="created__head">
        <!-- Deliberately does NOT keep claiming the link is on the clipboard
             once the copy failed. The automatic copy happens once, at save;
             anything the user copies afterwards silently replaces it, which is
             what the Copy button below is for. -->
        <div class="created__title">
          {{ createdCopied ? 'Saved — link copied to clipboard' : 'Saved — copy the link to place it' }}
        </div>
        <div v-if="hostInEditor" class="created__sub" data-testid="byline-created-sub-editing">
          Paste the link where you want it. Confluence turns it into the diagram itself.
        </div>
        <div v-else class="created__sub">
          Paste the link into the page editor. Confluence turns it into the diagram itself.
        </div>
      </div>

      <!-- Shows the paste rather than describing it. "Paste a URL and it becomes
           a diagram" is the one genuinely surprising step in this flow, and a
           sentence asking a user to trust that is weaker than two frames of
           before-and-after. Decorative, so the whole strip is hidden from
           assistive tech — the sentence above already carries the instruction. -->
      <div class="steps" aria-hidden="true">
        <div class="step">
          <div class="step__label">1 · Paste in the editor</div>
          <div class="step__frame">
            <div class="step__line step__line--long"></div>
            <div class="step__chip">
              <span class="step__caret"></span>
              <span class="step__chiptext">{{ linkChip }}</span>
            </div>
            <div class="step__line step__line--short"></div>
          </div>
        </div>
        <div class="steps__arrow">→</div>
        <div class="step">
          <div class="step__label">2 · It renders in place</div>
          <div class="step__frame">
            <div class="step__line step__line--long"></div>
            <!-- The diagram the user just saved, not a generic illustration:
                 the promise is about THEIR diagram. Falls back to the type icon,
                 which is the common case at this instant — the backup PNG is
                 captured on save and may not have landed yet. -->
            <div class="step__render" data-testid="byline-created-preview">
              <img v-if="createdThumb" class="step__img" :src="createdThumb" alt="" />
              <img v-else class="step__icon" :src="macroIcon(createdType)" alt="" />
            </div>
            <div class="step__line step__line--short"></div>
          </div>
        </div>
      </div>

      <div class="linkrow">
        <code class="linkrow__url" data-testid="byline-created-link">{{ createdLink }}</code>
        <!-- The label flashes and reverts rather than latching on '✓ Copied'.
             A permanently-copied button reads as done, so a user whose
             clipboard was overwritten in between had no signal that clicking
             again would help — and no feedback when they did. -->
        <button type="button" class="btn-secondary btn-secondary--tight" data-testid="byline-copy-link" @click="onCopyCreatedLink">
          {{ linkJustCopied ? '✓ Copied' : 'Copy' }}
        </button>
      </div>
      <p v-if="navFailed" class="created__warn" data-testid="byline-nav-failed">
        We couldn't open the page editor from here. Edit the page yourself and
        paste the link — the diagram is already saved.
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
        <button type="button" class="btn-secondary" data-testid="byline-retry-create" @click="onRetryCreate">Try again</button>
      </div>
    </div>

    <!-- The listing failed. Creating still works, so the picker stays and only
         the banner explains what happened. -->
    <div v-else-if="failed" class="byline__body byline__body--stack" data-testid="byline-failed">
      <div class="banner">
        <div class="banner__text">
          <div class="banner__title">Couldn't list this page's diagrams</div>
          <div class="banner__sub">Usually restricted content. Adding one still works.</div>
        </div>
        <button type="button" class="btn-secondary" data-testid="byline-retry" @click="onRetry">Try again</button>
      </div>
      <div class="picker">
        <button
          v-for="t in DIAGRAM_TYPES"
          :key="t.key"
          type="button"
          class="typerow"
          :disabled="creating"
          :data-testid="`byline-type-${t.key}`"
          @click="onAddDiagram(t.macroType, t.diagramType)"
        >
          <span class="typerow__preview"><img class="typerow__example" :src="t.example" alt="" /></span>
          <span class="typerow__text"><span class="typerow__name">{{ t.name }}</span></span>
        </button>
      </div>
    </div>

    <!-- The page has diagrams. One list, one create row, and no second CTA: the
         footer button that used to sit here passed no macro_type, so it both
         lost the signal the picker exists to capture and dropped the user into a
         default sequence editor they had not asked for. -->
    <div v-else-if="diagrams.length" class="byline__body byline__body--list" data-testid="byline-list">
      <!-- The row is a real <button>, and Copy source is its SIBLING rather than
           a button nested inside it (which is invalid HTML, and is what shipped).
           Copy source is a power-user affordance on a minority of types, so it
           stays out of the way until the row is hovered or focused — the open,
           which is what the whole row does, is the labelled action. -->
      <div v-for="d in diagrams" :key="d.id" class="row" data-testid="byline-item">
        <button type="button" class="row__open" @click="onOpenDiagram(d)">
          <span class="row__thumb">
            <img v-if="thumbs[d.id]" class="row__img" :src="thumbs[d.id]" alt="" data-testid="byline-thumb" />
            <img v-else class="row__icon" :src="macroIcon(d.diagramType)" alt="" />
          </span>
          <span class="row__text">
            <span class="row__title" :title="d.title">{{ d.title }}</span>
            <span class="row__type">{{ label(d.diagramType) }}</span>
          </span>
          <span class="row__cta">Open</span>
        </button>
        <button
          v-if="d.copyable"
          type="button"
          class="row__copy"
          :data-testid="copiedId === d.id ? 'byline-copied' : 'byline-copy-source'"
          @click="onCopySource(d)"
        >{{ copiedId === d.id ? '✓ Copied' : 'Copy source' }}</button>
        <!-- Copy source exists for text-DSL types only, so most lists mix rows
             that have it with rows that don't. Without a placeholder holding
             the slot, "Open" lands in a different place on every other row. -->
        <span v-else class="row__copy row__copy--slot" aria-hidden="true">Copy source</span>
      </div>
    </div>

    <!-- Empty page — the state most users see, and the one that has to earn a
         first diagram. Also the state shown WHILE the list loads: the picker is
         valid on every page, so rendering it immediately beats a skeleton that
         promises four diagrams to a page that has none. -->
    <div v-else class="byline__body byline__body--stack" data-testid="byline-empty">
      <div class="byline__lede">Draw it here, then drop it on the page. Takes about a minute.</div>
      <div class="picker">
        <button
          v-for="t in DIAGRAM_TYPES"
          :key="t.key"
          type="button"
          class="typerow"
          :class="{ 'typerow--recommended': t.recommended }"
          :disabled="creating"
          :data-testid="`byline-type-${t.key}`"
          @click="onAddDiagram(t.macroType, t.diagramType)"
        >
          <span class="typerow__preview"><img class="typerow__example" :src="t.example" alt="" /></span>
          <span class="typerow__text">
            <span class="typerow__name">{{ t.name }}</span>
            <span class="typerow__desc">{{ t.desc }}</span>
          </span>
          <span v-if="t.recommended" class="typerow__badge">Most used</span>
        </button>
      </div>
    </div>

    <!-- Add-another chips. Sits AFTER the whole v-if/v-else-if chain above,
         never inside it: a v-else-if must immediately follow its sibling, so a
         plain v-if wedged between two branches re-parents everything after it
         and the trailing v-else starts rendering alongside the created-link
         panel instead of as its alternative.

         Shown only alongside the list — the empty and failed states carry the
         full picker, and a page that already has diagrams is exactly where the
         next one gets added, so the types have to stay reachable here too. -->
    <div v-if="showAddAnother" class="addrow" data-testid="byline-type-strip">
      <div class="addrow__label">Add another</div>
      <div class="chips">
        <button
          v-for="t in DIAGRAM_TYPES"
          :key="t.key"
          type="button"
          class="chip"
          :disabled="creating"
          :data-testid="`byline-type-${t.key}`"
          @click="onAddDiagram(t.macroType, t.diagramType)"
        >
          <img class="chip__icon" :src="t.icon" alt="" />{{ t.name }}
        </button>
      </div>
    </div>

    <!-- Footer. Pinned in every state; only the hint and the right slot vary. -->
    <div class="byline__footer">
      <span class="byline__hint">
        <template v-if="createdLink && hostInEditor">Paste it anywhere on the page — the diagram is already saved.</template>
        <template v-else-if="createdLink">Saved either way — paste it any time.</template>
        <template v-else-if="createUnresolved">Nothing was lost — retry when you're ready.</template>
        <template v-else-if="failed">Type <code>/zenuml</code> anywhere on the page.</template>
        <!-- Says what the click actually does. The old hint promised the modal
             would scroll the page to the macro; onOpenDiagram takes the
             documented fallback and opens the fullscreen viewer instead. -->
        <template v-else-if="diagrams.length">Opens the diagram full screen — it stays where it is on the page.</template>
        <template v-else>Already editing? Type <code>/zenuml</code> on the page.</template>
      </span>
      <!-- Already in the editor: "Open editor" would navigate to where the user
           already is, reloading the editor they are typing in. The only thing
           left for them is the paste, so the panel just gets out of the way. -->
      <template v-if="createdLink && hostInEditor">
        <button
          type="button"
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
        <!-- Names the whole action, not just the navigation: the paste is the
             step that finishes the job, and the button is what carries it. -->
        <button
          type="button"
          class="btn-primary"
          data-testid="byline-open-editor"
          @click="onOpenEditorToPaste"
        >Open editor &amp; paste</button>
      </template>
      <a
        v-else-if="!failed && !diagrams.length"
        class="byline__learn"
        href="#"
        data-testid="byline-learn-more"
        @click.prevent="onLearnMore"
      >Learn more</a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
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

/** Drives nothing in the template any more — the picker renders immediately
 *  rather than behind a skeleton (see the empty-state comment) — but the list
 *  itself must not be treated as final until this clears, or a page with
 *  diagrams would emit its readout as an empty one. */
const loading = ref(true)
const diagrams = ref<PageDiagram[]>([])
const copiedId = ref<string | null>(null)
/** Separates "this page has no diagrams" (empty) from "we could not find out"
 *  (failed). Previously both collapsed into the empty state, which told a user
 *  with restricted content that their diagrams did not exist. */
const failed = ref(false)
/** Set when the post-editor re-read of the page failed, so we cannot say whether
 *  the user saved. Distinct from `failed` (the initial listing) because the
 *  recovery is different: the diagram may already exist and be counted. */
const createUnresolved = ref(false)
/** The arguments of the create that `createUnresolved` refers to, so its retry
 *  can re-run the same diff instead of starting over. */
let pendingCreate: { before: string[]; macroType: MacroTypeValue } | null = null
/** customContentId -> data: URL. Fills in after the rows paint. */
const thumbs = ref<Record<string, string>>({})

/** Pathological pages exist (demo pages, architecture indexes). Each thumbnail
 *  is its own authenticated round trip, so cap the fan-out — rows past the cap
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
/** Title, type and id of that diagram, so the panel can show what was saved
 *  rather than describing it in the abstract. */
const createdTitle = ref('')
const createdType = ref('')
const createdId = ref('')
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

const createdThumb = computed(() => (createdId.value ? thumbs.value[createdId.value] : undefined))

/** The link as it appears in the step-1 illustration: host and route only.
 *  The full URL is a line away in the copy row, and the point of the frame is
 *  that a pasted link becomes a diagram — not which link. */
const linkChip = computed(() => {
  const bare = (createdLink.value || '').replace(/^https?:\/\//, '')
  const route = bare.indexOf('/d/')
  return route === -1 ? bare : `${bare.slice(0, route + 3)}…`
})

/** The header names whatever is actually below it. */
const heading = computed(() => {
  if (createdLink.value) return createdTitle.value || 'Diagram saved'
  if (createUnresolved.value) return 'Diagrams on this page'
  const n = diagrams.value.length
  if (!failed.value && n) return `${n} diagram${n === 1 ? '' : 's'} on this page`
  return 'Add a diagram to this page'
})

const showAddAnother = computed(
  () => !createdLink.value && !createUnresolved.value && !failed.value && diagrams.value.length > 0,
)

interface TypeTile {
  key: string
  name: string
  desc: string
  icon: string
  example: string
  macroType: MacroTypeValue
  /** Storage `diagramType`, used to build the paste-to-create link. Distinct
   *  from `macroType`, which is the analytics vocabulary. */
  diagramType: string
  /** Surfaced as a "Most used" badge, and ordered first. */
  recommended?: boolean
}

/** The picker. `macroType` rides on `byline_create_clicked` so the funnel can be
 *  split by what the user reached for — the picker is the only place we learn
 *  intended type before the editor, which is why there is no longer an untyped
 *  "Add a diagram" button anywhere in this panel.
 *
 *  Names come from `typeLabel`, never from a literal here: the tile and the row
 *  it creates have to agree on what the type is called.
 *
 *  EVERY type carries a sample render. Two of them used to fall back to a 30px
 *  icon at 45% opacity, which reads as "unavailable" rather than "no preview".
 *  The Graph and OpenAPI samples are drawn to DrawIO's own palette and Swagger
 *  UI's method colours respectively; swap in real product screenshots when
 *  convenient, the composition is the point.
 *
 *  Flowchart leads and is badged from measured Lite usage, not intuition: over
 *  the 90 days to 2026-08-07, `macro_create_succeeded` on `product_type: lite`
 *  counted 15,577 flowchart creates (mermaid 13,698 + plantuml 1,879) against
 *  1,885 sequence, 2,852 graph and 1,481 openapi. */
const DIAGRAM_TYPES: TypeTile[] = [
  {
    key: 'flowchart',
    diagramType: DiagramType.Mermaid,
    name: typeLabel(DiagramType.Mermaid),
    desc: 'Mermaid or PlantUML',
    icon: './image/diagram_macro_icon.png',
    example: './image/byline-example-flowchart.png',
    macroType: 'mermaid',
    recommended: true,
  },
  {
    key: 'sequence',
    diagramType: DiagramType.Sequence,
    name: typeLabel(DiagramType.Sequence),
    desc: 'Who calls what, in order',
    icon: './image/diagram_macro_icon.png',
    example: './image/byline-example-sequence.png',
    macroType: 'sequence',
  },
  {
    key: 'graph',
    diagramType: DiagramType.Graph,
    name: typeLabel(DiagramType.Graph),
    desc: 'Free-form, DrawIO',
    icon: './image/graph_macro_icon.png',
    example: './image/byline-example-graph.png',
    macroType: 'graph',
  },
  {
    key: 'openapi',
    diagramType: DiagramType.OpenApi,
    name: typeLabel(DiagramType.OpenApi),
    desc: 'Render a spec inline',
    icon: './image/openapi_macro_icon.png',
    example: './image/byline-example-openapi.png',
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
    // the failed state keeps the picker and says what happened.
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
    // Thumbnails are deliberately NOT awaited first: the rows must paint
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
 * the rows have painted and never blocks them; a page whose diagrams predate
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
 * takes the documented fallback — and the footer hint says so, rather than
 * promising the scroll that was never built.
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
 *
 * Both arguments are REQUIRED. Every entry point into this function is a typed
 * picker choice now, and the untyped variant that used to exist reported no
 * macro_type and silently opened the sequence editor whatever the user wanted.
 */
async function onAddDiagram(macroType: MacroTypeValue, diagramType: string) {
  acted = true
  trackAnalyticsEvent('byline_create_clicked', { ...baseProps(), macro_type: macroType })

  const before = diagrams.value.map(d => d.id)
  creating.value = true
  try {
    await openModal({
      resource: 'main',
      size: 'fullscreen',
      context: {
        macroMode: 'editor',
        diagramType: toModalDiagramType(diagramType),
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
async function afterEditorClosed(before: string[], macroType: MacroTypeValue) {
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
        macro_type: macroType,
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
      trackAnalyticsEvent('byline_create_cancelled', { ...baseProps(), macro_type: macroType })
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
      macro_type: macroType,
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
    createdId.value = newId
    createdTitle.value = created?.title || ''
    createdType.value = created?.diagramType || ''
    createdLink.value = link
    // Kicked off BEFORE the copy, not after it. The step-2 frame renders the
    // diagram from this, and nothing about it depends on the clipboard — but
    // sequencing it behind the await made it hostage to a write that can hang
    // rather than reject when the document is not focused, which left the frame
    // on its icon fallback forever. Independent work, started independently.
    void loadThumbnails()
    // Copy for the user immediately — the next thing they do is paste — but
    // treat it as best-effort. The button below stays live either way.
    await copyCreatedLink('auto')
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
  createdTitle.value = ''
  createdType.value = ''
  createdId.value = ''
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
   footer with only the body flexing, so the modal itself never scrolls.

   Everything here is a single column of rows. The grid this replaced needed a
   row-height cap, `auto-fill` columns and a tile-height cap purely to survive
   being rendered fullscreen; at 618px none of that is load-bearing. */
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Body -------------------------------------------------------------------- */
.byline__body {
  flex: 1 1 auto;
  min-height: 0;
  box-sizing: border-box;
  overflow-y: auto;
}
.byline__body--stack {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.byline__body--list {
  padding: 8px 20px 16px;
  display: flex;
  flex-direction: column;
}
.byline__lede {
  font-size: 13px;
  color: #5e6c84;
  text-wrap: pretty;
  margin-bottom: 6px;
}

/* Type picker ------------------------------------------------------------- */
.picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
/* A real <button>, not a div with @click: these are the only way to create a
   diagram from here, and as divs they had no tab stop, no role and no Enter. */
.typerow {
  border: 1px solid #dfe1e6;
  border-radius: 6px;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  background: #fff;
  width: 100%;
  text-align: left;
  font-family: inherit;
  color: inherit;
}
.typerow:hover:not(:disabled) {
  border-color: #0052cc;
}
.typerow:focus-visible {
  outline: 2px solid #0052cc;
  outline-offset: 1px;
}
.typerow:disabled {
  opacity: 0.5;
  cursor: default;
}
.typerow--recommended {
  border: 2px solid #0052cc;
  /* Absorbs the extra border so the recommended row is the same height as the
     others and the column does not step. */
  padding: 9px 11px;
}
.typerow__preview {
  width: 84px;
  height: 56px;
  flex: none;
  border: 1px solid #ebecf0;
  border-radius: 4px;
  background: #fafbfc;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.typerow__example {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 2px;
  box-sizing: border-box;
  display: block;
}
.typerow__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
  gap: 2px;
}
.typerow__name {
  font-size: 14px;
  font-weight: 600;
}
.typerow__desc {
  font-size: 12px;
  color: #5e6c84;
}
.typerow__badge {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #0052cc;
  background: #deebff;
  border-radius: 3px;
  padding: 3px 8px;
  flex: none;
}

/* Diagram list ------------------------------------------------------------ */
.row {
  display: flex;
  align-items: center;
  border-bottom: 1px solid #ebecf0;
}
.row__open {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: inherit;
}
.row__open:focus-visible {
  outline: 2px solid #0052cc;
  outline-offset: -2px;
}
.row__thumb {
  width: 64px;
  height: 44px;
  flex: none;
  border: 1px solid #ebecf0;
  border-radius: 4px;
  background: #fafbfc;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.row__img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.row__icon {
  width: 22px;
  height: 22px;
  object-fit: contain;
  opacity: 0.45;
}
.row__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
  gap: 2px;
}
.row__title {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row__type {
  font-size: 12px;
  color: #5e6c84;
}
.row__cta {
  font-size: 13px;
  color: #0052cc;
  font-weight: 500;
  flex: none;
}
/* Kept in the layout at all times so revealing it never shifts the row, and
   faded rather than hidden so it stays reachable by keyboard — :focus-within
   brings it up when the user tabs onto it. */
.row__copy {
  flex: none;
  margin-left: 12px;
  background: none;
  border: none;
  padding: 0;
  font-size: 12px;
  font-weight: 500;
  color: #5e6c84;
  cursor: pointer;
  font-family: inherit;
  opacity: 0;
  transition: opacity 0.12s ease-in;
}
.row:hover .row__copy,
.row:focus-within .row__copy {
  opacity: 1;
}
/* Holds the slot open, never appears and never takes focus. */
.row__copy--slot {
  visibility: hidden;
}
.row__copy:hover {
  color: #0052cc;
  text-decoration: underline;
}

/* Add another ------------------------------------------------------------- */
/* Sits between the scrolling body and the footer, so it never scrolls away. */
.addrow {
  flex: none;
  padding: 12px 20px;
  border-top: 1px solid #ebecf0;
  background: #fff;
}
.addrow__label {
  font-size: 12px;
  color: #5e6c84;
  margin-bottom: 8px;
}
.chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.chip {
  border: 1px solid #dfe1e6;
  border-radius: 4px;
  padding: 6px 12px 6px 8px;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  background: #fff;
  font-family: inherit;
  color: inherit;
}
.chip:hover:not(:disabled) {
  border-color: #0052cc;
}
.chip:focus-visible {
  outline: 2px solid #0052cc;
  outline-offset: 1px;
}
.chip:disabled {
  opacity: 0.5;
  cursor: default;
}
.chip__icon {
  width: 16px;
  height: 16px;
  object-fit: contain;
}

/* Post-create panel ------------------------------------------------------- */
.byline__body--created {
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.created__head {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.created__title {
  font-size: 17px;
  font-weight: 600;
}
.created__sub {
  font-size: 13px;
  color: #5e6c84;
  text-wrap: pretty;
}
.created__warn {
  font-size: 12px;
  color: #5e6c84;
  margin: 0;
  text-wrap: pretty;
}
/* Before / after frames ---------------------------------------------------- */
.steps {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
}
.step {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.step__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #7a869a;
}
/* A stand-in for the page editor: two lines of body copy with the thing that
   changes between the frames sitting between them. */
.step__frame {
  border: 1px solid #dfe1e6;
  border-radius: 4px;
  background: #fff;
  padding: 10px 12px;
  height: 96px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 7px;
  justify-content: center;
}
.step__line {
  height: 7px;
  border-radius: 4px;
  background: #ebecf0;
}
.step__line--long {
  width: 88%;
}
.step__line--short {
  width: 64%;
}
.step__chip {
  display: flex;
  align-items: center;
  gap: 5px;
  background: #deebff;
  border-radius: 3px;
  padding: 4px 7px;
  align-self: flex-start;
  max-width: 100%;
}
/* The text caret, so frame 1 reads as "just pasted" rather than "already had
   a link in it". */
.step__caret {
  width: 5px;
  height: 12px;
  background: #0052cc;
  border-radius: 1px;
  flex: none;
}
.step__chiptext {
  font-size: 11px;
  color: #0052cc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.step__render {
  flex: none;
  height: 46px;
  border: 1px solid #ebecf0;
  border-radius: 3px;
  background: #fafbfc;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.step__img {
  height: 100%;
  object-fit: contain;
  display: block;
}
.step__icon {
  width: 22px;
  height: 22px;
  object-fit: contain;
  opacity: 0.45;
}
.steps__arrow {
  flex: none;
  font-size: 20px;
  color: #7a869a;
  /* Aligns with the frames, not with the labels above them. */
  padding-top: 20px;
}

/* The URL is evidence, not the instruction: quiet, one line, with the button
   that makes it useful again if the clipboard has moved on. */
.linkrow {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #dfe1e6;
  border-radius: 4px;
  background: #fafbfc;
  padding: 6px 6px 6px 10px;
  flex: none;
}
.linkrow__url {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  margin-bottom: 8px;
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
.btn-secondary--tight {
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
}
.btn-secondary:hover {
  background: #f4f5f7;
}

/* Footer ------------------------------------------------------------------ */
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
</style>
