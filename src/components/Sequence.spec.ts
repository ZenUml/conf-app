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
