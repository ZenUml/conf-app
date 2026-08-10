// src/model/Diagram/EditorTemplates.spec.ts
//
// TDD for the starter-template gallery data (#334). These tests exercise the
// REAL parsers already bundled as npm dependencies (@zenuml/core, mermaid) —
// not a stub — so a template that looks plausible but doesn't actually parse
// is caught here rather than discovered by a user clicking it in production.
// PlantUML's only local validator (utils/plantuml/validate.ts) calls a public
// network server, so PlantUML templates get structural checks only; their
// content was hand-verified against known-safe PlantUML constructs.

import mermaid from 'mermaid';
import { DiagramType } from './Diagram';
import { getEditorDiagramOptions } from './DiagramTypeConfig';
import {
  getTemplatesForType,
  getAllTemplates,
  type EditorTemplate,
} from './EditorTemplates';

async function zenumlParses(dsl: string): Promise<boolean> {
  const ZenUml = (await import('@zenuml/core')).default;
  const zenuml = new ZenUml(document.createElement('div'));
  const result = await zenuml.parse(dsl);
  return !!result.pass;
}

describe('EditorTemplates — data integrity', () => {
  it('every editor-reachable diagram type (getEditorDiagramOptions) has 6-10 templates', () => {
    const options = getEditorDiagramOptions();
    expect(options.length).toBeGreaterThan(0);
    for (const { value } of options) {
      const templates = getTemplatesForType(value);
      expect(templates.length).toBeGreaterThanOrEqual(6);
      expect(templates.length).toBeLessThanOrEqual(10);
    }
  });

  it('mermaid has the richest set (strictly more templates than sequence and plantuml)', () => {
    const mermaidCount = getTemplatesForType(DiagramType.Mermaid).length;
    const sequenceCount = getTemplatesForType(DiagramType.Sequence).length;
    const plantUmlCount = getTemplatesForType(DiagramType.PlantUml).length;
    expect(mermaidCount).toBeGreaterThan(sequenceCount);
    expect(mermaidCount).toBeGreaterThan(plantUmlCount);
  });

  it('every template has a non-empty id, name, description, and dsl body', () => {
    for (const t of getAllTemplates()) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.dsl.trim().length).toBeGreaterThan(10);
    }
  });

  it('template ids are unique across the whole catalog (template_id is a flat Mixpanel dimension)', () => {
    const ids = getAllTemplates().map((t: EditorTemplate) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ids are prefixed by diagram family for at-a-glance readability (seq- / mmd- / puml-)', () => {
    for (const t of getTemplatesForType(DiagramType.Sequence)) expect(t.id).toMatch(/^seq-/);
    for (const t of getTemplatesForType(DiagramType.Mermaid)) expect(t.id).toMatch(/^mmd-/);
    for (const t of getTemplatesForType(DiagramType.PlantUml)) expect(t.id).toMatch(/^puml-/);
  });
});

describe('EditorTemplates — ZenUML sequence templates parse in the real parser', () => {
  const templates = getTemplatesForType(DiagramType.Sequence);

  it.each(templates.map((t) => [t.id, t.dsl] as const))(
    '%s parses successfully',
    async (_id, dsl) => {
      expect(await zenumlParses(dsl)).toBe(true);
    },
  );
});

describe('EditorTemplates — Mermaid templates parse in the real parser', () => {
  beforeAll(() => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
  });

  const templates = getTemplatesForType(DiagramType.Mermaid);

  it.each(templates.map((t) => [t.id, t.dsl] as const))(
    '%s parses successfully',
    async (_id, dsl) => {
      await expect(mermaid.parse(dsl)).resolves.toBeTruthy();
    },
  );
});

describe('EditorTemplates — PlantUML templates (structural checks only; no network validator locally)', () => {
  const templates = getTemplatesForType(DiagramType.PlantUml);

  it.each(templates.map((t) => [t.id, t.dsl] as const))(
    '%s starts with @startuml and ends with @enduml',
    (_id, dsl) => {
      const trimmed = dsl.trim();
      expect(trimmed.startsWith('@startuml')).toBe(true);
      expect(trimmed.endsWith('@enduml')).toBe(true);
    },
  );
});
