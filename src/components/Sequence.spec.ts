import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Sequence from '@/components/Sequence.vue';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import * as renderPerf from '@/utils/analytics/renderPerf';

// @zenuml/core: default export is the interactive ZenUml class (React mount);
// renderToSvg is the synchronous static-SVG export the sync path uses.
const z = vi.hoisted(() => {
  const renderToSvg = vi.fn(() => ({
    svg: '<svg id="sync" xmlns="http://www.w3.org/2000/svg"><text>SYNC</text></svg>',
  }));
  const renderInstance = vi.fn().mockResolvedValue(undefined);
  const ZenUmlCtor = vi.fn(function (this: any) {
    this.render = renderInstance;
    this.version = '3.x-test';
  });
  return { renderToSvg, renderInstance, ZenUmlCtor };
});
vi.mock('@zenuml/core', () => ({ default: z.ZenUmlCtor, renderToSvg: z.renderToSvg }));

const trackMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/utils/analytics/trackRenderTime', () => ({ trackRenderTime: trackMock.fn }));

const trackEventMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: trackEventMock.fn }));

import { getCachedSvg, putCachedSvg } from '@/utils/renderCache/renderCacheStore';

vi.mock('@/components/Viewer/ViewResizer.vue', () => ({
  default: { name: 'ViewResizer', template: '<div><slot /></div>' },
}));

const SEQ_DOC = { ...NULL_DIAGRAM, diagramType: DiagramType.Sequence, code: 'A.method()', id: 'seq-1' };

// Inject a per-test mock $store: the real store is a shared singleton whose Vuex
// isDisplayMode getter caches (no reactive dep), so it can't be toggled per test.
function mountSeq(displayMode: boolean, diagram: any = { ...SEQ_DOC }) {
  return mount(Sequence, {
    global: {
      mocks: {
        $store: { state: { diagram }, getters: { isDisplayMode: displayMode }, dispatch: vi.fn() },
      },
    },
  });
}

describe('Sequence.vue — Lever D sync-SVG path', () => {
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    renderPerf._resetForTesting();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it('A: display-mode + default theme → renderToSvg, NO React mount, render_mode sync_svg', async () => {
    wrapper = mountSeq(true);
    await flushPromises();
    expect(z.renderToSvg).toHaveBeenCalledWith('A.method()');
    expect(z.ZenUmlCtor).not.toHaveBeenCalled(); // React mount skipped
    expect(wrapper.html()).toContain('SYNC');
    expect(trackMock.fn).toHaveBeenCalledWith('sequence', true, 'sync_svg', 'none');
  });

  it('B: non-default global theme → falls back to interactive React render', async () => {
    localStorage.setItem(`${location.hostname}-zenuml-conf-theme`, 'theme-dark');
    wrapper = mountSeq(true);
    await flushPromises();
    expect(z.ZenUmlCtor).toHaveBeenCalledTimes(1);
    expect(z.renderToSvg).not.toHaveBeenCalled();
    expect(trackMock.fn).toHaveBeenCalledWith('sequence', true, 'live_render', 'none');
  });

  it('C: editor (not display mode) → always interactive React render', async () => {
    wrapper = mountSeq(false);
    await flushPromises();
    expect(z.ZenUmlCtor).toHaveBeenCalledTimes(1);
    expect(z.renderToSvg).not.toHaveBeenCalled();
    expect(trackMock.fn).toHaveBeenCalledWith('sequence', false, 'live_render', 'none');
  });

  it('D: renderToSvg output fails sanitization → React fallback (live_render)', async () => {
    z.renderToSvg.mockReturnValueOnce({ svg: '<div>not an svg</div>' });
    wrapper = mountSeq(true);
    await flushPromises();
    expect(z.renderToSvg).toHaveBeenCalled();
    expect(z.ZenUmlCtor).toHaveBeenCalledTimes(1); // fell back to React
    expect(trackMock.fn).toHaveBeenCalledWith('sequence', true, 'live_render', 'none');
  });
});

describe('Sequence.vue — Lever D cached-SVG path (save-time pre-render)', () => {
  let wrapper: VueWrapper | undefined;
  const CACHED = '<svg id="cached" xmlns="http://www.w3.org/2000/svg"><text>CACHED</text></svg>';

  beforeEach(() => {
    vi.clearAllMocks();
    renderPerf._resetForTesting();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it('E: display + default theme + cached sequenceSvg → inject it, NO bundle (no renderToSvg, no React), cached_svg/cc_body', async () => {
    wrapper = mountSeq(true, { ...SEQ_DOC, sequenceSvg: CACHED });
    await flushPromises();
    // The whole point of Lever D: neither the static export NOR the React mount runs —
    // the @zenuml/core bundle is never touched on a cache hit (resource_load eliminated).
    expect(z.renderToSvg).not.toHaveBeenCalled();
    expect(z.ZenUmlCtor).not.toHaveBeenCalled();
    expect(wrapper.html()).toContain('CACHED');
    expect(trackMock.fn).toHaveBeenCalledWith('sequence', true, 'cached_svg', 'cc_body');
  });

  it('F: cached SVG fails sanitization → falls back to at-view sync_svg', async () => {
    wrapper = mountSeq(true, { ...SEQ_DOC, sequenceSvg: '<div>tampered, not an svg</div>' });
    await flushPromises();
    expect(z.renderToSvg).toHaveBeenCalledWith('A.method()'); // sync_svg fallback ran
    expect(z.ZenUmlCtor).not.toHaveBeenCalled();
    expect(trackMock.fn).toHaveBeenCalledWith('sequence', true, 'sync_svg', 'none');
  });

  it('G: editor (not display mode) ignores the cache → interactive React render', async () => {
    wrapper = mountSeq(false, { ...SEQ_DOC, sequenceSvg: CACHED });
    await flushPromises();
    expect(z.ZenUmlCtor).toHaveBeenCalledTimes(1);
    expect(z.renderToSvg).not.toHaveBeenCalled();
    expect(trackMock.fn).toHaveBeenCalledWith('sequence', false, 'live_render', 'none');
  });

  it('H: non-default theme ignores the cache (cached SVG is default-theme only)', async () => {
    localStorage.setItem(`${location.hostname}-zenuml-conf-theme`, 'theme-dark');
    wrapper = mountSeq(true, { ...SEQ_DOC, sequenceSvg: CACHED });
    await flushPromises();
    expect(z.ZenUmlCtor).toHaveBeenCalledTimes(1);
    expect(z.renderToSvg).not.toHaveBeenCalled();
    expect(trackMock.fn).toHaveBeenCalledWith('sequence', true, 'live_render', 'none');
  });

  it('I: back-catalog localStorage hit → inject, skip renderToSvg AND the bundle (cache_source localstorage)', async () => {
    putCachedSvg('A.method()', '<svg id="ls" xmlns="http://www.w3.org/2000/svg"><text>LS_SEQ</text></svg>');
    wrapper = mountSeq(true); // display + default theme, no cc_body sequenceSvg
    await flushPromises();
    expect(z.renderToSvg).not.toHaveBeenCalled(); // no at-view render
    expect(z.ZenUmlCtor).not.toHaveBeenCalled(); // no bundle / React mount
    expect(wrapper.html()).toContain('LS_SEQ');
    expect(trackMock.fn).toHaveBeenCalledWith('sequence', true, 'cached_svg', 'localstorage');
  });

  it('J: a sync_svg render warms the localStorage cache for the next view', async () => {
    wrapper = mountSeq(true); // no cache → sync_svg path renders + warms
    await flushPromises();
    expect(z.renderToSvg).toHaveBeenCalled();
    expect(getCachedSvg('A.method()')).toContain('SYNC'); // warmed for next view
    expect(trackEventMock.fn).toHaveBeenCalledWith(
      'render_cache_write',
      expect.objectContaining({ macro_type: 'sequence', render_cache_outcome: 'persisted' }),
    );
  });
});
