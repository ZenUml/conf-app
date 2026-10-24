import { DataSource, DiagramType, NULL_DIAGRAM } from '@/model/Diagram/Diagram';

describe('Diagram sentinel', () => {
  it('starts with empty content and unknown type/source', () => {
    expect(NULL_DIAGRAM).toMatchObject({
      id: '',
      diagramType: DiagramType.Unknown,
      source: DataSource.Unknown,
      code: '',
      title: '',
      styles: {},
      mermaidCode: '',
      plantUmlCode: '',
      graphXml: '',
    });
  });
});
