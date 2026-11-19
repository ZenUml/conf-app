import { describe, it, expect } from "vitest";
import {
  commentOutLeadingText,
  detectForeignContentInMermaid,
  toMarkdownDocument,
  detectForeignDialect,
  extractMermaidSource,
} from "@/model/Diagram/detectForeignDialect";

const BODY = `sequenceDiagram
  autonumber
  participant R as Robot
  participant GW as Gateway<br/>(edge)
  R->>GW: request credential
  alt ok
    GW-->>R: credential
  end`;
const FENCED = "```mermaid\n" + BODY + "\n```";
const FLOW = `flowchart TB
    A["ACT-01<br/>User"] --> B[Start: validate token]
    B -->|invalid| C[Return 401 Unauthorized]
    B -->|valid| D{Has cache?}`;
const FLOW_NO_HEADER = `A["ACT-01"] --> B[Inicio: validar token]
B -->|invalid| C[Retornar 401 Unauthorized]`;

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

describe("detectForeignDialect — wider openers and fenced prose", () => {
  it("accepts a trailing semicolon after the direction", () => {
    expect(detectForeignDialect(FLOW.replace("flowchart TB", "graph TD;"))).toBe("mermaid");
  });

  // Mermaid's lexer rejects a lower-case direction (see
  // mermaidPasteRealParser.spec.ts), so there is no working tab to route to.
  it("does not treat a lower-case direction as Mermaid", () => {
    expect(detectForeignDialect("graph td\n  A --> B")).toBeNull();
    expect(detectForeignDialect("flowchart lr\n  A --> B")).toBeNull();
  });

  it("accepts a bare opener only when the next line has an edge operator", () => {
    expect(detectForeignDialect(FLOW.replace("flowchart TB", "flowchart"))).toBe("mermaid");
    expect(detectForeignDialect("graph\n  A --> B")).toBe("mermaid");
    expect(detectForeignDialect("graph\nA->graph.load()")).toBeNull();
    expect(detectForeignDialect("flowchart")).toBeNull();
  });

  it("detects C4Context", () => {
    expect(detectForeignDialect("C4Context\n  title System Context")).toBe("mermaid");
  });

  it.each([
    ["C4Container"],
    ["C4Component"],
    ["C4Dynamic"],
    ["C4Deployment"],
    ["quadrantChart"],
    ["requirementDiagram"],
    ["xychart-beta"],
    ["sankey-beta"],
    ["block-beta"],
    ["architecture-beta"],
    ["packet-beta"],
    ["radar-beta"],
  ])("detects the %s opener", (opener) => {
    expect(detectForeignDialect(opener + "\n  title X")).toBe("mermaid");
  });

  it("detects a fenced block preceded by prose or a title line", () => {
    expect(detectForeignDialect("Here is the diagram:\n" + FENCED)).toBe("mermaid");
    expect(detectForeignDialect("title Order Service\n" + FENCED)).toBe("mermaid");
  });

  it("trusts a mermaid fence language even for an unknown opener", () => {
    expect(detectForeignDialect("```mermaid\nvenn-beta\n  set A\n```")).toBe("mermaid");
  });

  it("does not detect an unlabeled fence around ZenUML or a flowchart without opener", () => {
    expect(detectForeignDialect("```\nA->B: hi\n```")).toBeNull();
    expect(detectForeignDialect(FLOW_NO_HEADER)).toBeNull();
  });
});

describe("extractMermaidSource", () => {
  it("returns unfenced Mermaid source unchanged", () => {
    expect(extractMermaidSource(MERMAID_ER)).toBe(MERMAID_ER);
  });

  it("returns the body of a fenced block", () => {
    expect(extractMermaidSource(FENCED)).toBe(BODY);
    expect(extractMermaidSource("Here is the diagram:\n" + FENCED)).toBe(BODY);
  });

  it("returns null for ZenUML and empty input", () => {
    expect(extractMermaidSource("A->B.method(arg) {\n  B->C.other()\n}")).toBeNull();
    expect(extractMermaidSource(null)).toBeNull();
    expect(extractMermaidSource(undefined)).toBeNull();
    expect(extractMermaidSource("")).toBeNull();
  });
});

// AI Repair failures, 2026-10-20..11-19: 3 of 12 were Mermaid macros holding
// something Mermaid cannot read — PlantUML (`@startuml`, twice) or Markdown
// prose above the diagram (`# 10.1 Overview` then `flowchart LR`). Mermaid
// reports "No diagram type detected" and the repair keeps the language.
describe("detectForeignContentInMermaid", () => {
  it("detects PlantUML in a Mermaid macro", () => {
    expect(detectForeignContentInMermaid("@startuml\nA -> B: hi\n@enduml")).toBe("plantuml");
    expect(detectForeignContentInMermaid("@startuml create-order\ntitle T\nA -> B\n@enduml")).toBe("plantuml");
  });

  it("detects prose above a Mermaid opener", () => {
    expect(detectForeignContentInMermaid("# 10.1 Overview\n\nflowchart LR\n  A[One] --> B[Two]")).toBe("leading_text");
  });

  it("does not fire on valid Mermaid", () => {
    expect(detectForeignContentInMermaid("flowchart LR\n  A --> B")).toBeNull();
    expect(detectForeignContentInMermaid("%% note\n%%{init: {}}%%\nsequenceDiagram\n  A->>B: hi")).toBeNull();
    expect(detectForeignContentInMermaid("---\ntitle: Demo\n---\nflowchart TD\n  A --> B")).toBeNull();
    expect(detectForeignContentInMermaid("")).toBeNull();
    expect(detectForeignContentInMermaid(null)).toBeNull();
  });

  it("does not fire when no Mermaid opener follows the text", () => {
    expect(detectForeignContentInMermaid("just some notes\nmore notes")).toBeNull();
  });
});

describe("commentOutLeadingText", () => {
  it("turns the lines above the opener into %% comments and keeps the rest", () => {
    expect(commentOutLeadingText("# 10.1 Overview\n\nflowchart LR\n  A --> B")).toBe(
      "%% # 10.1 Overview\n\nflowchart LR\n  A --> B",
    );
  });

  it("leaves existing comments as they are", () => {
    expect(commentOutLeadingText("Intro\n%% keep\nflowchart LR\n  A --> B")).toBe(
      "%% Intro\n%% keep\nflowchart LR\n  A --> B",
    );
  });
});

const MD_DOC = [
  "# 1 Overview",
  "",
  "flowchart LR",
  "  A --> B",
  "",
  "# 2 Flow",
  "Some words.",
  "sequenceDiagram",
  "  A->>B: hi",
].join("\n");

describe("Markdown document with several Mermaid diagrams", () => {
  it("is detected as markdown_document", () => {
    expect(detectForeignContentInMermaid(MD_DOC)).toBe("markdown_document");
  });

  it("wraps each diagram in a mermaid fence and keeps the prose", () => {
    expect(toMarkdownDocument(MD_DOC)).toBe([
      "# 1 Overview",
      "",
      "```mermaid",
      "flowchart LR",
      "  A --> B",
      "```",
      "",
      "# 2 Flow",
      "Some words.",
      "```mermaid",
      "sequenceDiagram",
      "  A->>B: hi",
      "```",
    ].join("\n"));
  });
});
