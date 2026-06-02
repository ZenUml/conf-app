import { DiagramType } from "@/model/Diagram/Diagram";

export type DiagramPasteAction =
  | {
      kind: "insert";
      code: string;
      message?: string;
    }
  | {
      kind: "switch";
      targetType: DiagramType.Mermaid | DiagramType.PlantUml;
      code: string;
      message: string;
    };

const MERMAID_LANGS = new Set(["mermaid", "mmd"]);
const PLANTUML_LANGS = new Set(["plantuml", "puml", "uml"]);

function stripMarkdownFence(input: string): { language: string; code: string } | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^```([A-Za-z0-9_-]*)[^\n\r]*\r?\n([\s\S]*?)\r?\n```$/);
  if (!match) return null;
  return {
    language: match[1].toLowerCase(),
    code: match[2].replace(/\s+$/, ""),
  };
}

function looksLikeMermaid(input: string, language = ""): boolean {
  if (MERMAID_LANGS.has(language)) return true;

  const trimmed = input.trim();
  return /^(graph|flowchart)\s+(TB|TD|BT|RL|LR)\b/i.test(trimmed)
    || /^(sequenceDiagram|erDiagram|classDiagram|stateDiagram(?:-v2)?|gantt|pie|journey|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram)\b/i.test(trimmed)
    || /^C4(?:Context|Container|Component|Dynamic)\b/i.test(trimmed);
}

function looksLikePlantUml(input: string, language = ""): boolean {
  if (PLANTUML_LANGS.has(language)) return true;

  return /^\s*@startuml\b/im.test(input)
    || /^\s*@enduml\b/im.test(input)
    || /^\s*skinparam\b/im.test(input);
}

function normalizePlantUml(input: string): string {
  const code = input.trim();
  const hasStart = /^\s*@startuml\b/im.test(code);
  const hasEnd = /^\s*@enduml\b/im.test(code);

  if (hasStart && hasEnd) return code;
  if (hasStart) return `${code}\n@enduml`;
  if (hasEnd) return `@startuml\n${code}`;
  return `@startuml\n${code}\n@enduml`;
}

export function classifyDiagramPaste(
  pastedText: string,
  currentType: DiagramType,
): DiagramPasteAction | null {
  const fenced = stripMarkdownFence(pastedText);
  const candidate = fenced?.code ?? pastedText;
  const language = fenced?.language ?? "";

  if (looksLikeMermaid(candidate, language)) {
    const code = candidate.trim();
    if (currentType === DiagramType.Mermaid) {
      return fenced ? { kind: "insert", code, message: "Removed Markdown code fence." } : null;
    }
    return {
      kind: "switch",
      targetType: DiagramType.Mermaid,
      code,
      message: "Detected Mermaid syntax and switched to Mermaid.",
    };
  }

  if (looksLikePlantUml(candidate, language)) {
    const code = normalizePlantUml(candidate);
    if (currentType === DiagramType.PlantUml) {
      return code !== pastedText ? { kind: "insert", code, message: "Normalized PlantUML paste." } : null;
    }
    return {
      kind: "switch",
      targetType: DiagramType.PlantUml,
      code,
      message: "Detected PlantUML syntax and switched to PlantUML.",
    };
  }

  if (fenced && currentType !== DiagramType.Sequence) {
    return { kind: "insert", code: candidate.trim(), message: "Removed Markdown code fence." };
  }

  return null;
}
