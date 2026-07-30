import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Sequence from '@/components/Sequence.vue';
import Mermaid from '@/components/Mermaid.vue';
import PlantUml from '@/components/PlantUml.vue';
import store from '@/model/store2';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import {
  viewerRenderReporterKey,
  type ViewerRenderReporter,
} from '@/utils/viewerRenderReporter';

const renderer = vi.hoisted(() => ({
  sequenceRender: vi.fn(async () => undefined),
  mermaidRender: vi.fn(async () => ({ svg: '<svg />' })),
}));

vi.mock('@zenuml/core', () => ({
  default: class ZenUmlMock {
    static version = 'test';
    render = renderer.sequenceRender;
  },
}));
vi.mock('@/utils/mermaid/loadMermaid', () => ({
  loadMermaid: vi.fn(async () => ({ render: renderer.mermaidRender })),
}));
vi.mock('@/utils/plantuml/validate', () => ({
  validatePlantUmlSyntax: vi.fn(async () => ({ valid: true })),
}));
vi.mock('@/utils/plantuml/encode', () => ({ plantumlEncode: vi.fn(() => 'encoded') }));
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }));
vi.mock('@/model/globals', () => ({
  default: {
    apWrapper: {
      initializeContext: vi.fn(async () => undefined),
      isDisplayMode: vi.fn(() => true),
    },
  },
}));

describe('DiagramPortal renderer lifecycle completion', () => {
  const reporter: ViewerRenderReporter = {
    captureRevision: vi.fn(() => 3),
    rendered: vi.fn(),
    failed: vi.fn(),
  };
  const global = {
    plugins: [store],
    provide: { [viewerRenderReporterKey as symbol]: reporter },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reporter.captureRevision).mockReturnValue(3);
    renderer.sequenceRender.mockResolvedValue(undefined);
    renderer.mermaidRender.mockResolvedValue({ svg: '<svg />' });
    window.__macroLoadStart = 0;
  });

  it('Sequence reports after the ZenUML render promise resolves', async () => {
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Sequence,
      code: 'A->B: hi',
    };
    const pending = Promise.withResolvers<undefined>();
    renderer.sequenceRender.mockReturnValueOnce(pending.promise);
    mount(Sequence, { global });
    await flushPromises();
    expect(reporter.rendered).not.toHaveBeenCalled();

    pending.resolve(undefined);
    await flushPromises();

    expect(reporter.rendered).toHaveBeenCalledWith(3);
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('Mermaid reports after mermaid.render resolves', async () => {
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Mermaid,
      mermaidCode: 'graph TD; A-->B',
    };
    mount(Mermaid, { global });
    await flushPromises();

    expect(renderer.mermaidRender).toHaveBeenCalled();
    expect(reporter.rendered).toHaveBeenCalledWith(3);
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('PlantUML reports after the SVG response is assigned', async () => {
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.PlantUml,
      plantUmlCode: '@startuml\nA -> B\n@enduml',
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => '<svg>plantuml</svg>',
    } as Response);
    const wrapper = mount(PlantUml, { global });

    await (wrapper.vm as any).fetchSvg(store.state.diagram.plantUmlCode);

    expect((wrapper.vm as any).svg).toBe('<svg>plantuml</svg>');
    expect(reporter.rendered).toHaveBeenCalledWith(3);
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
  });
});
