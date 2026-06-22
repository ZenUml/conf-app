import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Mermaid from '@/components/Mermaid.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import globals from '@/model/globals';

// loadMermaid is the renderer-bundle load Lever D aims to SKIP on a cache hit —
// assert against this mock to prove the skip.
const loadMermaidMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/utils/mermaid/loadMermaid', () => ({ loadMermaid: loadMermaidMock.fn }));

const trackMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/utils/analytics/trackRenderTime', () => ({ trackRenderTime: trackMock.fn }));

// NOTE: sanitizeSvg is NOT mocked — exercised for real so the cache path is
// verified end-to-end (DOMParser scrub running in jsdom, same code as the browser).

describe('Mermaid.vue — Lever D cached-SVG read path', () => {
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    store.state.diagram = { ...NULL_DIAGRAM };
    // mermaid.render() output for the LIVE fallback path
    loadMermaidMock.fn.mockResolvedValue({
      render: vi.fn().mockResolvedValue({ svg: '<svg id="live"><text>LIVE</text></svg>' }),
    });
    // Mermaid.vue calls globals.apWrapper.initializeContext() at end of mounted(),
    // and the store's isDisplayMode getter calls globals.apWrapper.isDisplayMode().
    (globals as any).apWrapper = {
      initializeContext: vi.fn().mockResolvedValue(undefined),
      isDisplayMode: () => true,
    };
  });

  afterEach(() => {
    // Unmount: the store is a shared singleton, so a lingering instance's
    // mermaidCode watcher would re-fire when the next test mutates the store.
    wrapper?.unmount();
    wrapper = undefined;
  });

  it('injects the sanitized cached SVG and SKIPS loadMermaid when mermaidSvg is present', async () => {
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Mermaid,
      mermaidCode: 'sequenceDiagram\n A->>B: hi',
      mermaidSvg: '<svg id="cached" xmlns="http://www.w3.org/2000/svg"><text>CACHED</text></svg>',
    };
    wrapper = mount(Mermaid, { global: { plugins: [store] } });
    await flushPromises();

    expect(loadMermaidMock.fn).not.toHaveBeenCalled(); // renderer bundle NOT loaded
    expect(wrapper.html()).toContain('CACHED');
    expect(wrapper.html()).not.toContain('LIVE');
    expect(trackMock.fn).toHaveBeenCalledWith('mermaid', expect.anything(), 'cached_svg', 'cc_body');
  });

  it('live-renders (loads mermaid) when no cached SVG is present', async () => {
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Mermaid,
      mermaidCode: 'sequenceDiagram\n A->>B: hi',
    };
    wrapper = mount(Mermaid, { global: { plugins: [store] } });
    await flushPromises();

    expect(loadMermaidMock.fn).toHaveBeenCalledTimes(1);
    expect(wrapper.html()).toContain('LIVE');
    expect(trackMock.fn).toHaveBeenCalledWith('mermaid', expect.anything(), 'live_render', 'none');
  });

  it('falls back to live render when the cached SVG fails sanitization', async () => {
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Mermaid,
      mermaidCode: 'sequenceDiagram\n A->>B: hi',
      mermaidSvg: '<div>not an svg</div>', // sanitizeSvg returns undefined → fallback
    };
    wrapper = mount(Mermaid, { global: { plugins: [store] } });
    await flushPromises();

    expect(loadMermaidMock.fn).toHaveBeenCalledTimes(1);
    expect(wrapper.html()).toContain('LIVE');
    expect(trackMock.fn).toHaveBeenCalledWith('mermaid', expect.anything(), 'live_render', 'none');
  });
});
