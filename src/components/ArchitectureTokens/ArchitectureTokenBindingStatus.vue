<template>
  <aside
    v-if="visible"
    class="architecture-binding-status"
    :class="`architecture-binding-status--${effectiveKind}`"
    data-testid="architecture-token-binding-status"
    role="status"
    aria-live="polite"
  >
    <span
      class="architecture-binding-status__marker"
      aria-hidden="true"
    >
      <span v-if="effectiveKind === 'available'">✓</span>
      <span v-else-if="effectiveKind === 'stale'">!</span>
      <span v-else>•</span>
    </span>
    <span class="architecture-binding-status__copy">
      <strong data-testid="architecture-token-binding-status-title">{{ copy.title }}</strong>
      <span data-testid="architecture-token-binding-status-detail">{{ copy.detail }}</span>
      <ul
        v-if="reconciliationHistory.length"
        class="architecture-binding-status__history"
        data-testid="architecture-token-binding-history"
        aria-label="Saved reconciliation history"
      >
        <li
          v-for="(entry, index) in reconciliationHistory"
          :key="`${entry.outcome}-${entry.categories.join('-')}-${index}`"
          data-testid="architecture-token-binding-history-entry"
        >
          <strong>{{ reconciliationOutcomeCopy(entry.outcome) }}</strong>
          <span>{{ reconciliationCategoryCopy(entry.categories) }}</span>
        </li>
      </ul>
    </span>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useStore } from 'vuex'
import { DiagramType } from '@/model/Diagram/Diagram'
import type { ArchitectureTokenBindingReadState } from '@/services/architectureTokens/readMermaidArchitectureTokenBinding'
import type {
  ArchitectureAmbiguityReason,
  ArchitectureBindingReadState,
  ArchitectureReconciliationStatus,
} from '@/utils/analytics/catalog'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

type PresentedState = Extract<ArchitectureBindingReadState, 'available' | 'stale' | 'untrusted'>

const store = useStore()

function currentSource(): string {
  const source = store.state.diagram?.mermaidCode
  return typeof source === 'string' ? source : ''
}

const sourceAtMount = ref(currentSource())

const diagramType = computed(() => store.state.diagram?.diagramType)
const mermaidSource = computed(() => currentSource())
const savedReadState = computed<ArchitectureTokenBindingReadState | undefined>(
  () => store.state.diagram?.architectureTokenBindingReadState,
)

const reconciliationHistory = computed(() =>
  savedReadState.value?.kind === 'available'
    ? savedReadState.value.reconciliationHistory ?? []
    : [],
)

type ConfirmationPresentation = Readonly<{
  status: Extract<ArchitectureReconciliationStatus, 'needs_confirmation' | 'orphaned'>
  ambiguityReason?: ArchitectureAmbiguityReason
}>

// The stored audit projection is already restricted to privacy-safe categories.
// Only its newest displayed outcome can produce this event: historic entries
// must not be reinterpreted as a current requirement for the editor session.
const confirmationPresentation = computed<ConfirmationPresentation | null>(() => {
  const latest = reconciliationHistory.value[0]
  if (!latest || latest.outcome !== 'unresolved') return null
  if (latest.categories.includes('binding_orphaned')) return { status: 'orphaned' }
  return {
    status: 'needs_confirmation',
    ...(latest.categories.includes('ambiguous_structure')
      ? { ambiguityReason: 'split_or_merge' as const }
      : {}),
  }
})

function presentedState(kind: unknown): PresentedState | null {
  return kind === 'available' || kind === 'stale' || kind === 'untrusted'
    ? kind
    : null
}

const savedKind = computed<PresentedState | null>(() => presentedState(savedReadState.value?.kind))
const sourceChanged = computed(() => mermaidSource.value !== sourceAtMount.value)

// A successful custom-content save replaces the transient read result with a
// newly-read available state. That makes the current editor source the only
// valid before-source for a subsequent reconciliation attempt, so move the UI
// baseline at the same point. Editing alone leaves the saved read object
// unchanged and therefore remains stale.
watch(
  savedReadState,
  (readState) => {
    if (readState?.kind === 'available') sourceAtMount.value = mermaidSource.value
  },
)

// The persisted reader result is intentionally read-only. During an editing
// session, changing Mermaid source makes an otherwise available snapshot
// stale until the user returns to the exact source that was loaded. This is a
// presentation guard only: it does not mutate the stored metadata or claim a
// reconciliation result.
const effectiveKind = computed<PresentedState | null>(() => {
  if (savedKind.value === 'available' && sourceChanged.value) return 'stale'
  return savedKind.value
})

const visible = computed(
  () => diagramType.value === DiagramType.Mermaid && effectiveKind.value !== null,
)

const presentedKind = computed<PresentedState | null>(() =>
  visible.value ? effectiveKind.value : null,
)

const copy = computed(() => {
  switch (presentedKind.value) {
    case 'available':
      return {
        title: 'Architecture Token evidence available',
        detail: 'Saved evidence matches this diagram. No changes were made.',
      }
    case 'stale':
      return {
        title: 'Architecture Token evidence needs review',
        detail: 'The diagram source has changed since the saved evidence. No changes were made.',
      }
    case 'untrusted':
      return {
        title: 'Architecture Token evidence unavailable',
        detail: 'Saved evidence could not be trusted and was left unchanged.',
      }
    default:
      return { title: '', detail: '' }
  }
})

function reconciliationOutcomeCopy(outcome: 'accepted' | 'rejected' | 'unresolved'): string {
  switch (outcome) {
    case 'accepted': return 'Saved outcome: evidence recorded'
    case 'unresolved': return 'Saved outcome: needs human confirmation'
    case 'rejected': return 'Saved outcome: not applied'
  }
}

function reconciliationCategoryCopy(categories: readonly string[]): string {
  const labels: Record<string, string> = {
    binding_retained: 'Binding retained',
    exact_relocation: 'Exact source relocation',
    fingerprint_match: 'Static facts unchanged',
    no_safe_relocation: 'Source change needs review',
    relocation_unresolved: 'Source relocation unresolved',
    candidate_unresolved: 'Matching evidence incomplete',
    assignment_unresolved: 'Assignment evidence incomplete',
    topology_unresolved: 'Topology evidence incomplete',
    ambiguous_structure: 'Ambiguous structure',
    binding_orphaned: 'Binding orphaned',
  }
  return categories.map((category) => labels[category]).filter(Boolean).join(' · ')
}

watch(
  presentedKind,
  (kind, previousKind) => {
    if (!kind || kind === previousKind) return
    trackAnalyticsEvent('architecture_binding_read_state_presented', {
      feature_area: 'architecture_tokens',
      surface: 'editor',
      macro_type: 'mermaid',
      architecture_element_kind: 'node',
      architecture_binding_read_state: kind,
      architecture_algorithm_version: 'architecture-token-binding-v1',
    })
  },
  { immediate: true },
)

watch(
  confirmationPresentation,
  (presentation, previousPresentation) => {
    if (!presentation || presentation === previousPresentation) return
    trackAnalyticsEvent('architecture_binding_requires_confirmation', {
      feature_area: 'architecture_tokens',
      surface: 'editor',
      macro_type: 'mermaid',
      architecture_element_kind: 'node',
      architecture_reconciliation_status: presentation.status,
      ...(presentation.ambiguityReason
        ? { architecture_ambiguity_reason: presentation.ambiguityReason }
        : {}),
      architecture_algorithm_version: 'architecture-token-binding-v1',
    })
  },
  { immediate: true },
)

defineExpose({ effectiveKind, visible })
</script>

<style scoped>
.architecture-binding-status {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 8px 12px;
  padding: 8px 10px;
  border: 1px solid;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.35;
}

.architecture-binding-status__marker {
  display: inline-flex;
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  font-weight: 700;
}

.architecture-binding-status__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.architecture-binding-status__history {
  display: grid;
  gap: 2px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}

.architecture-binding-status__history li {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.architecture-binding-status--available {
  border-color: #abf3d0;
  background: #ecfdf5;
  color: #065f46;
}

.architecture-binding-status--available .architecture-binding-status__marker {
  background: #10b981;
  color: #ffffff;
}

.architecture-binding-status--stale {
  border-color: #f8d477;
  background: #fffbeb;
  color: #92400e;
}

.architecture-binding-status--stale .architecture-binding-status__marker {
  background: #f59e0b;
  color: #ffffff;
}

.architecture-binding-status--untrusted {
  border-color: #e9d5ff;
  background: #faf5ff;
  color: #6b21a8;
}

.architecture-binding-status--untrusted .architecture-binding-status__marker {
  background: #9333ea;
  color: #ffffff;
}
</style>
