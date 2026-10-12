import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Markdown from './Markdown.vue';
import EventBus from '@/EventBus';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

const render = vi.hoisted(() => vi.fn());
vi.mock('@/utils/markdown/renderMarkdown', () => ({ renderMarkdown: render }));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }));
vi.mock('@/utils/analytics/trackRenderTime', () => ({ trackRenderTime: vi.fn() }));
vi.mock('@/utils/renderGate/documentLayout', () => ({ hasLayout: () => true, awaitLayout: async () => true }));

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('Markdown preview lifecycle', () => {
  it('marks a cleared document ready so its old export can be replaced', async () => {
    const store = createStore({ state: { diagram: { markdownCode: '' } }, getters: { isDisplayMode: () => false } });
    const emitted = vi.fn();
    EventBus.$on('diagramLoaded', emitted);
    const wrapper = mount(Markdown, { global: { plugins: [store] } });
    await flushPromises();
    expect(wrapper.attributes('data-markdown-source-hash')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(emitted).toHaveBeenCalledWith('', 'markdown');
    EventBus.$off('diagramLoaded', emitted);
    wrapper.unmount();
  });
  it('discards a stale async render and emits the active source for export', async () => {
    let finishOld!: (value: any) => void;
    render.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }));
    render.mockResolvedValueOnce({ html: '<h1>New</h1>', mermaidBlocks: 0, failedBlocks: 0 });
    const store = createStore({ state: { diagram: { markdownCode: '# Old' } }, getters: { isDisplayMode: () => false } });
    const emitted = vi.fn();
    EventBus.$on('diagramLoaded', emitted);
    const wrapper = mount(Markdown, { global: { plugins: [store] } });
    await vi.advanceTimersByTimeAsync(250);
    store.state.diagram.markdownCode = '# New';
    await wrapper.vm.$nextTick();
    await vi.advanceTimersByTimeAsync(250);
    await flushPromises();
    finishOld({ html: '<h1>Old</h1>', mermaidBlocks: 1, failedBlocks: 0 });
    await flushPromises();
    expect(wrapper.find('h1').text()).toBe('New');
    expect(emitted).toHaveBeenCalledTimes(1);
    expect(emitted).toHaveBeenCalledWith('# New', 'markdown');
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('markdown_render_succeeded', expect.objectContaining({ macro_type: 'markdown', surface: 'editor' }));
    EventBus.$off('diagramLoaded', emitted);
    wrapper.unmount();
  });
});
