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

export default {
    Sequence,
    Mermaid
}
