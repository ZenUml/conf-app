import {NULL_DIAGRAM, DiagramType, getDiagramData} from "@/model/Diagram/Diagram";

describe('Diagram', function () {
  it('has a NULL_DIAGRAM function', function () {
    expect(NULL_DIAGRAM).toBeDefined();
    const nullDiagram = NULL_DIAGRAM;
    expect(nullDiagram).toStrictEqual(NULL_DIAGRAM);
    expect(nullDiagram).toBe(NULL_DIAGRAM);
  })

  describe('getDiagramData', function () {
    // A doc converted from the default sequence template keeps every field —
    // getDiagramData must select the body matching the doc's OWN type, never
    // the leftover ZenUML `code` (regression: embed viewer passed `code` for
    // a plantuml doc, firing a doomed PlantUML-server PNG fetch).
    const convertedDoc = {
      diagramType: DiagramType.PlantUml,
      code: 'title Order Service\nOrderController.post(payload)',
      mermaidCode: 'sequenceDiagram\n  A->>B: hi',
      plantUmlCode: '@startuml\nAlice -> Bob\n@enduml',
      graphXml: '<mxGraphModel/>',
    };

    it('selects plantUmlCode for a plantuml doc, ignoring the leftover code field', function () {
      expect(getDiagramData(convertedDoc)).toBe(convertedDoc.plantUmlCode);
    });

    it('selects the body field matching each diagram type', function () {
      expect(getDiagramData({ ...convertedDoc, diagramType: DiagramType.Sequence })).toBe(convertedDoc.code);
      expect(getDiagramData({ ...convertedDoc, diagramType: DiagramType.Mermaid })).toBe(convertedDoc.mermaidCode);
      expect(getDiagramData({ ...convertedDoc, diagramType: DiagramType.Graph })).toBe(convertedDoc.graphXml);
    });

    it('returns an empty string for an unknown type or missing body', function () {
      expect(getDiagramData({ diagramType: undefined, code: 'x' })).toBe('');
      expect(getDiagramData({ diagramType: DiagramType.PlantUml })).toBe('');
    });
  });
})
