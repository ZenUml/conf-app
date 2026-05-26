import { DiagramType } from '@/model/Diagram/Diagram';
import Example from '@/utils/sequence/Example';
import OpenApiExample from '@/model/OpenApi/OpenApiExample';
import GraphExample from '@/model/Graph/GraphExample';

const DEFAULT_CODE: Partial<Record<DiagramType, string>> = {
  [DiagramType.Sequence]: Example.Sequence,
  [DiagramType.Mermaid]: Example.Mermaid,
  [DiagramType.PlantUml]: Example.PlantUml,
  [DiagramType.OpenApi]: OpenApiExample,
  [DiagramType.Graph]: GraphExample.graphXml,
};

function getBodyForType(diagramType: DiagramType, value: any): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  switch (diagramType) {
    case DiagramType.Sequence:
    case DiagramType.OpenApi:
      return value.code;
    case DiagramType.Mermaid:
      return value.mermaidCode;
    case DiagramType.PlantUml:
      return value.plantUmlCode;
    case DiagramType.Graph:
      return value.graphXml;
    default:
      return undefined;
  }
}

export function classifyContentState(
  diagramType: DiagramType,
  customContentValue: any,
): 'default' | 'authored' | 'empty' {
  const body = getBodyForType(diagramType, customContentValue);
  if (body == null || body.trim() === '') return 'empty';
  const defaultBody = DEFAULT_CODE[diagramType];
  if (defaultBody && body.trim() === defaultBody.trim()) return 'default';
  return 'authored';
}
