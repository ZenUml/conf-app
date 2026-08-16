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
