import { describe, expect, it } from 'vitest';
import { buildSnapshot, snapshotToDiagram } from '@/model/SnapshotAttachment';
import { toMacroType, toModalDiagramType, typeLabel } from '@/utils/byline/pageDiagrams';
import { isSequenceFamilyEntry } from '@/utils/macroEntryRouting';
import { createStore } from 'vuex';
import ExtendedStore from '@/model/store2/ExtendedStore';
import { DiagramType } from './Diagram';
import { getCodeFromDiagram, getDiagramData, getEditorDiagramOptions } from './DiagramTypeConfig';

describe('Markdown tab source lifecycle', () => {
  it('round-trips source backups and routes reopened documents through the shared editor', () => {
    const snapshot = buildSnapshot({ diagramType: DiagramType.Markdown, markdownCode: '# Saved\n\n```mermaid\nflowchart TD\nA-->B\n```', title: 'Doc' }, '123');
    expect(snapshot).toBeDefined();
    const restored = snapshotToDiagram(snapshot!);
    expect(getDiagramData(restored)).toBe(snapshot!.dsl);
    expect(toMacroType(restored.diagramType)).toBe('markdown');
    expect(typeLabel(restored.diagramType)).toBe('Markdown');
    expect(isSequenceFamilyEntry(undefined, toModalDiagramType(restored.diagramType))).toBe(true);
    expect(isSequenceFamilyEntry(undefined, 'markdown')).toBe(true);
  });
  it('seeds once from Mermaid and preserves independent buffers, including intentionally empty Markdown', () => {
    const store = createStore({ ...ExtendedStore, state: { diagram: { diagramType: DiagramType.Mermaid, mermaidCode: 'flowchart TD\nA-->B' } } as any });
    store.commit('updateDiagramType', 'markdown');
    expect(getCodeFromDiagram(store.state.diagram, 'markdown' as DiagramType)).toBe('```mermaid\nflowchart TD\nA-->B\n```\n');
    store.commit('updateMarkdownCode', '');
    store.commit('updateDiagramType', DiagramType.Mermaid);
    expect(store.state.diagram.mermaidCode).toBe('flowchart TD\nA-->B');
    store.commit('updateDiagramType', 'markdown');
    expect(store.state.diagram.markdownCode).toBe('');
  });
  it('offers Markdown and reads the saved Markdown field even when other sources remain', () => {
    expect(getEditorDiagramOptions()).toContainEqual({ value: 'markdown', label: 'Markdown' });
    expect(getDiagramData({ diagramType: 'markdown', markdownCode: '# Saved', code: 'old', mermaidCode: 'old' })).toBe('# Saved');
  });
});
