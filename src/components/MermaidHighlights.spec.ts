import { afterEach, describe, expect, it, vi } from 'vitest';
import Mermaid from './Mermaid.vue';

const attach = vi.hoisted(() => vi.fn());
vi.mock('../../tools/mermaid-highlights/src/mermaid-highlights.mjs', async importOriginal => ({
  ...await importOriginal<any>(), attachMermaidHighlights: attach,
}));

function fixture() {
  const root = document.createElement('div');
  root.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"><g data-node="A"><rect /></g><path data-edge="ab" /></svg>';
  document.body.append(root);
  const controller = { destroy: vi.fn() };
  attach.mockReturnValue(controller);
  const vm: any = {
    relationshipHighlights: true, isDisplayMode: true, readOnly: false, captureMode: false, currentFlowchartModel: {},
    renderGeneration: 1, highlightUsedGeneration: -1, $refs: { viewport: { $el: root } }, $emit: vi.fn(),
  };
  Object.defineProperty(vm, 'highlightSurfaceAllowed', {get: () => Mermaid.computed.highlightSurfaceAllowed.call(vm)});
  vm.clearHighlights = Mermaid.methods.clearHighlights.bind(vm);
  vm.installHighlights = Mermaid.methods.installHighlights.bind(vm);
  const install = () => vm.installHighlights();
  return { vm, root, controller, install, node: root.querySelector('g')!, edge: root.querySelector('path')! };
}

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); document.body.replaceChildren(); delete window.forgeGlobal; });

describe('Mermaid opt-in highlight lifecycle', () => {
  it('reports a selected target once per diagram, including after disable/reinstall', () => {
    const {vm, node, edge, install} = fixture();
    install();
    expect(vm.$emit).toHaveBeenCalledWith('highlight-ready', true);
    node.dispatchEvent(new MouseEvent('click', {bubbles:true}));
    edge.dispatchEvent(new FocusEvent('focusin', {bubbles:true}));
    expect(vm.$emit.mock.calls.filter(([name]) => name==='highlight-used')).toEqual([['highlight-used',{kind:'node'}]]);
    vm.clearHighlights(); install();
    edge.dispatchEvent(new MouseEvent('click', {bubbles:true}));
    expect(vm.$emit.mock.calls.filter(([name]) => name==='highlight-used')).toHaveLength(1);
  });

  it('ignores background and short hovers and cancels pending usage on cleanup', () => {
    vi.useFakeTimers();
    const {vm, root, node, edge, install} = fixture();
    install();
    root.querySelector('svg')!.dispatchEvent(new MouseEvent('click', {bubbles:true}));
    node.dispatchEvent(new Event('pointerover', {bubbles:true}));
    vi.advanceTimersByTime(699);
    node.dispatchEvent(new MouseEvent('pointerout', {bubbles:true}));
    vi.advanceTimersByTime(1000);
    expect(vm.$emit.mock.calls.filter(([name]) => name==='highlight-used')).toHaveLength(0);
    edge.dispatchEvent(new Event('pointerover', {bubbles:true}));
    vm.clearHighlights();
    vi.advanceTimersByTime(1000);
    expect(vm.$emit.mock.calls.filter(([name]) => name==='highlight-used')).toHaveLength(0);
    install(); edge.dispatchEvent(new Event('pointerover', {bubbles:true}));
    vi.advanceTimersByTime(700);
    expect(vm.$emit).toHaveBeenCalledWith('highlight-used',{kind:'edge'});
  });

  it('synchronously removes interaction before capture and reinstalls after closing', () => {
    const {vm, controller, install} = fixture();
    install();
    Mermaid.methods.setCaptureMode.call(vm, true);
    expect(controller.destroy).toHaveBeenCalledTimes(1);
    expect(vm.highlightController).toBeNull();
    install();
    expect(attach).toHaveBeenCalledTimes(1);
    Mermaid.methods.setCaptureMode.call(vm, false);
    expect(attach).toHaveBeenCalledTimes(2);
    expect(vm.$emit).toHaveBeenLastCalledWith('highlight-ready',true);
  });

  it('captures a model on close when the initial render happened during capture', () => {
    const {vm} = fixture();
    vm.currentFlowchartModel=null; vm.mermaidCode='flowchart LR;A-->B'; vm.renderAndApply=vi.fn();
    Mermaid.methods.setCaptureMode.call(vm,true);
    Mermaid.methods.setCaptureMode.call(vm,false);
    expect(vm.renderAndApply).toHaveBeenCalledWith(vm.mermaidCode);
  });

  it('suppresses interaction on export-entry and read-only surfaces', () => {
    const {vm, install} = fixture();
    window.forgeGlobal = {forgeContext: {extension: {modal: {openExport: true}}}} as any;
    install(); expect(attach).not.toHaveBeenCalled();
    delete window.forgeGlobal;
    vm.readOnly=true; install(); expect(attach).not.toHaveBeenCalled();
    vm.readOnly=false; install(); expect(attach).toHaveBeenCalledTimes(1);
  });

  it('leaves the diagram intact when attachment fails and never installs in editor mode', () => {
    const {vm, root, install} = fixture();
    const before=root.innerHTML;
    attach.mockImplementationOnce(()=>{throw Error('unsupported binding')});
    install();
    expect(root.innerHTML).toBe(before);
    expect(vm.$emit).toHaveBeenCalledWith('highlight-ready',false);
    attach.mockClear(); vm.isDisplayMode=false; install();
    expect(attach).not.toHaveBeenCalled();
  });
});
