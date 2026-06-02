import { describe, expect, it } from "vitest";
import { DiagramType } from "@/model/Diagram/Diagram";
import { classifyDiagramPaste } from "./pasteDetection";

describe("classifyDiagramPaste", () => {
  it("switches Sequence to Mermaid and strips a fenced Mermaid paste", () => {
    const action = classifyDiagramPaste(
      "```mermaid\ngraph LR\n  A --> B\n```",
      DiagramType.Sequence,
    );

    expect(action).toEqual({
      kind: "switch",
      targetType: DiagramType.Mermaid,
      code: "graph LR\n  A --> B",
      message: "Detected Mermaid syntax and switched to Mermaid.",
    });
  });

  it("detects Mermaid even when AI output labels the fence as text", () => {
    const action = classifyDiagramPaste(
      "```text\nerDiagram\n  USER ||--o{ ORDER : places\n```",
      DiagramType.Sequence,
    );

    expect(action).toMatchObject({
      kind: "switch",
      targetType: DiagramType.Mermaid,
      code: "erDiagram\n  USER ||--o{ ORDER : places",
    });
  });

  it("switches Sequence to PlantUML and wraps skinparam-only snippets", () => {
    const action = classifyDiagramPaste(
      "skinparam backgroundColor #FFFDE7\nAlice -> Bob: hello",
      DiagramType.Sequence,
    );

    expect(action).toEqual({
      kind: "switch",
      targetType: DiagramType.PlantUml,
      code: "@startuml\nskinparam backgroundColor #FFFDE7\nAlice -> Bob: hello\n@enduml",
      message: "Detected PlantUML syntax and switched to PlantUML.",
    });
  });

  it("strips Mermaid fences when already editing a Mermaid diagram", () => {
    const action = classifyDiagramPaste(
      "```mermaid\nsequenceDiagram\n  Alice->>Bob: hello\n```",
      DiagramType.Mermaid,
    );

    expect(action).toEqual({
      kind: "insert",
      code: "sequenceDiagram\n  Alice->>Bob: hello",
      message: "Removed Markdown code fence.",
    });
  });

  it("leaves normal Sequence syntax alone", () => {
    expect(classifyDiagramPaste("Alice->Bob: hello", DiagramType.Sequence)).toBeNull();
  });
});
