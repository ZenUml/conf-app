import { describe, expect, it } from 'vitest';
import { DataSource, DiagramType } from '@/model/Diagram/Diagram';
import { getCodeFromDiagram } from '@/model/Diagram/DiagramTypeConfig';
import OpenApiExample from '@/model/OpenApi/OpenApiExample';
import {
  buildOpenApiSaveDiagram,
  buildOpenApiAiTitleContent,
  captureOpenApiEditorBaseline,
  createOpenApiEditorState,
  extractOpenApiTitle,
  getOpenApiTitleField,
  hasOpenApiEditorChanges,
} from './OpenApiEditorState';

describe('buildOpenApiAiTitleContent', () => {
  it('removes info.title while preserving the API structure', () => {
    const content = buildOpenApiAiTitleContent(
      'openapi: 3.0.0\ninfo:\n  title: Inventory API\n  description: Stock service\npaths:\n  /items: {}',
    );

    expect(content).not.toContain('Inventory API');
    expect(content).toContain('description: Stock service');
    expect(content).toContain('/items');
  });

  it('produces the same dedup content when only info.title changes', () => {
    const untitled = 'openapi: 3.0.0\ninfo:\n  title: ""\npaths:\n  /items: {}';
    const generated = 'openapi: 3.0.0\ninfo:\n  title: Inventory API\npaths:\n  /items: {}';

    expect(buildOpenApiAiTitleContent(generated)).toBe(buildOpenApiAiTitleContent(untitled));
  });

  it('keeps invalid in-progress source available as a best-effort prompt', () => {
    const invalid = 'openapi: 3.0.0\ninfo: [';
    expect(buildOpenApiAiTitleContent(invalid)).toBe(invalid);
  });
});

describe('createOpenApiEditorState', () => {
  it('makes the visible example available to OpenAPI consumers for a new macro', () => {
    const state = createOpenApiEditorState();

    expect(state.diagramType).toBe(DiagramType.OpenApi);
    expect(state.code).toBe(OpenApiExample);
    expect(getCodeFromDiagram(state, state.diagramType)).toBe(OpenApiExample);
  });

  it('preserves a loaded document while normalizing it as OpenAPI', () => {
    const state = createOpenApiEditorState({
      id: '123',
      title: 'Orders API',
      diagramType: DiagramType.Unknown,
      code: 'openapi: 3.0.0\ninfo:',
    });

    expect(state).toMatchObject({
      id: '123',
      title: 'Orders API',
      diagramType: DiagramType.OpenApi,
      code: 'openapi: 3.0.0\ninfo:',
    });
  });
});

describe('OpenAPI editor dirty state', () => {
  it('treats the untouched new example as clean after Header initializes its title', () => {
    const diagram = createOpenApiEditorState();
    const baseline = captureOpenApiEditorBaseline(diagram);
    diagram.title = 'Sample API';

    expect(baseline).toEqual({ code: OpenApiExample, title: 'Sample API' });
    expect(hasOpenApiEditorChanges(baseline, OpenApiExample, diagram)).toBe(false);
  });

  it('detects source edits after the same Vuex diagram object is mutated, then clears on revert', () => {
    const original = 'openapi: 3.0.0\ninfo:\n  title: Orders API';
    const diagram = createOpenApiEditorState({
      id: '123', diagramType: DiagramType.OpenApi, title: 'Orders API', code: original,
    });
    const baseline = captureOpenApiEditorBaseline(diagram);
    const changed = `${original}\npaths: {}`;

    diagram.code = changed;
    expect(hasOpenApiEditorChanges(baseline, changed, diagram)).toBe(true);

    diagram.code = original;
    expect(hasOpenApiEditorChanges(baseline, original, diagram)).toBe(false);
  });

  it('detects title-only edits even with invalid source, then clears on revert', () => {
    const invalid = 'openapi: 3.0.0\ninfo: [';
    const diagram = createOpenApiEditorState({
      id: '123', diagramType: DiagramType.OpenApi, title: 'Orders API', code: invalid,
    });
    const baseline = captureOpenApiEditorBaseline(diagram);

    expect(hasOpenApiEditorChanges(baseline, invalid, diagram)).toBe(false);
    diagram.title = 'Renamed API';
    expect(hasOpenApiEditorChanges(baseline, invalid, diagram)).toBe(true);
    diagram.title = 'Orders API';
    expect(hasOpenApiEditorChanges(baseline, invalid, diagram)).toBe(false);
  });

  it('uses the spec title when persisted title differs, preserving empty and whitespace values', () => {
    for (const title of ['Specification API', '', '  Spaced API  ']) {
      const source = `openapi: 3.0.0\ninfo:\n  title: ${JSON.stringify(title)}`;
      const diagram = createOpenApiEditorState({
        id: '123', diagramType: DiagramType.OpenApi, title: 'Stale persisted title', code: source,
      });
      const baseline = captureOpenApiEditorBaseline(diagram);

      diagram.title = title; // Header's initial info.title synchronization.
      expect(baseline.title).toBe(title);
      expect(hasOpenApiEditorChanges(baseline, source, diagram)).toBe(false);

      diagram.title = `${title} changed`;
      expect(hasOpenApiEditorChanges(baseline, source, diagram)).toBe(true);
      diagram.title = title;
      expect(hasOpenApiEditorChanges(baseline, source, diagram)).toBe(false);
    }
  });

  it('keeps the loaded title when source has no string info.title', () => {
    for (const source of ['openapi: 3.0.0\ninfo: {}', 'openapi: 3.0.0\ninfo: [']) {
      const diagram = createOpenApiEditorState({
        id: '123', diagramType: DiagramType.OpenApi, title: 'Stored API', code: source,
      });
      const baseline = captureOpenApiEditorBaseline(diagram);

      expect(baseline.title).toBe('Stored API');
      expect(hasOpenApiEditorChanges(baseline, source, diagram)).toBe(false);
    }
  });
});

describe('buildOpenApiSaveDiagram', () => {
  it('preserves the title entered while creating a new OpenAPI document', () => {
    const editorState = createOpenApiEditorState();
    editorState.title = 'Orders API';

    const diagram = buildOpenApiSaveDiagram({
      existing: editorState,
      spec: 'openapi: 3.0.0\ninfo:\n  title: Orders API',
    });

    expect(diagram).toMatchObject({
      title: 'Orders API',
      diagramType: DiagramType.OpenApi,
      source: DataSource.CustomContent,
    });
  });

  it('falls back to info.title when no initialized editor state is available', () => {
    const spec = 'openapi: 3.0.0\ninfo:\n  title: Billing API';

    expect(extractOpenApiTitle(spec)).toBe('Billing API');
    expect(buildOpenApiSaveDiagram({ spec }).title).toBe('Billing API');
  });

  it('preserves dashboard in-place save behavior', () => {
    const diagram = buildOpenApiSaveDiagram({
      existing: {
        id: '123',
        isCopy: true,
        diagramType: DiagramType.OpenApi,
      },
      spec: 'openapi: 3.0.0\ninfo:\n  title: Orders API',
      pinToId: '123',
    });

    expect(diagram.id).toBe('123');
    expect(diagram.isCopy).toBe(false);
  });
});

describe('getOpenApiTitleField', () => {
  it('signals a missing title without replacing the current editor title', () => {
    expect(getOpenApiTitleField({ info: {} })).toBeUndefined();
    expect(getOpenApiTitleField({ paths: {} })).toBeUndefined();
  });

  it('keeps an explicit empty string distinguishable from a missing title', () => {
    expect(getOpenApiTitleField({ info: { title: '' } })).toBe('');
  });
});
