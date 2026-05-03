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
