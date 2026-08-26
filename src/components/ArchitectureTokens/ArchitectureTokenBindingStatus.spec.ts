import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram'
import store from '@/model/store2'
import ArchitectureTokenBindingStatus from './ArchitectureTokenBindingStatus.vue'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}))

const SOURCE = 'flowchart TD\n  A[Private source] --> B[Private destination]'
const CHANGED_SOURCE = `${SOURCE}\n  B --> C[Another private node]`
const SENSITIVE_SOURCE = 'flowchart TD\n  customer-secret[Customer label] --> token-secret[Token label]'
const SENSITIVE_STATE = {
  kind: 'available',
  state: {
    bindings: [{ tokenBindingId: 'token-id-123', diagramElementId: 'element-id-456' }],
  },
  sourceRevision: { normalizedSourceSha256: 'private-hash-789' },
} as any

const SAFE_RECONCILIATION_HISTORY = [
  {
    outcome: 'unresolved',
    categories: ['ambiguous_structure', 'candidate_unresolved'],
  },
] as const

describe('ArchitectureTokenBindingStatus', () => {
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    vi.mocked(trackAnalyticsEvent).mockClear()
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Mermaid,
      mermaidCode: SOURCE,
      architectureTokenBindingReadState: undefined,
    }
  })

  function mountStatus(readState: any) {
    store.state.diagram.architectureTokenBindingReadState = readState
    return mount(ArchitectureTokenBindingStatus, { global: { plugins: [store] } })
  }

  function expectedAnalytics(state: 'available' | 'stale' | 'untrusted') {
    return [
      'architecture_binding_read_state_presented',
      {
        feature_area: 'architecture_tokens',
        surface: 'editor',
        macro_type: 'mermaid',
        architecture_element_kind: 'node',
        architecture_binding_read_state: state,
        architecture_algorithm_version: 'architecture-token-binding-v1',
      },
    ]
  }

  it('shows a read-only available status and sends only closed-vocabulary analytics', () => {
    const wrapper = mountStatus({ kind: 'available' })

    expect(wrapper.find('[data-testid="architecture-token-binding-status"]').classes()).toContain(
      'architecture-binding-status--available',
    )
    expect(wrapper.text()).toContain('evidence available')
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(...expectedAnalytics('available'))
  })

  it('shows a loaded stale status without offering a repair or transfer action', () => {
    const wrapper = mountStatus({ kind: 'stale', reason: 'source_hash_mismatch', sourceRevisionId: 'rev-1' })

    expect(wrapper.find('[data-testid="architecture-token-binding-status"]').classes()).toContain(
      'architecture-binding-status--stale',
    )
    expect(wrapper.text()).toContain('needs review')
    expect(wrapper.text()).toContain('No changes were made')
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(...expectedAnalytics('stale'))
  })

  it('shows untrusted evidence as unavailable and leaves it unchanged', () => {
    const wrapper = mountStatus({ kind: 'untrusted', reason: 'invalid_state' })

    expect(wrapper.find('[data-testid="architecture-token-binding-status"]').classes()).toContain(
      'architecture-binding-status--untrusted',
    )
    expect(wrapper.text()).toContain('evidence unavailable')
    expect(wrapper.text()).toContain('left unchanged')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(...expectedAnalytics('untrusted'))
  })

  it('marks available evidence stale while source is edited, then restores available for the original source', async () => {
    const wrapper = mountStatus({ kind: 'available' })

    store.commit('updateMermaidCode', CHANGED_SOURCE)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="architecture-token-binding-status"]').classes()).toContain(
      'architecture-binding-status--stale',
    )

    store.commit('updateMermaidCode', SOURCE)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="architecture-token-binding-status"]').classes()).toContain(
      'architecture-binding-status--available',
    )
    expect(trackAnalyticsEvent).toHaveBeenNthCalledWith(2, ...expectedAnalytics('stale'))
    expect(trackAnalyticsEvent).toHaveBeenNthCalledWith(3, ...expectedAnalytics('available'))
  })

  it('adopts the saved source as the new UI baseline when a successful save refreshes available state', async () => {
    const wrapper = mountStatus({ kind: 'available' })

    store.commit('updateMermaidCode', CHANGED_SOURCE)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="architecture-token-binding-status"]').classes()).toContain(
      'architecture-binding-status--stale',
    )

    // saveToPlatform assigns a newly-read available result only after the
    // custom-content write succeeds. The status must use the then-current
    // editor source as its fresh baseline, rather than the source from mount.
    store.state.diagram.architectureTokenBindingReadState = { kind: 'available' }
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="architecture-token-binding-status"]').classes()).toContain(
      'architecture-binding-status--available',
    )
  })

  it('never renders source, hashes, native IDs, token IDs, or labels', () => {
    store.commit('updateMermaidCode', SENSITIVE_SOURCE)
    const wrapper = mountStatus(SENSITIVE_STATE)

    expect(wrapper.text()).not.toContain(SENSITIVE_SOURCE)
    expect(wrapper.text()).not.toContain('private-hash-789')
    expect(wrapper.text()).not.toContain('token-id-123')
    expect(wrapper.text()).not.toContain('element-id-456')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(...expectedAnalytics('available'))
    expect(JSON.stringify(vi.mocked(trackAnalyticsEvent).mock.calls)).not.toContain('private-hash-789')
    expect(JSON.stringify(vi.mocked(trackAnalyticsEvent).mock.calls)).not.toContain('token-id-123')
    expect(JSON.stringify(vi.mocked(trackAnalyticsEvent).mock.calls)).not.toContain('Customer label')
  })

  it('shows only privacy-safe saved reconciliation outcome categories', () => {
    const wrapper = mountStatus({
      ...SENSITIVE_STATE,
      reconciliationHistory: SAFE_RECONCILIATION_HISTORY,
      state: {
        ...SENSITIVE_STATE.state,
        audit: [{
          reasons: ['ambiguous_split_merge', 'private-reason-should-not-render'],
          auditId: 'private-audit-id',
          sourceRevisionId: 'private-revision-id',
        }],
      },
    })

    expect(wrapper.find('[data-testid="architecture-token-binding-history"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Saved outcome: needs human confirmation')
    expect(wrapper.text()).toContain('Ambiguous structure')
    expect(wrapper.text()).toContain('Matching evidence incomplete')
    expect(wrapper.text()).not.toContain('private-reason-should-not-render')
    expect(wrapper.text()).not.toContain('private-audit-id')
    expect(wrapper.text()).not.toContain('private-revision-id')
    expect(wrapper.findAll('button')).toHaveLength(0)
  })

  it('records a closed-vocabulary confirmation requirement when an unresolved audit is presented', () => {
    const wrapper = mountStatus({
      ...SENSITIVE_STATE,
      reconciliationHistory: SAFE_RECONCILIATION_HISTORY,
    })

    expect(wrapper.text()).toContain('Saved outcome: needs human confirmation')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'architecture_binding_requires_confirmation',
      {
        feature_area: 'architecture_tokens',
        surface: 'editor',
        macro_type: 'mermaid',
        architecture_element_kind: 'node',
        architecture_reconciliation_status: 'needs_confirmation',
        architecture_ambiguity_reason: 'split_or_merge',
        architecture_algorithm_version: 'architecture-token-binding-v1',
      },
    )
    expect(JSON.stringify(vi.mocked(trackAnalyticsEvent).mock.calls)).not.toContain('private-hash-789')
    expect(JSON.stringify(vi.mocked(trackAnalyticsEvent).mock.calls)).not.toContain('token-id-123')
  })

  it('records an orphaned result without inventing an ambiguity reason', () => {
    const wrapper = mountStatus({
      ...SENSITIVE_STATE,
      reconciliationHistory: [{
        outcome: 'unresolved',
        categories: ['binding_orphaned'],
      }],
    })

    expect(wrapper.text()).toContain('Binding orphaned')
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      'architecture_binding_requires_confirmation',
      {
        feature_area: 'architecture_tokens',
        surface: 'editor',
        macro_type: 'mermaid',
        architecture_element_kind: 'node',
        architecture_reconciliation_status: 'orphaned',
        architecture_algorithm_version: 'architecture-token-binding-v1',
      },
    )
  })

  it.each([
    ['not configured', { kind: 'not_configured' }],
    ['not applicable', { kind: 'not_applicable' }],
    ['missing state', undefined],
  ])('hides when the saved state is %s', (_name, readState) => {
    const wrapper = mountStatus(readState)

    expect(wrapper.find('[data-testid="architecture-token-binding-status"]').exists()).toBe(false)
    expect(trackAnalyticsEvent).not.toHaveBeenCalled()
  })

  it('hides for non-Mermaid diagrams even if a read state is present', () => {
    store.state.diagram = {
      ...store.state.diagram,
      diagramType: DiagramType.Sequence,
      architectureTokenBindingReadState: { kind: 'available' },
    }
    const wrapper = mount(ArchitectureTokenBindingStatus, { global: { plugins: [store] } })

    expect(wrapper.find('[data-testid="architecture-token-binding-status"]').exists()).toBe(false)
    expect(trackAnalyticsEvent).not.toHaveBeenCalled()
  })
})
