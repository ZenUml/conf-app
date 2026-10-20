import { describe, it, expect } from 'vitest';
import { DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';
import Example from '@/utils/sequence/Example';
import OpenApiExample from '@/model/OpenApi/OpenApiExample';
import { EMPTY_GRAPH } from '@/utils/graph/emptyGraph';
import { compress } from '@/utils/compress';
import { classifyContentState, isLoadedEmptyBody, viewContentState } from './contentState';

describe('classifyContentState', () => {
  const cases: Array<[DiagramType, string, string]> = [
    [DiagramType.Sequence, 'code', Example.Sequence],
    [DiagramType.Mermaid, 'mermaidCode', Example.Mermaid],
    [DiagramType.PlantUml, 'plantUmlCode', Example.PlantUml],
    [DiagramType.Graph, 'graphXml', EMPTY_GRAPH],
    [DiagramType.OpenApi, 'code', OpenApiExample],
  ];

  describe.each(cases)('%s (field %s)', (type, field, example) => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['empty string', ''],
      ['whitespace only', ' \n\t  '],
    ])('is empty for %s', (_label, value) => {
      expect(classifyContentState({ [field]: value }, type)).toBe('empty');
    });

    it('is empty when the diagram itself is missing', () => {
      expect(classifyContentState(undefined, type)).toBe('empty');
    });

    it('is default for the exact bundled example', () => {
      expect(classifyContentState({ [field]: example }, type)).toBe('default');
    });

    it('is default when only line endings / trailing whitespace differ', () => {
      expect(classifyContentState({ [field]: `${example.replace(/\n/g, '\r\n')}\n\n` }, type)).toBe('default');
    });

    it('is authored once the example is edited', () => {
      expect(classifyContentState({ [field]: `${example}\n// edited` }, type)).toBe('authored');
    });

    it('is authored for unrelated content', () => {
      expect(classifyContentState({ [field]: 'A.hello()' }, type)).toBe('authored');
    });
  });

  it('reads only the field that belongs to the type', () => {
    // A mermaid macro whose stale `code` still holds the sequence sample is not "default".
    expect(
      classifyContentState({ code: Example.Sequence, mermaidCode: 'graph TD\nA-->B' }, DiagramType.Mermaid),
    ).toBe('authored');
    expect(classifyContentState({ code: Example.Sequence }, DiagramType.Mermaid)).toBe('empty');
  });

  it('does not treat the sequence sample as default for another type', () => {
    expect(classifyContentState({ code: Example.Sequence }, DiagramType.OpenApi)).toBe('authored');
  });

  it('recognises an lzutf8-compressed legacy graph body of the seed (best effort)', () => {
    expect(classifyContentState({ graphXml: compress(EMPTY_GRAPH) }, DiagramType.Graph)).toBe('default');
  });

  it('classifies types with no seed as empty or authored only', () => {
    expect(classifyContentState({ code: '' }, DiagramType.AsyncApi)).toBe('empty');
    expect(classifyContentState({ code: 'asyncapi: 2.6.0' }, DiagramType.AsyncApi)).toBe('authored');
    expect(classifyContentState({ markdownCode: '# hi' }, DiagramType.Markdown)).toBe('authored');
    expect(classifyContentState({}, DiagramType.Markdown)).toBe('empty');
  });

  it('is authored for an unknown type, even with an empty body', () => {
    expect(classifyContentState({ code: '' }, DiagramType.Unknown)).toBe('authored');
    expect(classifyContentState({ code: '' }, DiagramType.Embed)).toBe('authored');
    expect(classifyContentState({ code: 'x' }, 'nonsense' as DiagramType)).toBe('authored');
  });
});

describe('viewContentState', () => {
  it('returns the classification for a loaded diagram', () => {
    expect(viewContentState({ diagramType: DiagramType.Sequence, code: '' }, DiagramType.Sequence)).toBe('empty');
    expect(viewContentState({ diagramType: DiagramType.Sequence, code: 'A.b()' }, DiagramType.Sequence)).toBe('authored');
  });

  it('returns no verdict when the load failed (nothing was read, so nothing was wiped)', () => {
    expect(
      viewContentState({ diagramType: DiagramType.OpenApi, code: '', loadError: { httpStatus: 404 } }, DiagramType.OpenApi),
    ).toBeUndefined();
    expect(
      viewContentState({ diagramType: DiagramType.Sequence, code: '', legacyLoadBlocked: true }, DiagramType.Sequence),
    ).toBeUndefined();
    expect(viewContentState(null, DiagramType.Sequence)).toBeUndefined();
  });

  it('returns no verdict for the NULL_DIAGRAM loading shell (diagramType Unknown)', () => {
    expect(viewContentState(NULL_DIAGRAM, DiagramType.OpenApi)).toBeUndefined();
    expect(viewContentState({ code: '' }, DiagramType.OpenApi)).toBeUndefined();
  });
});

describe('isLoadedEmptyBody (#113: the empty-body branches of the viewers)', () => {
  it('is true only for a document that loaded with an empty body of the viewer\'s own type', () => {
    expect(isLoadedEmptyBody({ diagramType: DiagramType.Mermaid, mermaidCode: '' }, DiagramType.Mermaid)).toBe(true);
    expect(isLoadedEmptyBody({ diagramType: DiagramType.Mermaid, mermaidCode: ' \n' }, DiagramType.Mermaid)).toBe(true);
    expect(isLoadedEmptyBody({ diagramType: DiagramType.Graph, graphXml: undefined }, DiagramType.Graph)).toBe(true);
  });

  it('is false for a non-empty body', () => {
    expect(isLoadedEmptyBody({ diagramType: DiagramType.Mermaid, mermaidCode: 'graph TD' }, DiagramType.Mermaid)).toBe(false);
  });

  it('is false when nothing loaded (shell, load error, blocked legacy load, missing doc)', () => {
    expect(isLoadedEmptyBody(NULL_DIAGRAM, DiagramType.Mermaid)).toBe(false);
    expect(isLoadedEmptyBody(
      { diagramType: DiagramType.Mermaid, mermaidCode: '', loadError: { httpStatus: 500 } }, DiagramType.Mermaid,
    )).toBe(false);
    expect(isLoadedEmptyBody(
      { diagramType: DiagramType.Mermaid, mermaidCode: '', legacyLoadBlocked: true }, DiagramType.Mermaid,
    )).toBe(false);
    expect(isLoadedEmptyBody(undefined, DiagramType.Mermaid)).toBe(false);
  });

  it('is false when the store holds another type\'s document (its field is empty only because it is not that type)', () => {
    expect(isLoadedEmptyBody({ diagramType: DiagramType.Sequence, mermaidCode: '' }, DiagramType.Mermaid)).toBe(false);
  });
});
