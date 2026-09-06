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
         actually finishes the job.

         The `finishedInEditor` branch is the terminal state after Done, shown
         only when the close request did not actually dismiss the popup. The
         frames and the link row stay put across it: the user still has to
         paste, so the one thing that must not vanish is what they paste. -->
    <div v-if="createdLink" class="byline__body byline__body--created" data-testid="byline-created">
      <div class="created__head">
        <!-- Deliberately does NOT keep claiming the link is on the clipboard
             once the copy failed. The automatic copy happens once, at save;
             anything the user copies afterwards silently replaces it, which is
             what the Copy button below is for. -->
        <div class="created__title">
          {{ finishedInEditor
            ? 'Ready to paste'
            : (createdCopied ? 'Saved — link copied to clipboard' : 'Saved — copy the link to place it') }}
        </div>
        <div v-if="finishedInEditor" class="created__sub" data-testid="byline-finished">
          Close this popup and paste the link into the page.
        </div>
        <div v-else-if="hostInEditor" class="created__sub" data-testid="byline-created-sub-editing">
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

    <!-- Still reading the page.
         The two states this resolves into are different LAYOUTS, not different
         contents of one layout: an empty page puts the full picker in the body,
         while a page with diagrams puts the list there and demotes the picker to
         a strip. So rendering either one before the answer is known guarantees a
         visible swap, and it picked the wrong one on exactly the pages that have
         diagrams — the panel opened claiming "Add a diagram to this page" and
         then rearranged into "3 diagrams on this page".
         Deliberately NOT the skeleton cards this replaced either: four card
         outlines promised four diagrams to a page that usually has none. One
         quiet line promises nothing and commits to no layout. -->
    <div v-else-if="loading" class="byline__body byline__body--waiting" data-testid="byline-loading">
      <span class="waiting__text">Reading this page…</span>
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
      <div v-for="d in orderedDiagrams" :key="d.id" class="row" data-testid="byline-item">
        <button type="button" class="row__open" @click="onOpenDiagram(d)">
          <span class="row__thumb">
            <img v-if="thumbs[d.id]" class="row__img" :src="thumbs[d.id]" alt="" data-testid="byline-thumb" />
            <img v-else class="row__icon" :src="macroIcon(d.diagramType)" alt="" />
          </span>
          <span class="row__text">
            <span class="row__title" :title="d.title">{{ d.title }}</span>
            <span class="row__type">
              {{ label(d.diagramType) }}<template v-if="isUnplaced(d)"> · not on this page</template>
            </span>
          </span>
          <span class="row__cta">Open</span>
        </button>
        <!-- Saved but never pasted: it exists as this page's custom content and
             already counts against the Lite limit, but no macro renders it. The
             link is the only way to place it, so it is offered outright rather
             than on hover — this row is the one place the diagram is reachable
             at all. -->
        <button
          v-if="isUnplaced(d)"
          type="button"
          class="row__copy row__copy--url"
          :data-testid="copiedId === d.id ? 'byline-copied' : 'byline-copy-url'"
          title="Copy a link that places this diagram on the page"
          @click="onCopyUrl(d)"
        >{{ copiedId === d.id ? '✓ Copied' : 'Copy URL' }}</button>
        <!-- Copy URL takes the slot when it applies: on a diagram that is not on
             the page, placing it beats copying its source, and two buttons plus
             Open do not fit 618px. The source is still reachable by opening the
             diagram. -->
        <button
          v-else-if="d.copyable"
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
    <!-- 5b: real buttons, not ghost chips. The blue "+" replaces the per-type
         icon — all four carried the same generic glyph, so the icon added noise
         where the plus says *create*. The heading is a 13px semibold dark
         "Add a diagram", not a 12px grey caption that read as metadata about
         the list above. -->
    <!-- Lite macro-limit warning. Placed AFTER the whole v-if/v-else-if chain
         for the same reason the add-another strip is (see the comment above):
         a v-if wedged between two branches re-parents everything after it.
         One notice covers the empty, failed and list states rather than three
         copies inside them.

         Suppressed once a diagram has been created or is unresolved: the panel
         is then about placing what was saved, and a limit warning there is
         answering a question the user has already stopped asking.

         It warns; it does not block. Every tile below still opens the editor,
         whose own gate carries the "Continue editing" allowance — see
         checkCreateLimit. -->
    <div
      v-if="createLimitReached && !createdLink && !createUnresolved"
      class="limitnote"
      data-testid="byline-limit-notice"
    >
      <div class="limitnote__title">This space has reached the free diagram limit</div>
      <div class="limitnote__sub">You can still start one — you'll be asked to upgrade when you save.</div>
    </div>

    <div v-if="showAddAnother" class="addrow" data-testid="byline-type-strip">
      <div class="addrow__label">Add a diagram</div>
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
          <span class="chip__plus" aria-hidden="true">+</span>{{ t.name }}
        </button>
      </div>
    </div>

    <!-- Footer. Pinned in every state; only the hint and the right slot vary. -->
    <div class="byline__footer">
      <span class="byline__hint">
        <template v-if="createdLink && hostInEditor">Paste it anywhere on the page — the diagram is already saved.</template>
        <template v-else-if="createdLink">Saved either way — paste it any time.</template>
        <template v-else-if="createUnresolved">Nothing was lost — retry when you're ready.</template>
        <!-- Nothing, deliberately: the body already says it is reading, and a
             hint here would be a second line of text that swaps out a moment
             later for an unrelated one. -->
        <template v-else-if="loading"></template>
        <template v-else-if="failed">Type <code>/zenuml</code> anywhere on the page.</template>
        <!-- Says what the click actually does. The old hint promised the modal
             would scroll the page to the macro; onOpenDiagram takes the
             documented fallback and opens the fullscreen viewer instead. -->
        <template v-else-if="diagrams.length">Opens the diagram full screen — it stays where it is on the page.</template>
        <!-- The empty state carries no hint. Its whole job is the first diagram,
             and a note about the slash command points at a different way to do
             the same thing — competing with the four rows above it at the exact
             moment the user is choosing between them. -->
      </span>
      <!-- Already in the editor: "Open editor" would navigate to where the user
           already is, reloading the editor they are typing in. The only thing
           left for them is the paste, so the panel just gets out of the way. -->
      <!-- Once Done has been pressed there is nothing left to offer: either the
           popup closed, or it did not and pressing the same button again would
           not change that. -->
      <template v-if="createdLink && hostInEditor && !finishedInEditor">
        <button
          type="button"
          class="btn-primary"
          data-testid="byline-created-done"
          @click="onDismissCreated"
        >Done</button>
      </template>
      <!-- Explicitly NOT a bare `v-else-if="createdLink"`: in the editor after
           Done, the branch above stops matching, and a bare condition would
           fall through to this pair — putting "Open editor" back in front of a
           user who is already in the editor and has finished. -->
      <template v-else-if="createdLink && !hostInEditor">
        <button
          type="button"
          class="btn-secondary"
          data-testid="byline-created-done"
          @click="onDismissCreated"
        >Not now</button>
        <!-- Names the whole action, not just the navigation: the paste is the
             step that finishes the job, and the button is what carries it. -->
        <button
          type="button"
          class="btn-primary"
          data-testid="byline-open-editor"
          @click="onOpenEditorToPaste"
        >Open editor &amp; paste</button>
      </template>
      <!-- `!createdLink` is explicit for the same reason the branch above is:
           after Done in the editor neither branch above matches, and this one
           is only saved from claiming the slot by the created diagram being in
           `diagrams`. Say what is meant rather than rely on that. -->
      <a
        v-else-if="!createdLink && !loading && !failed && !diagrams.length"
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
import type { MacroTypeValue, MacroCountSource } from '@/utils/analytics/catalog'
import {
  parsePageDiagrams,
  summarizeDiagrams,
  summarizeListing,
  sortPageDiagrams,
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
import { useCustomerSuccessService } from '@/composables/useCustomerSuccessService'
import { isPageEditorCreateBlocked } from '@/utils/paywall/preEditGate'

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

/** customContentIds the published page's macros render, in document order, or
 *  `undefined` while unknown — either not scanned yet, or the page ADF could not
 *  be read. Unknown must NOT read as "nothing is placed": that would label every
 *  diagram on the page as stray. See `isUnplaced`. */
const placedOrder = ref<string[] | undefined>(undefined)
const placedIds = computed(() => (placedOrder.value ? new Set(placedOrder.value) : undefined))

/** The list as the page reads it — macro order first, then anything unplaced by
 *  creation time. `diagrams` itself stays in API order: it is the snapshot the
 *  create-diff and every analytics count are taken from. */
const orderedDiagrams = computed(() => sortPageDiagrams(diagrams.value, placedOrder.value))

/**
 * Is this diagram absent from the page it is stored on?
 *
 * True only when the scan positively succeeded and did not find it. A diagram
 * gets here by being saved from the byline and never pasted — it exists, it
 * counts against the Lite 100-macro limit, and nothing renders it, so the paste
 * link is the only way to make it visible.
 *
 * The scan reads the PUBLISHED ADF (a Forge iframe cannot see the editor's
 * draft), so a macro pasted into an unpublished draft looks unplaced. That is
 * why this only ever ADDS an affordance — it never hides or disables anything.
 */
function isUnplaced(d: PageDiagram): boolean {
  return !!placedIds.value && !placedIds.value.has(d.id)
}

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
const LOGO_SRC = './image/zenuml-favicon.png'

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
/** Done was pressed in the editor. `view.close()` is documented as a *request*,
 *  so it can resolve without the popup going away — and we cannot detect that.
 *  This state is what the user sees if it does not: a terminal "ready to paste"
 *  panel rather than the diagram index, which is the thing they pressed Done to
 *  get away from. When the close does work, it is never seen. */
const finishedInEditor = ref(false)

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
  // While the count is unknown, name the module rather than guess. This is the
  // one place the old pinned title was right: over "Reading this page…" it
  // contradicts nothing, and it is what "Add a diagram to this page" got wrong
  // by answering a question we had not asked yet.
  if (loading.value) return 'Diagrams on this page'
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
  /** Highlighted border, and ordered first. (The "Most used" text badge this
   *  also used to render was removed by request, 2026-08-15.) */
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
 *  Flowchart leads and is highlighted from measured Lite usage, not intuition: over
 *  the 90 days to 2026-08-07, `macro_create_succeeded` on `product_type: lite`
 *  counted 15,577 flowchart creates (mermaid 13,698 + plantuml 1,879) against
 *  1,885 sequence, 2,852 graph and 1,481 openapi. AsyncAPI sits last because it
 *  has no usage to rank on — Lite only started shipping the macro with ADR-0005
 *  Option A — not because it is judged least useful. Re-rank once it has 90
 *  days of `macro_create_succeeded` like the rest.
 *
 *  No per-variant filter, deliberately: this panel is Lite-only
 *  (`zenuml-byline-diagrams`; full/diagramly strip it, asyncapi strips the whole
 *  contentBylineItem module) and Lite ships every macro a tile creates. A
 *  variant that kept the panel WITHOUT one would not show a dead tile — it would
 *  show the wrong editor, because forgeIndex reads `modal.diagramType` but falls
 *  through to the OpenAPI branch when its product gate fails, so an AsyncAPI
 *  pick would save a swagger document. `tests/unit/forgeWizard.spec.ts` pins the
 *  invariant that keeps that unreachable. */
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
  {
    key: 'asyncapi',
    diagramType: DiagramType.AsyncApi,
    name: typeLabel(DiagramType.AsyncApi),
    desc: 'Event-driven API spec',
    icon: './image/openapi_macro_icon.png',
    example: './image/byline-example-asyncapi.png',
    macroType: 'asyncapi',
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
 * A create is in flight and has produced no terminal event yet.
 *
 * Set when the editor modal is opened and cleared by whichever of
 * byline_diagram_created / byline_create_cancelled / byline_create_unresolved
 * fires for it, so `trackCreateOutcome` emits EXACTLY ONE outcome per attempt.
 * That guard is load-bearing rather than defensive: the try block in
 * afterEditorClosed wraps the success path too, so a throw from the trailing
 * copy/thumbnail work — both of which run AFTER byline_diagram_created has
 * fired — lands in the same catch that reports an unresolved create, and
 * without this it would report a second outcome for a create already counted
 * as saved.
 *
 * Re-armed by onRetryCreate, because a retry is a fresh resolution attempt and
 * must be allowed to report its own outcome (`is_retry` marks it).
 *
 * Nothing reads this at teardown: see the note above the pagehide listener for
 * why the abandoned-create reporter was reverted.
 */
let createOutcomePending = false

/** True once the limit pre-check has resolved and found the space blocked.
 *  `undefined` while the check is still in flight, and when it resolved against
 *  a macro count that could not be read — see create_limit_reached. */
const createLimitReached = ref<boolean | undefined>(undefined)

/** Where the macro count behind `createLimitReached` came from, so a degraded
 *  read is filterable rather than indistinguishable from a real small space. */
let createLimitSource: MacroCountSource | undefined

/** byline_create_limit_warned fires at most once per modal open. */
let limitWarnedTracked = false

/**
 * Emit the one terminal event for the create attempt in flight, or nothing if
 * that attempt has already reported. See `createOutcomePending`.
 */
function trackCreateOutcome(
  name: 'byline_diagram_created' | 'byline_create_cancelled' | 'byline_create_unresolved',
  props: Record<string, unknown>,
) {
  if (!createOutcomePending) return
  createOutcomePending = false
  trackAnalyticsEvent(name, props)
}

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

/**
 * How long the list will wait for the placement scan before painting without it.
 *
 * The scan decides both the row ORDER and which rows offer Copy URL, so landing
 * it before the first paint is what stops the list from visibly re-sorting a
 * moment after it appears. It runs concurrently with the listing, so waiting
 * usually costs nothing — but it is a second network call, and a slow or hung
 * one must never hold the panel on "Reading this page…". Past this bound the
 * list paints in creation order and the scan applies whenever it lands.
 */
const PLACEMENT_WAIT_MS = 2500

/** Resolve `undefined` rather than hang past `ms`, while letting the original
 *  promise keep running — a late answer is still worth applying. */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>(r => setTimeout(() => r(undefined), ms))])
}

async function loadDiagrams() {
  let health: ListingHealth = LISTING_TOTAL_FAILURE
  try {
    pageId = await globals.apWrapper._getCurrentPageId()
    // Started together, not in sequence: two independent reads of the same page,
    // so the wall-clock cost is the slower of them rather than their sum.
    const placement = scanPlacement()
    const responses = await globals.apWrapper.listPageDiagramContents(pageId)
    await withDeadline(placement, PLACEMENT_WAIT_MS)
    health = summarizeListing(responses)
    diagrams.value = parsePageDiagrams(responses)
    // An unreadable page is NOT an empty page. The create path still works, so
    // the failed state keeps the picker and says what happened.
    //
    // This — not the catch — is what a 403 or a rate-limit actually looks like:
    // the listing resolves with error bodies rather than rejecting, so reading
    // `failed` off a thrown exception alone left the banner unreachable and
    // showed a user with restricted content the "nothing here yet" state.
    //
    // The second clause is the PARTIAL failure: some types listed, none of the
    // survivors held anything, and at least one type errored. Whether the page
    // is empty is then unknown — the failed type may hold ALL of its diagrams
    // (e.g. a graphs-only page whose graph listing 403s) — so claiming
    // "Nothing diagrammed here yet" would be the same clean-empty-wrong answer
    // in partial form. With any survivor row the list renders (incomplete
    // beats a false error), and the count keeps page_has_diagram honest.
    failed.value =
      health.listing_failed || (diagrams.value.length === 0 && health.failed_type_count > 0)
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
    reportPlacement()
    void checkCreateLimit()
  }
}

/**
 * Resolve whether a create started from here would meet the Lite paywall.
 *
 * Runs in the same after-the-list-paints slot as the thumbnail and placement
 * scans, and for the same reason: `initialize()` is a set of network reads, and
 * byline_opened is the Phase 1 readout — it must never wait on them. The notice
 * appears when the check lands, which is why `create_limit_reached` is
 * `undefined` rather than `false` on a click that beats it.
 *
 * Uses the SAME predicate as the editor's own gate (`shouldBlockActions` via
 * isPageEditorCreateBlocked), so the two can never disagree about whether this
 * space is over the limit. `shouldBlockActions` already returns false on Full
 * and Diagramly, so no variant check is needed here.
 *
 * Deliberately does NOT block: see the byline_create_limit_warned catalog entry.
 * The editor's gate carries the "Continue editing (N)" allowance, and 6 of the
 * 27 byline creates blocked over 2026-08-21..27 used it. Reading the remaining
 * balance here would also mean calling getOrCreateContinueAttempts, which
 * CREATES the record as a side effect — stamping firstTriggeredAt for a user
 * who never triggered the paywall. So the notice warns without a count.
 */
async function checkCreateLimit() {
  try {
    const customerSuccess = useCustomerSuccessService()
    // persistMarker: false — this is a READ of the paywall decision, not a
    // macro render. The paywall warning banner's targeting marker is
    // single-writer (the macro iframe); writing it from here would both make
    // the banner eligible on pages where no macro rendered, and risk clobbering
    // a good marker with a degraded read. See initialize()'s doc comment.
    await customerSuccess.initialize({ persistMarker: false })

    // A count we could not actually read is NOT a count of zero. Every loader
    // inside initialize() catches its own error, so the catch below never sees
    // a failed macro-count read: it surfaces as macroCountSource 'undefined'
    // (the #302 fail-open) with macrosCreated left at 0, which would otherwise
    // resolve to "not blocked" and stamp create_limit_reached: false on a space
    // we know nothing about. Leave it undefined instead — that is exactly what
    // the property documents, and what the notice's hidden state means here.
    createLimitSource = customerSuccess.macroCountSource.value
    if (createLimitSource === 'undefined') return

    const blocked = isPageEditorCreateBlocked(customerSuccess.shouldBlockActions.value)
    createLimitReached.value = blocked
    if (!blocked) return
    // Once per open, not once per load. loadDiagrams' finally calls this, and
    // onRetry re-runs loadDiagrams — so an unguarded emit counts a retry as a
    // second warning, and only users who hit a load failure can retry, biasing
    // the metric toward the failure population. Same defect the byline_opened
    // guard directly above exists to prevent.
    if (limitWarnedTracked) return
    limitWarnedTracked = true
    trackAnalyticsEvent('byline_create_limit_warned', {
      ...baseProps(),
      create_limit_reached: true,
      macro_count: customerSuccess.macrosCreated.value,
      macro_count_source: createLimitSource,
    })
  } catch (e) {
    // Unreachable for a network failure (see above); kept for a genuine throw
    // from the composable itself. Leaving createLimitReached undefined keeps the
    // notice hidden and the property honest about not knowing.
    console.warn('[byline] could not resolve the create limit', e)
  }
}

onMounted(loadDiagrams)

// Guard shared by the two dismissal paths below, because both can fire for one
// close (pagehide, then unmount if anything does tear the app down).
let dismissTracked = false

function trackDismissed() {
  if (acted || dismissTracked) return
  dismissTracked = true
  trackAnalyticsEvent('byline_dismissed', {
    ...baseProps(),
    dwell_ms: Date.now() - openedAt,
  })
}

/**
 * NOT reported: a create still in flight when this iframe goes away.
 *
 * The editor modal's `onClose` is the only thing that resolves a create, and it
 * does not run if Confluence tears the byline down first (a host navigation, a
 * closed tab, the view↔edit transition this iframe cannot outlive). Those
 * creates emit nothing, and they are the one arm of #572's 22.7% unattributed
 * clicks that this component does NOT close.
 *
 * A `pagehide` reporter for it was written and REVERTED (#572, spot-checked on
 * lite-stg 2026-08-29). It never reached Mixpanel, and the failure was not the
 * usual best-effort-delivery excuse:
 *   - `byline_dismissed`, which rides this very listener, DID deliver in the
 *     same run as a control, so the teardown path itself works;
 *   - re-booting a byline iframe on the same origin afterwards flushed nothing,
 *     so it was not the localStorage batch waiting for a send;
 *   - dispatching `pagehide` directly inside the live byline frame produced
 *     nothing either, and threw no error, so the browser signal was not at
 *     fault. At teardown the frame is still attached, on the same URL, with the
 *     byline DOM intact.
 * That points at `createOutcomePending` being false by then, which was not
 * confirmed. Shipping the reporter anyway would have put an event in the
 * catalog that never fires — worse than a documented gap, because a zero would
 * read as "this never happens".
 *
 * Consequence for the funnel: the identity in the byline_create_unresolved
 * catalog entry holds for every create the modal resolves, and teardown-
 * abandoned creates remain unmeasured. Reopening this needs the flag's state at
 * teardown established first, not another reporter.
 */

/**
 * The dismissal signal that actually fires in production. Closing the Forge
 * modal destroys this iframe without ever unmounting the Vue app, so
 * onBeforeUnmount alone NEVER runs outside unit tests (which call unmount()
 * explicitly) — with only that hook, the "looked and left" arm of the Phase-1
 * readout records zero and every open looks productive.
 *
 * pagehide fires in Chromium when the iframe is removed. Delivery is
 * best-effort but not wishful: mixpanel-browser batches through localStorage
 * on the app's CDN origin, so an event enqueued during teardown that misses
 * its network flush is sent by the next iframe boot from this origin.
 */
window.addEventListener('pagehide', trackDismissed)

onBeforeUnmount(() => {
  // Object URLs are never created (thumbnails are inlined as data: URLs), so
  // there is nothing to revoke here.
  if (copyFlashTimer) clearTimeout(copyFlashTimer)
  window.removeEventListener('pagehide', trackDismissed)
  trackDismissed()
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

/**
 * Read the page's macro order, which gives both the row order and which rows are
 * not on the page at all.
 *
 * Never throws and never rejects: a page whose ADF cannot be read simply keeps
 * `placedOrder` undefined, so the list falls back to creation order and offers
 * Copy URL on nothing.
 */
async function scanPlacement() {
  try {
    const ids = await globals.apWrapper.referencedCustomContentIds()
    if (ids) placedOrder.value = ids
  } catch (e) {
    console.debug('[byline] placement scan failed', e)
  }
}

/** Emitted once the list AND the scan have both resolved, so `unplaced_count`
 *  and `diagram_count` describe the same moment. Absent — not 0 — when the scan
 *  did not land: "none unplaced" and "we could not tell" are different answers. */
function reportPlacement() {
  const ids = placedIds.value
  if (!ids || !diagrams.value.length) return
  trackAnalyticsEvent('byline_unplaced_scanned', {
    ...baseProps(),
    unplaced_count: diagrams.value.filter(d => !ids.has(d.id)).length,
  })
}

function onRetry() {
  failed.value = false
  loading.value = true
  thumbs.value = {}
  placedOrder.value = undefined
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
 * Copy the link that places an already-saved diagram onto the page.
 *
 * Same deeplink the post-create panel hands over — this is that panel's offer,
 * recovered for a diagram whose creation ended without the paste (the modal was
 * dismissed, the tab closed, the clipboard overwritten). Without it, a saved but
 * unplaced diagram is unreachable from the page it belongs to.
 */
async function onCopyUrl(d: PageDiagram) {
  acted = true
  const cloudId = forgeGlobal.forgeContext?.cloudId
  const link = buildDiagramDeeplink(toMacroType(d.diagramType), cloudId || '', d.id)
  if (!link) {
    // No link is possible for this type or context; say nothing rather than put
    // a broken URL on the clipboard.
    console.error('[byline] no deeplink available for the listed diagram', { cloudId: !!cloudId })
    trackAnalyticsEvent('advocacy_message_copied', {
      ...baseProps(),
      ui_component: 'byline_unplaced_link',
      macro_type: toMacroType(d.diagramType) as MacroTypeValue,
      result: cloudId ? 'unlinkable_type' : 'no_cloud_id',
    })
    return
  }
  const copied = await copyText(link)
  if (copied) {
    copiedId.value = d.id
    setTimeout(() => {
      if (copiedId.value === d.id) copiedId.value = null
    }, COPY_FLASH_MS)
  }
  trackAnalyticsEvent('advocacy_message_copied', {
    ...baseProps(),
    ui_component: 'byline_unplaced_link',
    macro_type: toMacroType(d.diagramType) as MacroTypeValue,
    copy_trigger: 'manual',
    result: copied ? 'copied' : 'failed',
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
  trackAnalyticsEvent('byline_create_clicked', {
    ...baseProps(),
    macro_type: macroType,
    // Undefined when the pre-check has not resolved yet — it runs after the
    // list paints and a fast click beats it. That is deliberately not `false`.
    ...(createLimitReached.value === undefined
      ? {}
      : { create_limit_reached: createLimitReached.value }),
    // Carried whenever the check ran at all, so `create_limit_reached: false`
    // from a 'zero' read (an empty space and an under-returning one are
    // indistinguishable by construction — see useCustomerSuccessService) can be
    // separated from one backed by a real 'kv'/'collect' count.
    ...(createLimitSource ? { macro_count_source: createLimitSource } : {}),
  })

  const before = diagrams.value.map(d => d.id)
  // Armed BEFORE the modal opens, not in onClose: the whole point is to report
  // a create whose onClose never runs, which cannot arm anything itself.
  createOutcomePending = true
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
    const failureReason = (e as any)?.message ? String((e as any).message) : String(e)
    trackAnalyticsEvent('byline_editor_deeplinked', {
      ...baseProps(),
      result: 'failed',
      failure_reason: failureReason,
    })
    // byline_editor_deeplinked answers a different question (did the open
    // route?), so this attempt still owes the funnel an outcome — otherwise a
    // click whose editor never opened is exactly the silent gap #572 exists to
    // remove, and the created + cancelled + unresolved identity acquires an
    // exception. Emitted after the deeplink event so the two read in order, and
    // it also disarms the teardown reporter.
    trackCreateOutcome('byline_create_unresolved', {
      ...baseProps(),
      macro_type: macroType,
      result: 'editor_never_opened',
      failure_reason: failureReason,
    })
  }
}

/**
 * Re-read the page after the editor closes. A new id means the user saved;
 * no new id means they cancelled, and the modal simply returns to the list.
 */
async function afterEditorClosed(before: string[], macroType: MacroTypeValue, isRetry = false) {
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
      trackCreateOutcome('byline_create_unresolved', {
        ...baseProps(),
        macro_type: macroType,
        ...health,
        result: 'listing_failed',
        ...(isRetry ? { is_retry: true } : {}),
      })
      return
    }
    const after = parsePageDiagrams(responses)
    const newId = newlyCreatedId(before, after.map(d => d.id))
    // PARTIAL failure with no new id found is the same unknown in miniature:
    // the save may have landed in exactly the type that errored, and calling
    // it cancelled would fire byline_create_cancelled for a saved diagram —
    // the same funnel inversion as the total-failure case above. A found id
    // proves the save regardless of other types failing, so only the
    // no-id-and-something-failed combination stays unresolved.
    if (!newId && health.failed_type_count > 0) {
      pendingCreate = { before, macroType }
      createUnresolved.value = true
      trackCreateOutcome('byline_create_unresolved', {
        ...baseProps(),
        macro_type: macroType,
        ...health,
        result: 'listing_partial',
        ...(isRetry ? { is_retry: true } : {}),
      })
      return
    }
    createUnresolved.value = false
    pendingCreate = null
    diagrams.value = after
    if (!newId) {
      trackCreateOutcome('byline_create_cancelled', {
        ...baseProps(),
        macro_type: macroType,
        ...(isRetry ? { is_retry: true } : {}),
      })
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
    trackCreateOutcome('byline_diagram_created', {
      ...baseProps(),
      macro_type: macroType,
      custom_content_id: String(newId),
      ...(isRetry ? { is_retry: true } : {}),
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
    // Previously silent, and the largest arm of #572's 22.7% unattributed
    // clicks. trackCreateOutcome is a no-op when the attempt already reported,
    // which is what keeps a throw from the trailing copy/thumbnail work — both
    // of which run AFTER byline_diagram_created has fired — from reporting a
    // second outcome for a create already counted as saved.
    trackCreateOutcome('byline_create_unresolved', {
      ...baseProps(),
      macro_type: macroType,
      result: 'resolve_failed',
      failure_reason: (e as any)?.message ? String((e as any).message) : String(e),
      ...(isRetry ? { is_retry: true } : {}),
    })
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
  // A retry is a fresh resolution attempt and must be allowed to report its own
  // outcome — the first attempt's byline_create_unresolved already cleared the
  // flag. `is_retry` is what keeps the two separable in the funnel.
  createOutcomePending = true
  void afterEditorClosed(before, macroType, true)
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
 * Dismiss the post-create panel — "Done" in the editor, "Not now" in view mode.
 *
 * Both mean the same thing: the user is finished with this panel. The diagram is
 * saved either way, so the answer in both cases is to get the popup off the
 * page rather than to swap it for another screen the user did not ask for.
 *
 * `view.close()` is a *request*. It can resolve without the popup going away and
 * nothing distinguishes the two, so what stays behind has to be correct in the
 * case where the close did nothing — and that differs by surface:
 *
 * - In the EDITOR, falling back to the diagram list is the worst option: it puts
 *   a panel over the page the user has to click into to paste, which is exactly
 *   what they pressed Done to leave. So `createdLink` is deliberately NOT
 *   cleared and a terminal "Ready to paste" state takes over.
 * - In VIEW mode there is nothing to paste into and nothing being blocked. The
 *   list is the byline's own home screen, so it is a fine place to be left if
 *   the close is refused — and the state is reset to reach it.
 */
async function onDismissCreated() {
  const closing = requestCloseView()
  if (hostInEditor) {
    finishedInEditor.value = true
  } else {
    createdLink.value = null
    createdTitle.value = ''
    createdType.value = ''
    createdId.value = ''
    createdCopied.value = false
  }
  linkJustCopied.value = false
  if (copyFlashTimer) clearTimeout(copyFlashTimer)
  copyFlashTimer = undefined
  // Whether a byline item can close itself is not something this repo can
  // verify without a real Confluence editor, so record the outcome instead of
  // assuming it. `host_in_editor` rides on baseProps, so the two surfaces stay
  // separable — they may well behave differently.
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
  /* Containment needs an ABSOLUTE cap, not a relative one. Two relative
     units have already failed here on lite-stg:
     - `height:100%` — the Forge mount chain (`body > div.mx-auto > #app`)
       gives no ancestor a height, so 100% resolved to content height
       (observed: 6-diagram page, whole iframe scrolled, footer pushed off).
     - `height:100vh` — Forge Custom UI iframes auto-resize to content
       height, so 100vh tracks content and the cap dissolves the moment the
       iframe grows (observed: 8-diagram page, same symptom).
     max-height at the modal height (viewportSize: medium = 618x529) breaks
     that feedback loop no matter what the iframe does; 100vh below it keeps
     the panel filling the modal when the list is short. Scoped to the
     byline; the shared index.html is untouched. */
  height: 100vh;
  max-height: 529px;
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
/* zenuml.com's favicon — square, so it sits in a square box. The wordmark this
   replaced needed height-only sizing and still read poorly small. */
.byline__logo {
  width: 20px;
  height: 20px;
  object-fit: contain;
  display: block;
  flex: none;
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
/* Occupies the body without committing to either resolved layout. */
.byline__body--waiting {
  padding: 16px 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.waiting__text {
  font-size: 13px;
  color: #7a869a;
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
/* Fixed width, right-aligned: the slot holds "Copy source", "Copy URL" or a
   hidden placeholder, and "Open" sits immediately before it. Sizing the slot to
   its content moved Open on whichever rows had the longer label. */
.row__copy {
  flex: none;
  width: 82px;
  text-align: right;
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
/* Always visible, unlike Copy source. An unplaced diagram is invisible on the
   page it belongs to, so its one route back must not be behind a hover. Placed
   after the base rule deliberately — same specificity, later wins. */
.row__copy--url {
  opacity: 1;
  color: #0052cc;
}
.row__copy:hover {
  color: #0052cc;
  text-decoration: underline;
}

/* Add another ------------------------------------------------------------- */
/* Sits between the scrolling body and the footer, so it never scrolls away.
   The scroll mechanics (header/addrow/footer flex:none, body flex:1 +
   min-height:0 + overflow-y:auto) already contain the list — this stronger
   top divider is the VISIBLE half of that: #dfe1e6 rather than the #ebecf0 of
   the row separators, so the pinned add-another + footer group reads as one
   fixed region below the scroll boundary instead of blending into the last
   scrolled row. Matches the 4a scroll-containment mock. */
.addrow {
  flex: none;
  padding: 14px 20px 16px;
  border-top: 1px solid #dfe1e6;
  background: #fff;
}
/* A heading, not a caption: 13px semibold dark. At 12px grey it read as
   metadata about the list above rather than as labelling the actions below. */
.addrow__label {
  font-size: 13px;
  font-weight: 600;
  color: #172b4d;
  margin-bottom: 10px;
}
/* Equal-width cells (5b): one control group, not four loose chips. Column-flow
   auto-columns rather than a hardcoded repeat(4, …), so a fifth type keeps the
   single equal-width row without touching this rule. */
.chips {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 8px;
}
/* 5b "real button styling": grey fill instead of ghost, a darker border
   (#c1c7d0 over #dfe1e6), and a 1px bottom shadow for a raised edge — the
   three changes that make these read as pressable rather than as tags. */
.chip {
  border: 1px solid #c1c7d0;
  border-radius: 4px;
  padding: 9px 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  background: #f4f5f7;
  box-shadow: 0 1px 0 rgba(9, 30, 66, 0.08);
  font-family: inherit;
  color: #172b4d;
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
/* The create verb, where a generic per-type glyph only added noise. */
.chip__plus {
  flex: none;
  color: #0052cc;
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
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
.limitnote {
  flex: none;
  border: 1px solid #f0d9a8;
  border-radius: 6px;
  background: #fffaef;
  padding: 10px 14px;
  margin-bottom: 8px;
}
.limitnote__title {
  font-size: 13px;
  font-weight: 600;
  color: #7a5b06;
}
.limitnote__sub {
  font-size: 12px;
  color: #5e6c84;
  margin-top: 2px;
}
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
