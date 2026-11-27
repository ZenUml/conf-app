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

// A review-and-approve loop: the process most teams document in Confluence,
// and it shows each flowchart basic once (start/end, step, decision, labelled
// branch, loop back), so a user can rename the boxes to describe their own.
const Mermaid = `flowchart TD
    Start([Request submitted]) --> Review[Team reviews request]
    Review --> Decision{Approved?}
    Decision -->|Yes| Work[Do the work]
    Decision -->|No| Revise[Update request]
    Revise --> Review
    Work --> Done([Done])
`;

// The Mermaid seed until 2026-11. Untouched macros created before then still
// hold it, so analytics keeps counting it as the default body.
export const LegacyMermaid = `sequenceDiagram
    Alice->>John: Hello John, how are you?
    John-->>Alice: Great!
    Alice-)John: See you later!
`;

const PlantUml = `@startuml
Alice -> Bob: Hello Bob, how are you?
Bob --> Alice: I am fine, thanks!
Alice -> Bob: See you later!
@enduml`;

export default {
    Sequence,
    Mermaid,
    PlantUml
}
