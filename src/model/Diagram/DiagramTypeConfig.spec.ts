import { DiagramType } from './Diagram';
import {
  getDiagramConfig,
  getViewerUrl,
  getCodeFromDiagram,
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
      expect(config!.wide).toBe(false);
      expect(config!.rendersInDiagramPortal).toBe(true);
    });

    it('returns config for Mermaid', () => {
      const config = getDiagramConfig(DiagramType.Mermaid);
      expect(config).toBeDefined();
      expect(config!.dataField).toBe('mermaidCode');
      expect(config!.storeUpdateAction).toBe('updateMermaidCode');
      expect(config!.wide).toBe(true);
    });

    it('returns config for Graph', () => {
      const config = getDiagramConfig(DiagramType.Graph);
      expect(config).toBeDefined();
      expect(config!.dataField).toBe('graphXml');
      expect(config!.viewerUrl).toBe('/drawio/viewer.html');
      expect(config!.rendersInDiagramPortal).toBe(false);
    });

    it('returns config for OpenApi', () => {
      const config = getDiagramConfig(DiagramType.OpenApi);
      expect(config).toBeDefined();
      expect(config!.dataField).toBe('code');
      expect(config!.viewerUrl).toBe('/swagger-ui.html');
    });

    it('returns config for PlantUml', () => {
      const config = getDiagramConfig(DiagramType.PlantUml);
      expect(config).toBeDefined();
      expect(config!.dataField).toBe('plantUmlCode');
      expect(config!.storeUpdateAction).toBe('updatePlantUmlCode');
      expect(config!.wide).toBe(true);
      expect(config!.rendersInDiagramPortal).toBe(true);
    });

    it('returns undefined for Embed', () => {
      expect(getDiagramConfig(DiagramType.Embed)).toBeUndefined();
    });

    it('returns undefined for Unknown', () => {
      expect(getDiagramConfig(DiagramType.Unknown)).toBeUndefined();
    });
  });

  describe('getViewerUrl', () => {
    it('returns /sequence-viewer.html for Sequence', () => {
      expect(getViewerUrl(DiagramType.Sequence)).toBe('/sequence-viewer.html');
    });

    it('returns /sequence-viewer.html for Mermaid', () => {
      expect(getViewerUrl(DiagramType.Mermaid)).toBe('/sequence-viewer.html');
    });

    it('returns /drawio/viewer.html for Graph', () => {
      expect(getViewerUrl(DiagramType.Graph)).toBe('/drawio/viewer.html');
    });

    it('returns /swagger-ui.html for OpenApi', () => {
      expect(getViewerUrl(DiagramType.OpenApi)).toBe('/swagger-ui.html');
    });

    it('returns fallback for unknown type', () => {
      expect(getViewerUrl(DiagramType.Unknown)).toBe('/sequence-viewer.html');
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
});
