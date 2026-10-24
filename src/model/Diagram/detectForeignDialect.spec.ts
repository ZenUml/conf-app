import { describe, it, expect } from "vitest";
import { detectForeignDialect } from "@/model/Diagram/detectForeignDialect";

const ISSUE_373_REPRO = `@startuml
autonumber
actor Customer
participant "Global API" as API
participant "Shipment Service" as SS

Customer -> API: POST /shipments (Payload)
activate API
API -> SS: Validate & Process
activate SS
SS --> API: Created
deactivate SS
API --> Customer: 201 Created
deactivate API
@enduml`;

describe("detectForeignDialect", () => {
  it("detects the issue #373 reproduction source as plantuml", () => {
    expect(detectForeignDialect(ISSUE_373_REPRO)).toBe("plantuml");
  });

  it("detects @startuml with a trailing diagram name", () => {
    expect(detectForeignDialect("@startuml MyDiagram\nA -> B: hi\n@enduml")).toBe("plantuml");
  });

  it("detects @startuml when indented", () => {
    expect(detectForeignDialect("  @startuml\nA -> B: hi")).toBe("plantuml");
  });

  it("returns null for valid ZenUML sequence source", () => {
    const zenuml = `A->B.method(arg) {
  B->C.other()
}`;
    expect(detectForeignDialect(zenuml)).toBeNull();
  });

  it("returns null for a plain arrow message mentioning 'uml' words", () => {
    expect(detectForeignDialect("A->B: please activate the participant flow")).toBeNull();
  });

  it("returns null for empty/undefined/null code", () => {
    expect(detectForeignDialect("")).toBeNull();
    expect(detectForeignDialect(undefined)).toBeNull();
    expect(detectForeignDialect(null)).toBeNull();
  });
});

// digicaps-style repro (2026-09-08 replay): a Mermaid ER diagram pasted into a new
// Sequence macro. ZenUML's parser rejects `PK, FK` and `||--o{` with raw ANTLR
// text and the user has no route to the Mermaid tab.
const MERMAID_ER = `erDiagram
    USER {
        uuid id PK
        varchar email
    }
    ORDER {
        uuid id PK, FK
        varchar status
    }
    USER ||--o{ ORDER : places`;

describe("detectForeignDialect — mermaid", () => {
  it("detects an erDiagram pasted into the sequence editor as mermaid", () => {
    expect(detectForeignDialect(MERMAID_ER)).toBe("mermaid");
  });

  it.each([
    ["sequenceDiagram", "sequenceDiagram\n    Alice->>Bob: hi"],
    ["flowchart LR", "flowchart LR\n    A --> B"],
    ["graph TD", "graph TD\n    A --> B"],
    ["classDiagram", "classDiagram\n    Animal <|-- Duck"],
    ["stateDiagram-v2", "stateDiagram-v2\n    [*] --> Still"],
    ["gantt", "gantt\n    title A Gantt"],
    ["pie", "pie\n    \"Dogs\" : 386"],
    ["mindmap", "mindmap\n  root((mindmap))"],
    ["gitGraph", "gitGraph\n   commit"],
    ["journey", "journey\n    title My day"],
    ["timeline", "timeline\n    title History"],
  ])("detects a %s opener on the first line", (_label, source) => {
    expect(detectForeignDialect(source)).toBe("mermaid");
  });

  it("ignores leading blank lines, %% comments, an init directive and YAML front matter", () => {
    expect(detectForeignDialect("\n\n%% a comment\nerDiagram\n  A ||--o{ B : has")).toBe("mermaid");
    expect(detectForeignDialect("%%{init: {'theme':'dark'}}%%\nflowchart LR\n  A --> B")).toBe("mermaid");
    expect(detectForeignDialect("---\ntitle: Orders\n---\nsequenceDiagram\n  A->>B: x")).toBe("mermaid");
  });

  it("ignores a leading markdown fence (issue #161 shape)", () => {
    expect(detectForeignDialect("```mermaid\ngraph LR\n  A --> B\n```")).toBe("mermaid");
  });

  it("is case-sensitive and anchored to the first meaningful line", () => {
    // A ZenUML message body mentioning a keyword is not Mermaid.
    expect(detectForeignDialect("A->B: please draw the erDiagram")).toBeNull();
    // A ZenUML participant/method named like a keyword is not Mermaid.
    expect(detectForeignDialect("graph.render()")).toBeNull();
    expect(detectForeignDialect("timeline.tick()")).toBeNull();
    // `graph`/`flowchart` need a direction token: a bare participant line is ZenUML.
    expect(detectForeignDialect("graph\nA->graph.load()")).toBeNull();
    // Keyword later in the source (not first meaningful line) does not fire.
    expect(detectForeignDialect("A->B.method()\nerDiagram")).toBeNull();
  });

  it("still prefers plantuml when both fences are present", () => {
    expect(detectForeignDialect("@startuml\nsequenceDiagram\n@enduml")).toBe("plantuml");
  });
});
