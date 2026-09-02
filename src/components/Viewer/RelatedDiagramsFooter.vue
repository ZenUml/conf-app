<template>
  <!-- The index is rebuilt weekly, so its date can matter to someone who just added a
       diagram. It stays in the tooltip: on the line itself it is a date with no referent. -->
  <footer
    v-if="withRelated.length"
    class="related-diagrams"
    data-testid="related-diagrams-footer"
    :title="asOf ? `Updated ${asOf}` : undefined"
  >
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <circle cx="4" cy="8" r="2" />
      <circle cx="12" cy="4" r="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M5.8 7L10.2 4.8M5.8 9L10.2 11.2" />
    </svg>
    <span><span class="related-diagrams-strong">{{ withRelated.length }} of {{ participants.length }} participants</span>{{ ' also appear in other diagrams' }}</span>
  </footer>

  <!-- The overlay is teleported into the rendered diagram's positioned host.
       It never participates in Mermaid's render or layout. -->
  <Teleport v-if="hostEl && withRelated.length" :to="hostEl">
    <div class="related-diagrams-overlay">
      <button
        v-for="item in pills"
        :key="item.actorId"
        type="button"
        class="related-diagrams-pill"
        :class="{ 'related-diagrams-pill--concealed': !diagramHovered }"
        data-testid="related-diagrams-pill"
        :data-actor="item.actorId"
        :style="{ left: `${item.left}px`, top: `${item.top}px` }"
        :title="`Also appears in ${item.count} ${item.count === 1 ? 'place' : 'places'} — click to see`"
        :aria-expanded="open === item.participant"
        @mousedown.stop
        @click.stop="toggle(item.participant)"
      >
        {{ item.count }}
      </button>

      <div
        v-if="openPill"
        class="related-diagrams-highlight"
        data-testid="related-diagrams-highlight"
        :style="highlightStyle"
      />

      <Teleport v-if="open && openPill" to="body">
        <div
          ref="popoverEl"
          class="related-diagrams-popover"
          data-testid="related-diagrams-popover"
          role="dialog"
          aria-label="Also appears in"
          :style="popoverStyle"
          @mousedown.stop
        >
        <div
          class="related-diagrams-popover-arrow"
          :class="{ 'related-diagrams-popover-arrow--under': flipped }"
          :style="arrowStyle"
        />
        <div class="related-diagrams-popover-heading">Also appears in</div>
        <ul>
          <li v-for="row in openLocations" :key="row.key">
            <!-- A row on the current page opens nothing, so it is not a link. Its own
                 text states the relation; the page title would repeat what is on screen. -->
            <span
              v-if="!row.page"
              class="related-diagrams-here"
              data-testid="related-diagrams-here"
            >{{ row.label }}</span>
            <a
              v-else
              href="#"
              data-testid="related-diagram-link"
              @click.prevent="follow(open, row.page)"
            >
              <span class="related-diagrams-link-title">{{ row.label }}</span>
            </a>
          </li>
        </ul>
        </div>
      </Teleport>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import forgeGlobal, { openUrl } from '@/model/globals/forgeGlobal'
import {
  getRelatedDiagrams,
  RelatedLookupError,
  type RelatedPage,
  type RelatedParticipant,
  type RelatedResponse,
} from '@/services/ArchitectureTokens'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

const props = defineProps<{
  customContentId: string
  ready: boolean
  enabled: boolean
  surface: 'viewer' | 'fullscreen'
  svgHost: () => HTMLElement | null
  pageId?: string
}>()

/**
 * One row of the popover: a page to open, the current page's own row, or the closing line
 * that names how many further places the list does not show.
 */
interface Location {
  key: string
  label: string
  page: RelatedPage | null
}

interface Pill {
  actorId: string
  participant: RelatedParticipant
  count: number
  left: number
  top: number
  actorLeft: number
  actorTop: number
  actorWidth: number
  actorHeight: number
}

// Two renderers mark a lifeline differently: Mermaid puts the declaration name in `name`
// on `rect.actor.actor-top` (a `participant`) or `g.actor-man.actor-top` (an `actor`);
// ZenUML puts it in `data-participant-id` on `div.participant`. Both are read here, so a
// participant is discoverable and anchorable whichever renderer drew the diagram.
const ACTOR_ID_ATTRIBUTES = ['name', 'data-participant-id']
const ACTOR_BOX_SELECTORS = ['.actor-top[name=', '.participant[data-participant-id=']

// The circle sits on the participant box's bottom-right corner, so it never crosses the
// top of the diagram; the shell opens 8px under the circle.
const PILL = 16
const PILL_INSET = 10
const GUTTER = 8
const BELOW = GUTTER + PILL / 2
const POPOVER_WIDTH = 320

const participants = ref<RelatedParticipant[]>([])
const indexedAt = ref<string | null>(null)
const open = ref<RelatedParticipant | null>(null)
const hostEl = ref<HTMLElement | null>(null)
const pills = ref<Pill[]>([])
const diagramHovered = ref(false)
const popoverEl = ref<HTMLElement | null>(null)
const popoverStyle = ref<Record<string, string>>({})
const arrowStyle = ref<Record<string, string>>({})
const flipped = ref(false)
let requested = false

const withRelated = computed(() => participants.value.filter((participant) => participant.related.length))

/** Pages are the rows; a page carrying two related diagrams is still one row. */
function locationsOf(participant: RelatedParticipant): Location[] {
  const here: RelatedPage[] = []
  const away: RelatedPage[] = []
  for (const page of participant.related) {
    if (props.pageId && page.pageId === props.pageId) here.push(page)
    else away.push(page)
  }

  const rows: Location[] = []
  if (here.length) {
    rows.push({
      key: 'here',
      label: here.length > 1 ? 'Other diagrams on this page' : 'Another diagram on this page',
      page: null,
    })
  }
  const seen = new Set<string>()
  for (const page of away) {
    if (seen.has(page.pageId)) continue
    seen.add(page.pageId)
    rows.push({ key: page.pageId, label: page.pageTitle, page })
  }

  // `user` sits on 139 pages at the pilot tenant. The list shows the nearest few; without
  // this line it would read as "these are the places", and the reader would never learn
  // that the name is too general to mean one thing.
  const remainder = participant.relatedTotal - rows.length
  if (remainder > 0) {
    rows.push({
      key: 'more',
      label: `${remainder} more ${remainder === 1 ? 'place' : 'places'}`,
      page: null,
    })
  }
  return rows
}

const locations = computed(
  () => new Map(withRelated.value.map((participant) => [participant, locationsOf(participant)])),
)
const openLocations = computed(() => (open.value ? (locations.value.get(open.value) ?? []) : []))
const openPill = computed(() =>
  pills.value.find((item) => item.participant === open.value) ?? null,
)
const asOf = computed(() =>
  indexedAt.value
    ? new Date(indexedAt.value).toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'short',
      })
    : '',
)
const highlightStyle = computed(() => {
  const item = openPill.value
  if (!item) return {}
  return {
    left: `${item.actorLeft}px`,
    top: `${item.actorTop}px`,
    width: `${item.actorWidth}px`,
    height: `${item.actorHeight}px`,
    outline: '2.5px solid #0052CC',
  }
})

const baseProperties = () => ({
  feature_area: 'architecture_tokens' as const,
  surface: props.surface,
  macro_type: 'mermaid' as const,
})
const countProperties = () => ({
  participant_count: participants.value.length,
  participants_with_related: withRelated.value.length,
  related_pages_total: [...locations.value.values()].reduce((total, rows) => total + rows.length, 0),
  index_age_days: indexedAt.value
    ? Math.floor((Date.now() - new Date(indexedAt.value).getTime()) / 86_400_000)
    : undefined,
})

// `.actor-top` covers both shapes Mermaid draws: `rect.actor.actor-top` for a
// `participant`, and `g.actor-man.actor-top` for an `actor`. Matching only the rect
// dropped every actor-shaped participant — the footer counted it, the diagram could
// not show its circle (lite-stg page 237043717, participant `Dev`).
function actorBox(actorId: string): Element | null {
  const escaped = (globalThis as any).CSS?.escape
    ? (globalThis as any).CSS.escape(actorId)
    : actorId.replace(/["\\]/g, '\\$&')
  const selector = ACTOR_BOX_SELECTORS.map((prefix) => `${prefix}"${escaped}"]`).join(', ')
  return hostEl.value?.querySelector(selector) ?? null
}

/** Every lifeline the rendered diagram actually shows, whichever renderer drew it. */
function renderedActorIds(): Set<string> {
  const ids = new Set<string>()
  for (const attribute of ACTOR_ID_ATTRIBUTES) {
    for (const element of hostEl.value?.querySelectorAll(`[${attribute}]`) ?? []) {
      const value = element.getAttribute(attribute)
      if (value) ids.add(value)
    }
  }
  return ids
}

function layoutPills() {
  const host = hostEl.value
  if (!host) return
  const hostBox = host.getBoundingClientRect()
  pills.value = withRelated.value.flatMap((participant) => {
    const element = actorBox(participant.actorId)
    if (!element) return []
    const rect = element.getBoundingClientRect()
    return [
      {
        actorId: participant.actorId,
        participant,
        // the true reach of the name, not the number of rows the popover lists
        count: participant.relatedTotal,
        left: rect.right - hostBox.left - PILL_INSET,
        top: rect.bottom - hostBox.top - PILL / 2,
        actorLeft: rect.left - hostBox.left,
        actorTop: rect.top - hostBox.top,
        actorWidth: rect.width,
        actorHeight: rect.height,
      },
    ]
  })
}

function positionPopover() {
  const item = openPill.value
  const anchor = item ? actorBox(item.actorId)?.getBoundingClientRect() : null
  if (!anchor) return

  const width = popoverEl.value?.getBoundingClientRect().width || POPOVER_WIDTH
  const height = popoverEl.value?.getBoundingClientRect().height || 280
  const left = Math.min(Math.max(anchor.left, GUTTER), window.innerWidth - width - GUTTER)
  const below = anchor.bottom + BELOW
  const above = anchor.top - height - GUTTER
  const fitsBelow = below + height <= window.innerHeight - GUTTER
  flipped.value = !fitsBelow && above >= GUTTER
  const top = fitsBelow ? below : flipped.value ? above : GUTTER

  // The arrow keeps the circle's column, whatever the shell had to do to stay in view.
  const circleCentre = anchor.right - PILL_INSET + PILL / 2
  const arrowLeft = Math.min(Math.max(circleCentre - left - 5, GUTTER), width - 18)

  popoverStyle.value = { left: `${left}px`, top: `${top}px` }
  arrowStyle.value = { left: `${arrowLeft}px` }
}

function onWindowResize() {
  layoutPills()
  positionPopover()
}

async function load() {
  if (requested || !props.enabled || !props.ready) return
  requested = true
  const started = performance.now()
  let response: RelatedResponse
  try {
    response = await getRelatedDiagrams(props.customContentId, { pageId: props.pageId })
  } catch (error) {
    trackAnalyticsEvent('related_diagrams_lookup_failed', {
      ...baseProperties(),
      error_kind: error instanceof RelatedLookupError ? error.kind : 'network',
      duration_ms: Math.round(performance.now() - started),
    })
    return
  }

  if (response.error_kind) {
    trackAnalyticsEvent('related_diagrams_lookup_failed', {
      ...baseProperties(),
      error_kind: response.error_kind,
      duration_ms: Math.round(performance.now() - started),
    })
    return
  }

  hostEl.value = props.svgHost()
  const presentActorIds = renderedActorIds()
  participants.value = response.participants.filter((participant) =>
    presentActorIds.has(participant.actorId),
  )
  indexedAt.value = response.indexedAt

  trackAnalyticsEvent('related_diagrams_lookup_succeeded', {
    ...baseProperties(),
    ...countProperties(),
    lookup_outcome: response.lookup_outcome
      ?? (response.indexedAt === null ? 'index_miss' : 'indexed'),
    duration_ms: Math.round(performance.now() - started),
  })

  if (!withRelated.value.length) return
  trackAnalyticsEvent('related_token_indicators_shown', {
    ...baseProperties(),
    ...countProperties(),
  })
  layoutPills()
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('scroll', positionPopover, true)
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('mousedown', onOutsideMouseDown)
  hostEl.value?.addEventListener('pointerenter', onDiagramPointerEnter)
  hostEl.value?.addEventListener('pointerleave', onDiagramPointerLeave)
}

function onDiagramPointerEnter() {
  diagramHovered.value = true
}

function onDiagramPointerLeave() {
  diagramHovered.value = false
}

function toggle(participant: RelatedParticipant) {
  if (open.value === participant) {
    open.value = null
    return
  }
  open.value = participant
  void nextTick(positionPopover)
  const rows = locations.value.get(participant) ?? []
  trackAnalyticsEvent('related_diagram_popover_opened', {
    ...baseProperties(),
    related_count: rows.length,
    label_variant_count: new Set(participant.related.map((page) => page.rawLabelThere)).size,
    same_page: rows.some((row) => !row.page),
  })
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = null
}

function onOutsideMouseDown() {
  open.value = null
}

function follow(participant: RelatedParticipant, page: RelatedPage) {
  const currentSpaceKey = (forgeGlobal as any)?.forgeContext?.extension?.space?.key ?? ''
  trackAnalyticsEvent('related_diagram_link_clicked', {
    ...baseProperties(),
    related_count: (locations.value.get(participant) ?? []).length,
    same_space: Boolean(currentSpaceKey) && page.spaceKey === currentSpaceKey,
  })
  const siteUrl = (forgeGlobal as any)?.forgeContext?.siteUrl ?? ''
  void openUrl(
    `${siteUrl}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(page.pageId)}`,
  )
}

onMounted(load)
watch(() => [props.ready, props.enabled], load)
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('scroll', positionPopover, true)
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('mousedown', onOutsideMouseDown)
  hostEl.value?.removeEventListener('pointerenter', onDiagramPointerEnter)
  hostEl.value?.removeEventListener('pointerleave', onDiagramPointerLeave)
})
</script>

<style scoped>
.related-diagrams {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 12px;
  color: #6b7280;
}

.related-diagrams-strong {
  color: #374151;
}

.related-diagrams-muted {
  color: #9ca3af;
}

.related-diagrams-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.related-diagrams-pill {
  position: absolute;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border: 1px solid #e5e7eb;
  border-radius: 9999px;
  color: #6b7280;
  background: #f3f4f6;
  font-family: inherit;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  pointer-events: auto;
}

.related-diagrams-pill--concealed {
  opacity: 0;
  pointer-events: none;
}

.related-diagrams-pill:hover {
  color: #374151;
  background: #e5e7eb;
}

.related-diagrams-pill:focus-visible {
  outline: 2px solid #0052cc;
  outline-offset: 2px;
}

.related-diagrams-pill[aria-expanded='true'] {
  border-color: #0052cc;
  color: #0052cc;
}

.related-diagrams-highlight {
  position: absolute;
  box-sizing: border-box;
  border-radius: 3px;
  pointer-events: none;
}

.related-diagrams-popover {
  position: fixed;
  z-index: 5;
  width: 320px;
  padding: 8px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  color: #172b4d;
  background: #fff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  font-family: inherit;
  text-align: left;
  pointer-events: auto;
}

.related-diagrams-popover-arrow {
  position: absolute;
  top: -6px;
  width: 10px;
  height: 10px;
  border-top: 1px solid #e5e7eb;
  border-left: 1px solid #e5e7eb;
  background: #fff;
  transform: rotate(45deg);
}

.related-diagrams-popover-arrow--under {
  top: auto;
  bottom: -6px;
  border-top: none;
  border-left: none;
  border-right: 1px solid #e5e7eb;
  border-bottom: 1px solid #e5e7eb;
}

.related-diagrams-popover-heading {
  padding: 2px 10px 6px;
  color: #6b7280;
  font-size: 12px;
  line-height: 16px;
}

.related-diagrams-popover ul {
  /* Eight rows and part of a ninth: a cut row shows there is more. The second term keeps
     the shell inside a short iframe — 64px covers the shell padding, the heading and the
     8px edge gutters. */
  max-height: min(238px, calc(100vh - 64px));
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}

.related-diagrams-popover a,
.related-diagrams-here {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  gap: 6px;
  height: 28px;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 13px;
  line-height: 16px;
  text-decoration: none;
}

.related-diagrams-popover a {
  color: #0052cc;
}

.related-diagrams-popover a:hover {
  background: #f3f4f6;
  color: #0747a6;
  text-decoration: underline;
}

.related-diagrams-here {
  color: #172b4d;
  cursor: default;
}

.related-diagrams-link-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
