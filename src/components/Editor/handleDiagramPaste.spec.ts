import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import store from '@/model/store2/';
import { DiagramType } from '@/model/Diagram/Diagram';
import Example from '@/utils/sequence/Example';
import { createDiagramPasteHandler } from './handleDiagramPaste';
import type { DiagramPasteReport } from './diagramPaste';

vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({
  trackAnalyticsEvent: vi.fn(),
}));
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

const BODY = `sequenceDiagram
  autonumber
  participant R as Robot
  participant GW as Gateway<br/>(edge)
  R->>GW: request credential
  alt ok
    GW-->>R: credential
  end`;
const FLOW = `flowchart TB
    A["ACT-01<br/>User"] --> B[Start: validate token]
    B -->|invalid| C[Return 401 Unauthorized]
    B -->|valid| D{Has cache?}`;

const report = (over: Partial<DiagramPasteReport> = {}): DiagramPasteReport => {
  const pastedText = over.pastedText ?? BODY;
  const editorType = over.editorType ?? 'sequence';
  const docBefore = over.docBefore ?? (editorType === 'sequence' ? Example.Sequence : Example.Mermaid);
  return {
    editorType,
    pastedText,
    fenceRemoved: true,
    fenceLanguage: 'mermaid',
    docBefore,
    docAfter: editorType === 'sequence' ? docBefore + '\n' + pastedText : pastedText,
    ...over,
  };
};

const setStore = (code: string, mermaidCode: string) => {
  store.commit('updateDiagramType', DiagramType.Sequence);
  store.commit('updateCode2', code);
  store.commit('updateMermaidCode', mermaidCode);
  store.commit('updatePlantUmlCode', '');
  store.commit('updateError', null);
};
const actionButton = () => document.body.querySelector('[data-testid="toast-action"]') as HTMLButtonElement | null;
const lastEvent = (name: string) =>
  vi.mocked(trackAnalyticsEvent).mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

describe('createDiagramPasteHandler', () => {
  beforeEach(() => {
    vi.mocked(trackAnalyticsEvent).mockReset();
    setStore(Example.Sequence, Example.Mermaid);
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('moves Mermaid pasted into the starter Sequence editor to the Mermaid tab', () => {
    createDiagramPasteHandler(store)(report());
    expect(store.state.diagram.diagramType).toBe(DiagramType.Mermaid);
    expect(store.state.diagram.mermaidCode).toBe(BODY);
    expect(store.state.diagram.code).toBe(Example.Sequence);
    expect(store.state.error).toBeNull();
    expect(actionButton()?.textContent).toBe('Undo');
    expect(trackAnalyticsEvent).toHaveBeenCalledWith('diagram_paste_handled', {
      feature_area: 'macro',
      surface: 'editor',
      macro_type: 'sequence',
      has_markdown_fence: true,
      fence_language: 'mermaid',
      detected_dialect: 'mermaid',
      paste_action: 'moved_to_mermaid',
      content_state: 'default',
      paste_chars: BODY.length,
    });
  });

  it('moves when both tabs are empty', () => {
    setStore('', '');
    createDiagramPasteHandler(store)(report({ docBefore: '' }));
    expect(store.state.diagram.diagramType).toBe(DiagramType.Mermaid);
    expect(lastEvent('diagram_paste_handled')[0]).toMatchObject({ paste_action: 'moved_to_mermaid', content_state: 'empty' });
  });

  it('moves unfenced Mermaid too', () => {
    createDiagramPasteHandler(store)(report({ pastedText: FLOW, fenceRemoved: false, fenceLanguage: 'none' }));
    expect(store.state.diagram.diagramType).toBe(DiagramType.Mermaid);
    expect(store.state.diagram.mermaidCode).toBe(FLOW);
    expect(lastEvent('diagram_paste_handled')[0]).toMatchObject({
      has_markdown_fence: false,
      fence_language: 'none',
      paste_action: 'moved_to_mermaid',
    });
  });

  it('undo restores the Sequence tab and stops later moves', () => {
    const handle = createDiagramPasteHandler(store);
    const r = report();
    handle(r);
    actionButton()!.click();
    expect(store.state.diagram.diagramType).toBe(DiagramType.Sequence);
    expect(store.state.diagram.code).toBe(r.docAfter);
    expect(store.state.diagram.mermaidCode).toBe(Example.Mermaid);
    expect(actionButton()).toBeNull();
    expect(lastEvent('diagram_paste_move_undone')).toEqual([
      { feature_area: 'macro', surface: 'editor', macro_type: 'sequence', detected_dialect: 'mermaid' },
    ]);

    setStore(Example.Sequence, Example.Mermaid);
    handle(report());
    expect(store.state.diagram.diagramType).toBe(DiagramType.Sequence);
    const events = lastEvent('diagram_paste_handled');
    expect(events[events.length - 1]).toMatchObject({ paste_action: 'fence_removed' });
  });

  it('does not move when the Sequence tab is authored', () => {
    setStore('A->B: hi', Example.Mermaid);
    createDiagramPasteHandler(store)(report({ docBefore: 'A->B: hi' }));
    expect(store.state.diagram.diagramType).toBe(DiagramType.Sequence);
    expect(actionButton()).toBeNull();
    expect(lastEvent('diagram_paste_handled')[0]).toMatchObject({ paste_action: 'fence_removed', content_state: 'authored' });
  });

  it('does not move unfenced Mermaid into an authored Sequence tab', () => {
    setStore('A->B: hi', Example.Mermaid);
    createDiagramPasteHandler(store)(
      report({ docBefore: 'A->B: hi', pastedText: FLOW, fenceRemoved: false, fenceLanguage: 'none' }),
    );
    expect(store.state.diagram.diagramType).toBe(DiagramType.Sequence);
    expect(lastEvent('diagram_paste_handled')[0]).toMatchObject({ paste_action: 'inserted_unchanged' });
  });

  it('does not move when the Mermaid tab holds authored text', () => {
    setStore(Example.Sequence, 'flowchart LR\n  X-->Y');
    createDiagramPasteHandler(store)(report());
    expect(store.state.diagram.diagramType).toBe(DiagramType.Sequence);
    expect(store.state.diagram.mermaidCode).toBe('flowchart LR\n  X-->Y');
  });

  it('does not move PlantUML text', () => {
    createDiagramPasteHandler(store)(
      report({ pastedText: '@startuml\nA -> B: hi\n@enduml', fenceRemoved: false, fenceLanguage: 'none' }),
    );
    expect(store.state.diagram.diagramType).toBe(DiagramType.Sequence);
    expect(lastEvent('diagram_paste_handled')[0]).toMatchObject({
      detected_dialect: 'plantuml',
      paste_action: 'inserted_unchanged',
    });
  });

  it('reports a fenced paste in the Mermaid editor without changing the type', () => {
    createDiagramPasteHandler(store)(report({ editorType: 'mermaid' }));
    expect(store.state.diagram.diagramType).toBe(DiagramType.Sequence);
    expect(actionButton()).toBeNull();
    expect(lastEvent('diagram_paste_handled')[0]).toMatchObject({
      macro_type: 'mermaid',
      paste_action: 'fence_removed',
      detected_dialect: 'mermaid',
      content_state: 'default',
    });
  });

  it('ignores a plain Mermaid paste in the Mermaid editor', () => {
    createDiagramPasteHandler(store)(report({ editorType: 'mermaid', fenceRemoved: false, fenceLanguage: 'none' }));
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
  });

  it('ignores a plain ZenUML paste in the Sequence editor', () => {
    createDiagramPasteHandler(store)(report({ pastedText: 'A->B: hi', fenceRemoved: false, fenceLanguage: 'none' }));
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
    expect(store.state.diagram.diagramType).toBe(DiagramType.Sequence);
    expect(store.state.diagram.mermaidCode).toBe(Example.Mermaid);
  });

  it('reports a fenced ZenUML paste without a detected_dialect key', () => {
    createDiagramPasteHandler(store)(report({ pastedText: 'A->B: hi', fenceLanguage: 'none' }));
    expect(store.state.diagram.diagramType).toBe(DiagramType.Sequence);
    const event = lastEvent('diagram_paste_handled')[0] as Record<string, unknown>;
    expect(event.paste_action).toBe('fence_removed');
    expect('detected_dialect' in event).toBe(false);
  });

  it('still updates the store when tracking throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(trackAnalyticsEvent).mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => createDiagramPasteHandler(store)(report())).not.toThrow();
    expect(store.state.diagram.diagramType).toBe(DiagramType.Mermaid);
    expect(store.state.diagram.mermaidCode).toBe(BODY);
    warn.mockRestore();
  });
});
