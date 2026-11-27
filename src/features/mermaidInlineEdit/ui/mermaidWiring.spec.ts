// The gate in Mermaid.vue: the feature module loads and attaches only on the
// editor preview (Workspace provides the surface key, not display mode, not
// read-only), and the controller hears every render and code change.
import { mount, enableAutoUnmount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Mermaid from '@/components/Mermaid.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { MERMAID_INLINE_EDIT_SURFACE } from './surface';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
  trackAnalyticsEventBeforeUnload: vi.fn(() => Promise.resolve()),
}));
const isDisplayModeMock = vi.hoisted(() => vi.fn(() => false));
vi.mock('@/model/globals', () => ({
  default: { apWrapper: { isDisplayMode: isDisplayModeMock, initializeContext: vi.fn(() => Promise.resolve()) } },
}));
const renderMock = vi.hoisted(() => vi.fn((_id: string, code: string) => Promise.resolve({ svg: `<svg aria-roledescription="sequence"><text>${code.length}</text></svg>` })));
vi.mock('@/utils/mermaid/loadMermaid', () => ({ loadMermaid: vi.fn(async () => ({ render: renderMock })) }));
vi.mock('svg-pan-zoom', () => ({ default: vi.fn() }));
vi.mock('hammerjs', () => ({ default: vi.fn() }));
vi.mock('@/utils/renderGate/documentLayout', () => ({ awaitSvgTextLayout: vi.fn(() => Promise.resolve(true)) }));

const controller = vi.hoisted(() => ({ onRendered: vi.fn(), onRenderFailed: vi.fn(), onCodeChanged: vi.fn(), setSuspended: vi.fn(), destroy: vi.fn() }));
const mountMock = vi.hoisted(() => vi.fn(() => controller));
vi.mock('@/features/mermaidInlineEdit', () => ({ mountMermaidInlineEdit: mountMock }));

enableAutoUnmount(afterEach);

const CODE = 'sequenceDiagram\n  A->>B: hi';

beforeEach(() => {
  vi.clearAllMocks();
  isDisplayModeMock.mockReturnValue(false);
  store.state.diagram = { ...NULL_DIAGRAM, diagramType: DiagramType.Mermaid, mermaidCode: CODE };
});

const mountWith = (provide: Record<string, unknown>, props: Record<string, unknown> = {}) =>
  mount(Mermaid, { props, attachTo: document.body, global: { plugins: [store], provide } });

describe('Mermaid.vue inline edit gate', () => {
  it('attaches on the editor preview and passes the exact store string of each render', async () => {
    const wrapper = mountWith({ [MERMAID_INLINE_EDIT_SURFACE]: true });
    await vi.waitFor(() => expect(controller.onRendered).toHaveBeenCalledWith(CODE));
    expect(mountMock).toHaveBeenCalledWith(wrapper.vm.$el, expect.anything(), expect.objectContaining({
      renderPreview: expect.any(Function), setViewKeeper: expect.any(Function), viewport: expect.any(Function),
    }));

    const next = `${CODE}\n  B->>A: back`;
    store.state.diagram.mermaidCode = next;
    await vi.waitFor(() => expect(controller.onRendered).toHaveBeenLastCalledWith(next));
    expect(controller.onCodeChanged).toHaveBeenCalledWith(next);

    wrapper.unmount();
    expect(controller.destroy).toHaveBeenCalled();
  });

  it('clears source selection if the latest store render fails', async () => {
    mountWith({ [MERMAID_INLINE_EDIT_SURFACE]: true });
    await vi.waitFor(() => expect(controller.onRendered).toHaveBeenCalledWith(CODE));
    renderMock.mockRejectedValueOnce(new Error('Parse error'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const next = `${CODE}
  invalid syntax`;
      store.state.diagram.mermaidCode = next;
      await vi.waitFor(() => expect(controller.onRenderFailed).toHaveBeenCalledWith(next));
    } finally {
      log.mockRestore();
    }
  });

  // Display mode is not case-tested here: the store's isDisplayMode getter has
  // no reactive dependency, so the singleton store caches its first value.
  it.each([
    ['without the Workspace surface key (page viewer, Fullscreen, byline, stories)', {}, false, {}],
    ['read-only', { [MERMAID_INLINE_EDIT_SURFACE]: true }, false, { readOnly: true }],
  ])('stays inert %s', async (_label, provide, displayMode, props) => {
    isDisplayModeMock.mockReturnValue(displayMode as boolean);
    mountWith(provide as Record<string, unknown>, props as Record<string, unknown>);
    await vi.waitFor(() => expect(renderMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(mountMock).not.toHaveBeenCalled();
  });

  it('suspends during export capture', async () => {
    const wrapper = mountWith({ [MERMAID_INLINE_EDIT_SURFACE]: true });
    await vi.waitFor(() => expect(mountMock).toHaveBeenCalled());
    (wrapper.vm as any).setCaptureMode(true);
    expect(controller.setSuspended).toHaveBeenCalledWith(true);
  });
});
