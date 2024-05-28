const Sequence = `title Order Service (Demonstration only)
@Actor Double_Click_Me #FF0000
@Boundary OrderController
@EC2 <<BFF>> OrderService
group BusinessService {
  @Lambda PurchaseService
  @AzureFunction InvoiceService
}

@Starter(Double_Click_Me)
// \`POST /orders\`
OrderController.post(payload13) {
  // [bold, red] double click the method below
  OrderService.create(payload) {
    order = new Order(payload)
    if(order != null) {
      par {
        // [text-rose-600] see: https://tailwindcss.com/docs/text-color
        PurchaseService.createPO(order)
        // [bg-purple-100] see: https://tailwindcss.com/docs/background-color
        InvoiceService.createInvoice(order)      
      }      
    }
  }
}`;

const Mermaid = 'graph TD; A-->B;';

export default {
    Sequence,
    Mermaid
}
