import { describe, expect, it } from 'vitest';
import { DataSource, DiagramType } from '@/model/Diagram/Diagram';
import { getCodeFromDiagram } from '@/model/Diagram/DiagramTypeConfig';
import OpenApiExample from '@/model/OpenApi/OpenApiExample';
import {
  buildOpenApiSaveDiagram,
  createOpenApiEditorState,
  extractOpenApiTitle,
  getOpenApiTitleField,
} from './OpenApiEditorState';

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
