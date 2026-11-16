import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FullscreenRecoveryHost from './FullscreenRecoveryHost.vue'
import type { RecoverySnapshot } from '../../shared/fullscreenRecovery'

const mocks = vi.hoisted(() => ({ activate: vi.fn(), get: vi.fn(), ready: vi.fn(), register: vi.fn(), track: vi.fn() }))
vi.mock('@/apis/fullscreenRecovery', () => ({ activateFullscreenRecovery: mocks.activate, getFullscreenRecovery: mocks.get, requestFullscreenRecovery: vi.fn() }))
vi.mock('@/utils/fullscreenReady', () => ({ onVisibleDiagramReady: mocks.ready.mockReturnValue(() => {}) }))
vi.mock('@/utils/paywall/editRecoveryActivation', () => ({ registerEditActivation: mocks.register, clearEditActivation: vi.fn() }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: mocks.track }))

const pending: RecoverySnapshot = {
  state: 'pending_activation', serverNow: '2026-12-08T09:00:00Z', policyVersion: 'edit-contact-v1', limit: 100,
  request: { id: 'req-1', scenarios: ['fix_or_update'], email: 'r@example.com', note: '', createdAt: '2026-12-08T09:00:00Z' },
  grant: { id: 'g', activatedAt: null, expiresAt: null },
}
const Gate = defineComponent({ props: ['snapshot', 'feature'], emits: ['open-fullscreen'], template: '<button data-testid="gate" @click="$emit(\'open-fullscreen\')">{{feature}}</button>' })
const Editor = defineComponent({ template: '<div data-testid="editor">editor</div>' })
let wrapper: ReturnType<typeof mount>
beforeEach(() => vi.clearAllMocks())
afterEach(() => wrapper?.unmount())

describe('edit feature in the shared host', () => {
  it('opening the editor calls onOpen, registers the save-time activation, and starts no 7 days by itself', async () => {
    const onOpen = vi.fn()
    wrapper = mount(FullscreenRecoveryHost, { props: { initialSnapshot: pending, feature: 'edit', content: Editor, context: { spaceKey: 'ENG' }, returnInline: vi.fn(), planUsage: vi.fn(), onOpen },
      global: { stubs: { FullscreenRecoveryGate: Gate } } })
    expect(wrapper.find('[data-testid="editor"]').exists()).toBe(false)
    await wrapper.get('[data-testid="gate"]').trigger('click'); await flushPromises()
    expect(wrapper.find('[data-testid="editor"]').exists()).toBe(true)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-1', spaceKey: 'ENG' }))
    expect(mocks.ready).not.toHaveBeenCalled()   // no "diagram rendered" receipt for the editor
    expect(mocks.activate).not.toHaveBeenCalled()
    expect(wrapper.find('aside').exists()).toBe(false)  // no status strip laid over the editor
  })
})
