import { afterEach, describe, expect, it, vi } from 'vitest';
import GenericViewer from './GenericViewer.vue';
import { DiagramType } from '@/model/Diagram/Diagram';

const attach = vi.hoisted(() => vi.fn());
vi.mock('../../../tools/mermaid-highlights/src/mermaid-highlights.mjs', async importOriginal => ({
  ...await importOriginal<any>(), attachPreparedSvgHighlights: attach,
}));
vi.mock('@/utils/mermaid/renderMermaid', async importOriginal => ({
  ...await importOriginal<any>(), parseMermaidFlowchart: vi.fn(() => Promise.resolve({})),
}));

function fixture(isFullscreenMode: boolean) {
  const root = document.createElement('div');
  root.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"><g data-node="A"><rect /></g></svg>';
  document.body.append(root);
  attach.mockReturnValue({ destroy: vi.fn() });
  const magic = {};
  const vm: any = {
    magicActive: true, relationshipHighlights: true, showExportModal: false, isFullscreenMode,
    diagramType: DiagramType.Mermaid, magicGeneration: 1, diagram: { mermaidCode: 'flowchart LR\n A --> B', magic },
    $refs: { magicViewport: { $el: root } }, $emit: vi.fn(),
  };
  vm.clearMagicHighlights = (GenericViewer as any).methods.clearMagicHighlights.bind(vm);
  vm.installMagicHighlights = (GenericViewer as any).methods.installMagicHighlights.bind(vm);
  return vm;
}

afterEach(() => { vi.clearAllMocks(); document.body.replaceChildren(); });

describe('GenericViewer refined layout relationship highlights', () => {
  // The staged header shows the refined layout inline, so it is highlighted
  // there just like the original Mermaid canvas, not only in Fullscreen.
  it.each([['inline', false], ['Fullscreen', true]])('installs on the %s refined layout', async (_surface, fullscreen) => {
    const vm = fixture(fullscreen);
    await vm.installMagicHighlights();
    expect(attach).toHaveBeenCalledTimes(1);
    expect(vm.$emit).toHaveBeenLastCalledWith('magic-highlight-ready', true);
  });

  it('stays off when the viewer turned highlights off', async () => {
    const vm = fixture(false);
    vm.relationshipHighlights = false;
    await vm.installMagicHighlights();
    expect(attach).not.toHaveBeenCalled();
  });
});
