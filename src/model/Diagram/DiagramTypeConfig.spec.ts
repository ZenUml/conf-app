import { DiagramType } from './Diagram';
import {
  getDiagramConfig,
  getCodeFromDiagram,
  getDiagramData,
  getStoreUpdateAction,
  getEditorDiagramOptions,
} from './DiagramTypeConfig';

describe('DiagramTypeConfig', () => {
  describe('getDiagramConfig', () => {
    it('returns config for Sequence', () => {
      const config = getDiagramConfig(DiagramType.Sequence);
      expect(config).toBeDefined();
      expect(config!.dataField).toBe('code');
      expect(config!.storeUpdateAction).toBe('updateCode2');
      expect(config!.rendersInDiagramPortal).toBe(true);
    });

    it('returns config for Mermaid', () => {
      const config = getDiagramConfig(DiagramType.Mermaid);
      expect(config).toBeDefined();
      expect(config!.dataField).toBe('mermaidCode');
      expect(config!.storeUpdateAction).toBe('updateMermaidCode');
    });

    it('returns config for Graph', () => {
      const config = getDiagramConfig(DiagramType.Graph);
      expect(config).toBeDefined();
      expect(config!.dataField).toBe('graphXml');
      expect(config!.rendersInDiagramPortal).toBe(false);
    });

    it('returns config for OpenApi', () => {
      const config = getDiagramConfig(DiagramType.OpenApi);
      expect(config).toBeDefined();
      expect(config!.dataField).toBe('code');
    });

    it('returns config for PlantUml', () => {
      const config = getDiagramConfig(DiagramType.PlantUml);
      expect(config).toBeDefined();
      expect(config!.dataField).toBe('plantUmlCode');
      expect(config!.storeUpdateAction).toBe('updatePlantUmlCode');
      expect(config!.rendersInDiagramPortal).toBe(true);
    });

    it('returns undefined for Embed', () => {
      expect(getDiagramConfig(DiagramType.Embed)).toBeUndefined();
    });

    it('returns undefined for Unknown', () => {
      expect(getDiagramConfig(DiagramType.Unknown)).toBeUndefined();
    });
  });

  describe('getCodeFromDiagram', () => {
    it('returns code for Sequence diagram', () => {
      const diagram = { code: 'A->B: hello', mermaidCode: '', graphXml: '' };
      expect(getCodeFromDiagram(diagram, DiagramType.Sequence)).toBe('A->B: hello');
    });

    it('returns mermaidCode for Mermaid diagram', () => {
      const diagram = { code: '', mermaidCode: 'graph TD', graphXml: '' };
      expect(getCodeFromDiagram(diagram, DiagramType.Mermaid)).toBe('graph TD');
    });

    it('returns graphXml for Graph diagram', () => {
      const diagram = { code: '', mermaidCode: '', graphXml: '<xml/>' };
      expect(getCodeFromDiagram(diagram, DiagramType.Graph)).toBe('<xml/>');
    });

    it('returns code for OpenApi diagram', () => {
      const diagram = { code: 'openapi: 3.0', mermaidCode: '', graphXml: '' };
      expect(getCodeFromDiagram(diagram, DiagramType.OpenApi)).toBe('openapi: 3.0');
    });

    it('returns plantUmlCode for PlantUml diagram', () => {
      const diagram = { plantUmlCode: '@startuml\nA->B\n@enduml' };
      expect(getCodeFromDiagram(diagram, DiagramType.PlantUml)).toBe('@startuml\nA->B\n@enduml');
    });

    it('returns empty string for unknown type', () => {
      const diagram = { code: 'test' };
      expect(getCodeFromDiagram(diagram, DiagramType.Unknown)).toBe('');
    });

    it('returns empty string when field is missing', () => {
      const diagram = {};
      expect(getCodeFromDiagram(diagram, DiagramType.Sequence)).toBe('');
    });
  });

  describe('getStoreUpdateAction', () => {
    it('returns updateCode2 for Sequence', () => {
      expect(getStoreUpdateAction(DiagramType.Sequence)).toBe('updateCode2');
    });

    it('returns updateMermaidCode for Mermaid', () => {
      expect(getStoreUpdateAction(DiagramType.Mermaid)).toBe('updateMermaidCode');
    });

    it('returns updatePlantUmlCode for PlantUml', () => {
      expect(getStoreUpdateAction(DiagramType.PlantUml)).toBe('updatePlantUmlCode');
    });

    it('returns fallback for unknown type', () => {
      expect(getStoreUpdateAction(DiagramType.Unknown)).toBe('updateCode2');
    });
  });

  describe('getEditorDiagramOptions', () => {
    it('returns Sequence, Mermaid, and PlantUML options', () => {
      const options = getEditorDiagramOptions();
      expect(options).toHaveLength(3);
      expect(options[0]).toEqual({ value: DiagramType.Sequence, label: 'Sequence' });
      expect(options[1]).toEqual({ value: DiagramType.Mermaid, label: 'Mermaid' });
      expect(options[2]).toEqual({ value: DiagramType.PlantUml, label: 'PlantUML' });
    });
  });

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
});
