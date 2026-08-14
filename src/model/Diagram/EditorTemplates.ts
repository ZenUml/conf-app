// src/model/Diagram/EditorTemplates.ts
//
// Starter-template gallery data (#334, JTBD: author job). Curated,
// real-world templates for the three text-DSL editor types (sequence /
// mermaid / plantuml — the ones getEditorDiagramOptions() returns). AI
// text->diagram entry from the same issue is explicitly OUT OF SCOPE here
// (deferred 2026-08-03).
//
// Mermaid intentionally carries the richest set: structural analysis of
// large Lite tenants (2026-07-12) found C-tier renders are Mermaid-heavy.
//
// `id` is a flat namespace across the whole catalog (not per-type) because
// it rides on `editor_template_applied`'s `template_id` Mixpanel property —
// prefixed by family (seq- / mmd- / puml-) purely for human readability at
// the call site and in Mixpanel's raw event table.
//
// Every ZenUML and Mermaid template here is verified to parse against the
// REAL parser (see EditorTemplates.spec.ts, which imports @zenuml/core and
// mermaid directly rather than stubbing them). PlantUML's only local
// validator round-trips to a public server (utils/plantuml/validate.ts), so
// PlantUML templates are hand-verified against well-known, unambiguous
// PlantUML constructs (sequence/class/state/component) and covered by
// structural checks only.

import { DiagramType } from './Diagram';

export interface EditorTemplate {
  id: string;
  name: string;
  description: string;
  dsl: string;
}

const SEQUENCE_TEMPLATES: EditorTemplate[] = [
  {
    id: 'seq-auth-oauth-login',
    name: 'OAuth2 Login Flow',
    description: 'A web app authenticating a user against a credential store and issuing a session token.',
    dsl: `title OAuth2 Login Flow
@Actor User
@Boundary WebApp
@Control AuthService
@Database UserStore

User.login(username, password) {
  WebApp.submitCredentials(username, password) {
    user = UserStore.findByUsername(username)
    if (user == null) {
      WebApp.showError("Account not found")
    } else {
      valid = AuthService.verifyPassword(user, password)
      if (valid) {
        token = AuthService.issueToken(user)
        WebApp.redirectToDashboard(token)
      } else {
        WebApp.showError("Invalid credentials")
      }
    }
  }
}`,
  },
  {
    id: 'seq-api-call-chain',
    name: 'API Call Chain',
    description: 'A client request routed through a gateway to a service that persists to its own database.',
    dsl: `title Order API Call Chain
@Boundary Client
@Control APIGateway
@Control OrderService
@Database OrderDB

Client.createOrder(payload) {
  APIGateway.route(payload) {
    order = OrderService.handleCreate(payload) {
      newOrder = new Order(payload)
      OrderDB.save(newOrder)
      return newOrder
    }
    return order
  }
}`,
  },
  {
    id: 'seq-incident-escalation',
    name: 'Incident Escalation',
    description: 'An on-call paging flow that escalates to an incident commander when the first responder misses the SLA.',
    dsl: `title Incident Escalation
@Control Monitoring
@Actor OnCallEngineer
@Actor IncidentCommander
@Control ChatOps

Monitoring.detectAnomaly() {
  ChatOps.pageOnCall(OnCallEngineer)
  acknowledged = OnCallEngineer.acknowledge()
  if (acknowledged) {
    OnCallEngineer.investigate()
  } else {
    ChatOps.escalate(IncidentCommander)
    IncidentCommander.declareIncident()
  }
}`,
  },
  {
    id: 'seq-checkout-flow',
    name: 'E-Commerce Checkout',
    description: 'Cart, inventory reservation, and payment coordinated into a single checkout transaction.',
    dsl: `title E-Commerce Checkout
@Actor Customer
@Boundary CheckoutUI
@Control CartService
@Control PaymentService
@Control InventoryService
@Database OrderDB

Customer.checkout(cartId) {
  CheckoutUI.submit(cartId) {
    cart = CartService.getCart(cartId)
    reserved = InventoryService.reserve(cart)
    if (reserved) {
      charged = PaymentService.charge(cart)
      if (charged) {
        order = new Order(cart)
        OrderDB.save(order)
        CheckoutUI.showConfirmation(order)
      } else {
        InventoryService.release(cart)
        CheckoutUI.showError("Payment failed")
      }
    } else {
      CheckoutUI.showError("Item out of stock")
    }
  }
}`,
  },
  {
    id: 'seq-retry-circuit-breaker',
    name: 'Retry with Circuit Breaker',
    description: 'A client protecting a flaky downstream call with a circuit breaker and a bounded retry loop.',
    dsl: `title Retry with Circuit Breaker
@Control Client
@Control CircuitBreaker
@Control DownstreamService

Client.callDownstream(request) {
  open = CircuitBreaker.isOpen()
  if (open) {
    Client.useFallback()
  } else {
    for (attempt in attempts) {
      try {
        response = DownstreamService.handle(request)
        CircuitBreaker.recordSuccess()
        return response
      } catch (Exception e) {
        CircuitBreaker.recordFailure()
      }
    }
  }
}`,
  },
  {
    id: 'seq-webhook-delivery',
    name: 'Webhook Delivery',
    description: 'An event bus dispatching a webhook to a customer endpoint with retry-until-delivered semantics.',
    dsl: `title Webhook Delivery
@Control EventBus
@Control WebhookDispatcher
@Boundary CustomerEndpoint

EventBus.publish(event) {
  WebhookDispatcher.deliver(event) {
    loop("up to 3 attempts") {
      delivered = CustomerEndpoint.receive(event)
      if (delivered) {
        WebhookDispatcher.markDelivered(event)
      } else {
        WebhookDispatcher.scheduleRetry(event)
      }
    }
  }
}`,
  },
  {
    id: 'seq-async-job-queue',
    name: 'Async Job Queue Processing',
    description: 'An API enqueuing work and two parallel workers competing to pop and process jobs.',
    dsl: `title Async Job Queue Processing
@Boundary API
@Control JobQueue
@Control Worker
@Database JobStore

API.enqueueJob(payload) {
  job = new Job(payload)
  JobQueue.push(job)
  JobStore.save(job)
  return job
}

par {
  Worker.pollQueue() {
    job = JobQueue.pop()
    if (job != null) {
      Worker.process(job)
      JobStore.markComplete(job)
    }
  }
  Worker.pollQueue() {
    job = JobQueue.pop()
    if (job != null) {
      Worker.process(job)
      JobStore.markComplete(job)
    }
  }
}`,
  },
];

const MERMAID_TEMPLATES: EditorTemplate[] = [
  {
    id: 'mmd-auth-flow',
    name: 'OAuth2 Login Flow',
    description: 'A web app authenticating a user against a credential store and issuing a session token.',
    dsl: `sequenceDiagram
    actor User
    participant WebApp
    participant AuthService
    participant UserStore

    User->>WebApp: Submit credentials
    WebApp->>AuthService: authenticate(username, password)
    AuthService->>UserStore: findByUsername(username)
    UserStore-->>AuthService: user record
    alt valid credentials
        AuthService->>AuthService: issue token
        AuthService-->>WebApp: token
        WebApp-->>User: Login success
    else invalid credentials
        AuthService-->>WebApp: error
        WebApp-->>User: Login failed
    end`,
  },
  {
    id: 'mmd-api-call-chain',
    name: 'API Call Chain',
    description: 'A client request routed through a gateway to a service that persists to its own database.',
    dsl: `sequenceDiagram
    participant Client
    participant Gateway as API Gateway
    participant OrderService as Order Service
    participant OrderDB as Order DB

    Client->>Gateway: POST /orders
    Gateway->>OrderService: createOrder(payload)
    OrderService->>OrderDB: insert order
    OrderDB-->>OrderService: order id
    OrderService-->>Gateway: 201 Created
    Gateway-->>Client: 201 Created`,
  },
  {
    id: 'mmd-incident-timeline',
    name: 'Incident Timeline',
    description: 'A minute-by-minute record of an outage from detection through postmortem.',
    dsl: `timeline
    title Incident Timeline - Checkout Outage
    T+0 min : Anomaly detected by monitoring
    T+2 min : On-call engineer paged
    T+7 min : Engineer acknowledges alert
    T+15 min : Root cause identified (bad deploy)
    T+20 min : Rollback started
    T+25 min : Rollback complete, error rate recovering
    T+40 min : Incident resolved
    T+24 hr : Postmortem scheduled`,
  },
  {
    id: 'mmd-service-architecture',
    name: 'Service Architecture',
    description: 'A gateway fronting a small set of services and their datastores.',
    dsl: `flowchart TD
    Client[Client] --> Gateway[API Gateway]
    Gateway --> OrderService[Order Service]
    Gateway --> PaymentService[Payment Service]
    OrderService --> InventoryService[Inventory Service]
    OrderService --> OrderDB[(Order DB)]
    InventoryService --> InventoryDB[(Inventory DB)]
    PaymentService --> PaymentProvider[[External Payment Provider]]`,
  },
  {
    id: 'mmd-state-machine',
    name: 'Order State Machine',
    description: 'An order lifecycle with a nested fulfillment sub-state.',
    dsl: `stateDiagram-v2
    [*] --> Pending
    Pending --> Paid: payment received
    Pending --> Cancelled: cancel requested
    Paid --> Shipped: items dispatched
    Paid --> Refunded: refund issued
    Shipped --> Delivered: delivery confirmed
    Cancelled --> [*]
    Refunded --> [*]
    Delivered --> [*]

    state Paid {
        [*] --> AwaitingFulfillment
        AwaitingFulfillment --> Fulfilled
    }`,
  },
  {
    id: 'mmd-er-diagram',
    name: 'Order Domain ER Diagram',
    description: 'Customers, orders, order items, and products with cardinalities.',
    dsl: `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ ORDER_ITEM : contains
    PRODUCT ||--o{ ORDER_ITEM : "ordered in"
    CUSTOMER {
        string id
        string email
        string name
    }
    ORDER {
        string id
        string status
        date createdAt
    }
    ORDER_ITEM {
        string sku
        int quantity
        decimal price
    }
    PRODUCT {
        string sku
        string name
        decimal price
    }`,
  },
  {
    id: 'mmd-project-gantt',
    name: 'Release Rollout Gantt',
    description: 'A design-build-ship timeline with dependent tasks across three sections.',
    dsl: `gantt
    title Release Rollout Plan
    dateFormat  YYYY-MM-DD
    section Design
    Spec review          :done,    des1, 2026-08-01, 3d
    section Build
    Implement feature     :active,  dev1, 2026-08-04, 5d
    Code review           :         dev2, after dev1, 2d
    section Ship
    Staging validation     :         val1, after dev2, 2d
    Production release     :         rel1, after val1, 1d`,
  },
  {
    id: 'mmd-class-diagram',
    name: 'Order Domain Class Diagram',
    description: 'An Order aggregate with its items, owning customer, and status enum.',
    dsl: `classDiagram
    class Order {
        +UUID id
        +OrderStatus status
        +DateTime createdAt
        +addItem(item)
        +submit()
    }
    class OrderItem {
        +String sku
        +Int quantity
        +Decimal price
    }
    class Customer {
        +UUID id
        +String email
    }
    class OrderStatus {
        <<enumeration>>
        PENDING
        PAID
        SHIPPED
        CANCELLED
    }
    Order "1" *-- "many" OrderItem : contains
    Customer "1" --> "many" Order : places
    Order --> OrderStatus`,
  },
  {
    id: 'mmd-user-onboarding-journey',
    name: 'New User Onboarding Journey',
    description: 'A first-session author journey scored by satisfaction, from signup through sharing.',
    dsl: `journey
    title New User Onboarding
    section Sign Up
      Create account: 3: User
      Verify email: 2: User
    section First Diagram
      Open editor: 4: User
      Pick a template: 5: User
      Tweak and publish: 4: User
    section Activation
      Share page with team: 5: User
      Teammate views diagram: 5: Teammate`,
  },
];

const PLANTUML_TEMPLATES: EditorTemplate[] = [
  {
    id: 'puml-auth-flow',
    name: 'OAuth2 Login Flow',
    description: 'A web app authenticating a user against a credential store and issuing a session token.',
    dsl: `@startuml
actor User
participant "Web App" as WebApp
participant "Auth Service" as AuthService
database "User Store" as UserStore

User -> WebApp : submit credentials
WebApp -> AuthService : authenticate(username, password)
AuthService -> UserStore : find user by username
UserStore --> AuthService : user record

alt valid credentials
    AuthService -> AuthService : issue token
    AuthService --> WebApp : token
    WebApp --> User : login success
else invalid credentials
    AuthService --> WebApp : error
    WebApp --> User : login failed
end
@enduml`,
  },
  {
    id: 'puml-api-call-chain',
    name: 'API Call Chain',
    description: 'A client request routed through a gateway to a service that persists to its own database.',
    dsl: `@startuml
participant Client
participant "API Gateway" as Gateway
participant "Order Service" as OrderService
database "Order DB" as OrderDB

Client -> Gateway : POST /orders
Gateway -> OrderService : createOrder(payload)
OrderService -> OrderDB : insert order
OrderDB --> OrderService : order id
OrderService --> Gateway : 201 Created
Gateway --> Client : 201 Created
@enduml`,
  },
  {
    id: 'puml-incident-timeline',
    name: 'Incident Escalation',
    description: 'An on-call paging flow that escalates to an incident commander when the first responder misses the SLA.',
    dsl: `@startuml
participant Monitoring
actor "On-call Engineer" as OnCall
actor "Incident Commander" as IC
participant ChatOps

Monitoring -> Monitoring : detect anomaly
Monitoring -> ChatOps : page on-call
ChatOps -> OnCall : alert

alt acknowledged within SLA
    OnCall -> Monitoring : acknowledge
    OnCall -> OnCall : investigate
else no response
    ChatOps -> IC : escalate
    IC -> IC : declare incident
    IC -> ChatOps : open incident channel
end
@enduml`,
  },
  {
    id: 'puml-class-diagram',
    name: 'Order Domain Class Diagram',
    description: 'An Order aggregate with its items, owning customer, and status enum.',
    dsl: `@startuml
class Order {
  +id: UUID
  +status: OrderStatus
  +createdAt: DateTime
  +addItem(item: OrderItem)
  +submit()
}

class OrderItem {
  +sku: String
  +quantity: Int
  +price: Decimal
}

class Customer {
  +id: UUID
  +email: String
}

enum OrderStatus {
  PENDING
  PAID
  SHIPPED
  CANCELLED
}

Order "1" *-- "many" OrderItem : contains
Customer "1" --> "many" Order : places
Order --> OrderStatus
@enduml`,
  },
  {
    id: 'puml-state-machine',
    name: 'Order State Machine',
    description: 'An order lifecycle with a nested fulfillment sub-state.',
    dsl: `@startuml
[*] --> Pending

Pending --> Paid : payment received
Pending --> Cancelled : cancel requested
Paid --> Shipped : items dispatched
Paid --> Refunded : refund issued
Shipped --> Delivered : delivery confirmed
Cancelled --> [*]
Refunded --> [*]
Delivered --> [*]

state Paid {
  [*] --> AwaitingFulfillment
  AwaitingFulfillment --> Fulfilled
}
@enduml`,
  },
  {
    id: 'puml-service-architecture',
    name: 'Service Architecture',
    description: 'A gateway fronting a small set of services and their datastores, grouped by layer.',
    dsl: `@startuml
package "Edge" {
  [API Gateway] as Gateway
}

package "Services" {
  [Order Service] as OrderService
  [Payment Service] as PaymentService
  [Inventory Service] as InventoryService
}

package "Data" {
  database "Order DB" as OrderDB
  database "Inventory DB" as InventoryDB
}

[Client] --> Gateway
Gateway --> OrderService
Gateway --> PaymentService
OrderService --> InventoryService
OrderService --> OrderDB
InventoryService --> InventoryDB
OrderService --> PaymentService
@enduml`,
  },
  {
    id: 'puml-er-diagram',
    name: 'Order Domain ER Diagram',
    description: 'Customers and orders modeled as classes with multiplicities, PlantUML\'s safest ER notation.',
    dsl: `@startuml
class Customer {
  id : UUID
  email : String
  name : String
}

class Order {
  id : UUID
  status : String
  createdAt : DateTime
}

class OrderItem {
  sku : String
  quantity : Int
  price : Decimal
}

Customer "1" --> "many" Order : places
Order "1" *-- "many" OrderItem : contains
@enduml`,
  },
];

const TEMPLATES_BY_TYPE: Partial<Record<DiagramType, EditorTemplate[]>> = {
  [DiagramType.Sequence]: SEQUENCE_TEMPLATES,
  [DiagramType.Mermaid]: MERMAID_TEMPLATES,
  [DiagramType.PlantUml]: PLANTUML_TEMPLATES,
};

export function getTemplatesForType(type: DiagramType): EditorTemplate[] {
  return TEMPLATES_BY_TYPE[type] ?? [];
}

export function getAllTemplates(): EditorTemplate[] {
  return [...SEQUENCE_TEMPLATES, ...MERMAID_TEMPLATES, ...PLANTUML_TEMPLATES];
}
