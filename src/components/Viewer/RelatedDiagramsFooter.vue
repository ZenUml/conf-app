<template>
  <footer
    v-if="withRelated.length"
    class="related-diagrams"
    data-testid="related-diagrams-footer"
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
    <span><span class="related-diagrams-strong">{{ withRelated.length }} of {{ participants.length }} participants</span>{{ ' also appear in other diagrams you can access' }}</span>
    <span v-if="asOf" class="related-diagrams-muted">· as of {{ asOf }}</span>
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
        :class="{ 'related-diagrams-pill--concealed': !isPillVisible(item.actorId, item.participant) }"
        data-testid="related-diagrams-pill"
        :data-actor="item.actorId"
        :style="{ left: `${item.left}px`, top: `${item.top}px` }"
        :title="`${item.participant.related.length} related diagrams you can access — click to see`"
        :aria-expanded="open === item.participant"
        @focus="focused = item.actorId"
        @blur="focused = null"
        @mouseenter="hovered = item.actorId"
        @mouseleave="onPillLeave(item.actorId)"
        @mousedown.stop
        @click.stop="toggle(item.participant)"
        @touchstart.stop="onTouch($event, item.participant)"
      >
        {{ item.participant.related.length }}
      </button>

      <div
        v-if="openPill"
        class="related-diagrams-highlight"
        data-testid="related-diagrams-highlight"
        :style="highlightStyle"
      />

      <div
        v-if="open && openPill"
        class="related-diagrams-popover"
        data-testid="related-diagrams-popover"
        role="dialog"
        aria-label="Possibly related by name"
        :style="{ left: `${openPill.anchorLeft}px`, top: `${openPill.anchorTop}px` }"
        @mousedown.stop
      >
        <div class="related-diagrams-popover-arrow" />
        <div class="related-diagrams-popover-eyebrow">Possibly related by name</div>
        <div class="related-diagrams-popover-label">{{ open.rawLabel }}</div>
        <ul>
          <li v-for="page in open.related" :key="page.contentId">
            <a href="#" data-testid="related-diagram-link" @click.prevent="follow(open, page)">
              <span class="related-diagrams-link-title">{{ page.pageTitle }}</span>
              <span
                v-if="page.pageId === props.pageId"
                class="related-diagrams-current-page"
                data-testid="related-diagrams-current-page"
              >
                This page
              </span>
            </a>
            <span class="related-diagrams-space">{{ page.spaceKey }}</span>
            <span
              v-if="page.rawLabelThere !== open.rawLabel"
              class="related-diagrams-variant"
            >
              as <code>{{ page.rawLabelThere }}</code>
            </span>
          </li>
        </ul>
        <div class="related-diagrams-popover-foot">
          <span>Same name, not proof of the same object</span>
          <span v-if="asOf">as of {{ asOf }}</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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

interface Pill {
  actorId: string
  participant: RelatedParticipant
  left: number
  top: number
  anchorLeft: number
  anchorTop: number
  actorLeft: number
  actorTop: number
  actorWidth: number
  actorHeight: number
}

const participants = ref<RelatedParticipant[]>([])
const indexedAt = ref<string | null>(null)
const open = ref<RelatedParticipant | null>(null)
const hostEl = ref<HTMLElement | null>(null)
const pills = ref<Pill[]>([])
const hovered = ref<string | null>(null)
const focused = ref<string | null>(null)
const touchRevealed = ref<string | null>(null)
let requested = false

const withRelated = computed(() => participants.value.filter((participant) => participant.related.length))
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
  related_pages_total: withRelated.value.reduce(
    (total, participant) => total + participant.related.length,
    0,
  ),
  index_age_days: indexedAt.value
    ? Math.floor((Date.now() - new Date(indexedAt.value).getTime()) / 86_400_000)
    : undefined,
})

function actorBox(actorId: string): SVGGraphicsElement | null {
  const escaped = (globalThis as any).CSS?.escape
    ? (globalThis as any).CSS.escape(actorId)
    : actorId.replace(/["\\]/g, '\\$&')
  return (
    hostEl.value?.querySelector<SVGGraphicsElement>(`rect.actor-top[name="${escaped}"]`) ?? null
  )
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
        left: rect.right - hostBox.left - 12,
        top: rect.top - hostBox.top - 9,
        anchorLeft: rect.left - hostBox.left,
        anchorTop: rect.bottom - hostBox.top + 8,
        actorLeft: rect.left - hostBox.left,
        actorTop: rect.top - hostBox.top,
        actorWidth: rect.width,
        actorHeight: rect.height,
      },
    ]
  })
}

async function load() {
  if (requested || !props.enabled || !props.ready) return
  requested = true
  const started = performance.now()
  let response: RelatedResponse
  try {
    response = await getRelatedDiagrams(props.customContentId)
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
  const presentActorIds = new Set(
    [...(hostEl.value?.querySelectorAll('[name]') ?? [])].map((element) =>
      element.getAttribute('name'),
    ),
  )
  participants.value = response.participants.filter((participant) =>
    presentActorIds.has(participant.actorId),
  )
  indexedAt.value = response.indexedAt

  trackAnalyticsEvent('related_diagrams_lookup_succeeded', {
    ...baseProperties(),
    ...countProperties(),
    duration_ms: Math.round(performance.now() - started),
  })

  if (!withRelated.value.length) return
  trackAnalyticsEvent('related_diagrams_shown', {
    ...baseProperties(),
    ...countProperties(),
  })
  layoutPills()
  window.addEventListener('resize', layoutPills)
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('mousedown', onOutsideMouseDown)
  hostEl.value?.addEventListener('mouseover', onHostMouseOver)
  hostEl.value?.addEventListener('mouseout', onHostMouseOut)
}

function actorFromEvent(event: Event): string | null {
  return (
    (event.target as Element | null)?.closest?.('[name]')?.getAttribute('name') ?? null
  )
}

function onHostMouseOver(event: Event) {
  const actorId = actorFromEvent(event)
  if (actorId && pills.value.some((item) => item.actorId === actorId)) hovered.value = actorId
}

function onHostMouseOut(event: MouseEvent) {
  const destination = event.relatedTarget as Element | null
  if (destination?.closest?.('[data-testid="related-diagrams-pill"]')) return
  const actorId = actorFromEvent(event)
  if (actorId === hovered.value) hovered.value = null
}

function isPillVisible(actorId: string, participant: RelatedParticipant) {
  return (
    hovered.value === actorId ||
    focused.value === actorId ||
    touchRevealed.value === actorId ||
    open.value === participant
  )
}

function onPillLeave(actorId: string) {
  if (open.value?.actorId !== actorId && touchRevealed.value !== actorId) hovered.value = null
}

function toggle(participant: RelatedParticipant) {
  touchRevealed.value = null
  if (open.value === participant) {
    open.value = null
    return
  }
  open.value = participant
  trackAnalyticsEvent('related_diagram_popover_opened', {
    ...baseProperties(),
    related_count: participant.related.length,
    label_variant_count: new Set(participant.related.map((page) => page.rawLabelThere)).size,
  })
}

function onTouch(event: TouchEvent, participant: RelatedParticipant) {
  event.preventDefault()
  if (!isPillVisible(participant.actorId, participant)) {
    touchRevealed.value = participant.actorId
    hovered.value = participant.actorId
    return
  }
  toggle(participant)
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = null
}

function onOutsideMouseDown() {
  open.value = null
  touchRevealed.value = null
}

function follow(participant: RelatedParticipant, page: RelatedPage) {
  const currentSpaceKey = (forgeGlobal as any)?.forgeContext?.extension?.space?.key ?? ''
  trackAnalyticsEvent('related_diagram_link_clicked', {
    ...baseProperties(),
    related_count: participant.related.length,
    same_space: Boolean(currentSpaceKey) && page.spaceKey === currentSpaceKey,
    same_page: page.pageId === props.pageId,
  })
  const siteUrl = (forgeGlobal as any)?.forgeContext?.siteUrl ?? ''
  void openUrl(
    `${siteUrl}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(page.pageId)}`,
  )
}

onMounted(load)
watch(() => [props.ready, props.enabled], load)
onBeforeUnmount(() => {
  window.removeEventListener('resize', layoutPills)
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('mousedown', onOutsideMouseDown)
  hostEl.value?.removeEventListener('mouseover', onHostMouseOver)
  hostEl.value?.removeEventListener('mouseout', onHostMouseOut)
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
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border: 1px solid #e5e7eb;
  border-radius: 9999px;
  color: #6b7280;
  background: #f3f4f6;
  font-family: inherit;
  font-size: 11px;
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
  position: absolute;
  z-index: 5;
  width: 320px;
  padding: 10px 10px 8px;
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
  left: 18px;
  width: 10px;
  height: 10px;
  border-top: 1px solid #e5e7eb;
  border-left: 1px solid #e5e7eb;
  background: #fff;
  transform: rotate(45deg);
}

.related-diagrams-popover-eyebrow {
  padding: 0 6px;
  color: #6b7280;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.related-diagrams-popover-label {
  padding: 2px 6px 6px;
  color: #172b4d;
  font-size: 13px;
  font-weight: 600;
}

.related-diagrams-popover ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.related-diagrams-popover li {
  display: flex;
  align-items: baseline;
  min-height: 28px;
  padding: 4px 6px;
  border-radius: 4px;
  gap: 6px;
  font-size: 13px;
}

.related-diagrams-popover li:hover {
  background: #f3f4f6;
}

.related-diagrams-popover a {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
  color: #0052cc;
  gap: 6px;
  text-decoration: none;
}

.related-diagrams-popover a:hover {
  color: #0747a6;
  text-decoration: underline;
}

.related-diagrams-link-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.related-diagrams-current-page {
  padding: 0 6px;
  border: 1px solid #e5e7eb;
  border-radius: 9999px;
  color: #6b7280;
  background: #f3f4f6;
  font-size: 11px;
  line-height: 16px;
  text-decoration: none;
  white-space: nowrap;
}

.related-diagrams-space {
  padding: 0 6px;
  border: 1px solid #e5e7eb;
  border-radius: 9999px;
  color: #6b7280;
  background: #f3f4f6;
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
}

.related-diagrams-variant {
  color: #6b7280;
  font-size: 12px;
  white-space: nowrap;
}

.related-diagrams-variant code {
  padding: 1px 4px;
  border-radius: 3px;
  color: #172b4d;
  background: #f4f5f7;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
    'Courier New', monospace;
  font-size: 11px;
}

.related-diagrams-popover-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  padding: 6px 6px 0;
  border-top: 1px solid #e5e7eb;
  color: #9ca3af;
  font-size: 11px;
}
</style>
