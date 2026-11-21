const Sequence = `title Order Service
OrderController
@EC2 <<BFF>> OrderService
// \`POST /orders\`
OrderController.post(payload) {
  OrderService.create(payload) {
    order = new Order()
    if(order != null) {
      PurchaseService.createPO(order)
    }
  }
}`;

const Mermaid = `sequenceDiagram
    Alice->>John: Hello John, how are you?
    John-->>Alice: Great!
    Alice-)John: See you later!
`;

// Seed for a Mermaid editor opened for a requested "Flowchart" (byline tile or a
// pasted `/new/mermaid` link). The ordinary page-editor insert keeps `Mermaid`.
const MermaidFlowchart = `flowchart TD
    Start([Request received]) --> Valid{Valid input?}
    Valid -- Yes --> Process[Process order]
    Valid -- No --> Reject[Return error]
    Process --> Done([Send confirmation])
`;

const PlantUml = `@startuml
Alice -> Bob: Hello Bob, how are you?
Bob --> Alice: I am fine, thanks!
Alice -> Bob: See you later!
@enduml`;

// Every body a new Mermaid editor can open with. An "untouched seed" check must
// accept all of them.
export const MERMAID_SEEDS: readonly string[] = [Mermaid, MermaidFlowchart];

export default {
    Sequence,
    Mermaid,
    MermaidFlowchart,
    PlantUml
}
