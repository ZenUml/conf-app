import { describe, it, expect } from 'vitest';
import { detectDiagramType } from './detectDiagramType';

describe('detectDiagramType', () => {
  it.each([
    ['@startuml\nAlice -> Bob: hi\n@enduml', 'plantuml'],
    ['  @startmindmap\n* root\n@endmindmap', 'plantuml'],
    ['<mxfile host="app.diagrams.net"><diagram/></mxfile>', 'graph'],
    ['<?xml version="1.0"?>\n<mxGraphModel><root/></mxGraphModel>', 'graph'],
    ['openapi: 3.0.0\ninfo:\n  title: x', 'openapi'],
    ['# my api\ninfo:\n  title: x\nswagger: "2.0"', 'openapi'],
    ['{\n  "openapi": "3.1.0",\n  "info": {}\n}', 'openapi'],
    ['flowchart TD\n  A --> B', 'mermaid'],
    ['graph LR\n  A --> B', 'mermaid'],
    ['sequenceDiagram\n  A->>B: hi', 'mermaid'],
    ['stateDiagram-v2\n  [*] --> S', 'mermaid'],
    ['%%{init: {"theme": "dark"}}%%\nclassDiagram\n  A <|-- B', 'mermaid'],
    ['---\ntitle: Flow\n---\nflowchart LR\n  A --> B', 'mermaid'],
    ['pie title Pets\n  "Dogs" : 3', 'mermaid'],
    ['A->B: hello\nB->C.method()', 'sequence'],
    ['@Actor Alice\nAlice->Bob: hi', 'sequence'],
    ['// a comment\nif (x) { A->B: y }', 'sequence'],
  ])('%j is %s', (source, expected) => {
    expect(detectDiagramType(source)).toBe(expected);
  });

  it('does not take a ZenUML participant whose name starts like a Mermaid keyword for Mermaid', () => {
    expect(detectDiagramType('graphService->Db: query')).toBe('sequence');
    expect(detectDiagramType('Pie.eat()')).toBe('sequence');
  });

  it('does not take an indented openapi key inside some other YAML for OpenAPI', () => {
    expect(detectDiagramType('A->B: x\n  openapi: 3')).toBe('sequence');
  });
});
