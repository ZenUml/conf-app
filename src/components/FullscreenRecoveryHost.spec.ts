import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FullscreenRecoveryHost from './FullscreenRecoveryHost.vue';
import type { RecoverySnapshot } from '../../shared/fullscreenRecovery';

const mocks = vi.hoisted(() => ({ activate: vi.fn(), get: vi.fn(), ready: undefined as undefined | ((kind: 'mermaid') => void), stop: vi.fn(), track: vi.fn() }));
vi.mock('@/apis/fullscreenRecovery', () => ({ activateFullscreenRecovery: mocks.activate, getFullscreenRecovery: mocks.get, requestFullscreenRecovery: vi.fn() }));
vi.mock('@/utils/fullscreenReady', () => ({ onVisibleDiagramReady: (_: unknown, callback: typeof mocks.ready) => { mocks.ready = callback; return mocks.stop; } }));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: mocks.track }));
const base: RecoverySnapshot = {
  state: 'pending_activation', serverNow: '2026-10-24T00:00:00.000Z', policyVersion: 'fullscreen-contact-v1',
  request: { id: 'request', scenarios: ['present'], email: 'reader@example.com', note: '', createdAt: '2026-10-24T00:00:00.000Z' },
  grant: { id: 'grant', activatedAt: null, expiresAt: null },
};
const Gate = defineComponent({ props: ['snapshot'], emits: ['open-fullscreen', 'update:snapshot', 'plan-usage'], template: '<button data-testid="gate" @click="$emit(\'open-fullscreen\')">Open</button>' });
const Status = defineComponent({ props: ['snapshot'], template: '<aside>{{snapshot.state}}</aside>' });
const Content = defineComponent({ template: '<div data-testid="diagram">Diagram remains visible</div>' });
let wrapper: ReturnType<typeof mount>;
function create(snapshot: RecoverySnapshot = base) {
  wrapper = mount(FullscreenRecoveryHost, { props: { initialSnapshot: snapshot, content: Content, returnInline: vi.fn(), planUsage: vi.fn() },
    global: { stubs: { FullscreenRecoveryGate: Gate, FullscreenRecoveryStatus: Status } } });
  return wrapper;
}
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date(base.serverNow)); });
afterEach(() => { wrapper?.unmount(); vi.useRealTimers(); });
describe('Fullscreen access lifecycle', () => {
  it('does not start seven days on submit or open: waits for the visible render receipt', async () => {
    create(); expect(mocks.activate).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="gate"]').trigger('click');
    expect(wrapper.find('[data-testid="diagram"]').exists()).toBe(true);
    expect(mocks.activate).not.toHaveBeenCalled();
    mocks.activate.mockResolvedValue({ snapshot: { ...base, state: 'active' }, outcome: 'activated' });
    mocks.ready!('mermaid'); await flushPromises();
    expect(mocks.activate).toHaveBeenCalledTimes(1);
    expect(mocks.activate.mock.calls[0][0]).toMatchObject({ requestId: 'request', action: 'activate' });
    expect(wrapper.text()).toContain('active');
  });
  it('leaves the current diagram open on expiry; a fresh expired mount has a gate', async () => {
    const active = { ...base, state: 'active' as const, grant: { id: 'grant', activatedAt: base.serverNow, expiresAt: '2026-10-24T00:00:10.000Z' } };
    create(active); await vi.advanceTimersByTimeAsync(30_000);
    expect(wrapper.text()).toContain('expired');
    expect(wrapper.find('[data-testid="diagram"]').isVisible()).toBe(true);
    expect(mocks.activate).not.toHaveBeenCalled(); wrapper.unmount();
    create({ ...active, state: 'expired' });
    expect(wrapper.find('[data-testid="diagram"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="gate"]').exists()).toBe(true);
  });
  it('keeps a successfully opened diagram visible when activation confirmation fails and retries idempotently', async () => {
    mocks.activate.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ snapshot: { ...base, state: 'active' } });
    create(); await wrapper.get('[data-testid="gate"]').trigger('click');
    mocks.ready!('mermaid'); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('could not confirm');
    expect(wrapper.find('[data-testid="diagram"]').isVisible()).toBe(true);
    await wrapper.get('[role="alert"] button').trigger('click'); await flushPromises();
    expect(mocks.activate).toHaveBeenCalledTimes(2);
    expect(mocks.activate.mock.calls[0][0].attemptId).toBe(mocks.activate.mock.calls[1][0].attemptId);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
  it('does not activate a pending case after the host has been closed', async () => {
    create(); wrapper.unmount(); expect(mocks.stop).toHaveBeenCalledOnce();
    // The unsubscribe is what prevents actual late renderer delivery.
    await nextTick(); expect(mocks.activate).not.toHaveBeenCalled();
  });
});
