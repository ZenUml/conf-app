// Synthetic PlantUML corpus for the renderer comparison (ADR-0010, rollout step 3).
// Written for this tool, no customer content: it covers the diagram kinds the
// production D1 scan found, weighted to the ones that change layout engine
// (Graphviz on plantuml.com, Smetana in the browser).
export default [
  // --- Graphviz layout on the server, Smetana in the browser ---------------
  { id: 'class-inheritance', kind: 'class', source: `@startuml
abstract class Shape {
  +area(): double
}
class Circle {
  -radius: double
  +area(): double
}
class Rectangle {
  -width: double
  -height: double
}
interface Drawable {
  +draw()
}
Shape <|-- Circle
Shape <|-- Rectangle
Drawable <|.. Circle
Drawable <|.. Rectangle
note right of Shape : base of every shape
@enduml` },
  { id: 'class-packages', kind: 'class', source: `@startuml
package "orders" {
  class Order {
    +id: UUID
    +total(): Money
  }
  class LineItem
  enum OrderStatus {
    NEW
    PAID
    SHIPPED
  }
}
package "billing" {
  class Invoice
  class Payment
}
Order "1" *-- "many" LineItem : contains
Order --> OrderStatus
Invoice --> Order : bills
Payment --> Invoice : settles
@enduml` },
  { id: 'class-skinparam', kind: 'class', source: `@startuml
skinparam classAttributeIconSize 0
skinparam linetype ortho
class Customer
class Account
class Address
Customer "1" -- "1..*" Account
Customer "1" -- "0..2" Address
Account ..> Address : ships to
@enduml` },
  { id: 'entity-relationship', kind: 'class', source: `@startuml
entity User {
  * id : uuid
  --
  * email : text
  name : text
}
entity Post {
  * id : uuid
  --
  * author_id : uuid
  title : text
}
entity Comment {
  * id : uuid
  --
  * post_id : uuid
  body : text
}
User ||--o{ Post
Post ||--o{ Comment
User ||--o{ Comment
@enduml` },
  { id: 'component-basic', kind: 'component', source: `@startuml
package "Frontend" {
  [Web App] as web
  [Mobile App] as mobile
}
node "Backend" {
  [API Gateway] as gw
  [Orders Service] as orders
  [Users Service] as users
}
database "Postgres" as db
web --> gw : HTTPS
mobile --> gw : HTTPS
gw --> orders
gw --> users
orders --> db
users --> db
@enduml` },
  { id: 'component-interfaces', kind: 'component', source: `@startuml
component Checkout
component Inventory
component Payments
interface "Reserve" as R
interface "Charge" as C
Checkout --( R
Inventory -- R
Checkout --( C
Payments -- C
cloud "Stripe" as stripe
Payments --> stripe
@enduml` },
  { id: 'usecase', kind: 'usecase', source: `@startuml
left to right direction
actor Customer
actor Admin
rectangle Shop {
  usecase "Browse catalog" as UC1
  usecase "Place order" as UC2
  usecase "Pay" as UC3
  usecase "Manage products" as UC4
}
Customer --> UC1
Customer --> UC2
UC2 .> UC3 : include
Admin --> UC4
@enduml` },
  { id: 'state-nested', kind: 'state', source: `@startuml
[*] --> Idle
Idle --> Processing : submit
state Processing {
  [*] --> Validating
  Validating --> Charging : valid
  Validating --> Rejected : invalid
  Charging --> [*]
}
Processing --> Done
Rejected --> Idle : retry
Done --> [*]
@enduml` },
  { id: 'deployment', kind: 'deployment', source: `@startuml
node "Load balancer" as lb
node "App server 1" as a1 {
  artifact "app.jar"
}
node "App server 2" as a2 {
  artifact "app.jar " as jar2
}
database "Primary DB" as db
queue "Events" as q
lb --> a1
lb --> a2
a1 --> db
a2 --> db
a1 --> q
a2 --> q
@enduml` },
  { id: 'object', kind: 'object', source: `@startuml
object order1 {
  id = 42
  status = PAID
}
object customer1 {
  name = "Ada"
}
object item1
object item2
customer1 --> order1
order1 --> item1
order1 --> item2
@enduml` },
  { id: 'c4-context', kind: 'c4', source: `@startuml
!include <C4/C4_Context>
Person(customer, "Customer", "Buys things")
System(shop, "Online shop", "Sells things")
System_Ext(payments, "Payment provider")
Rel(customer, shop, "Browses and buys")
Rel(shop, payments, "Charges cards")
@enduml` },
  { id: 'c4-container-url', kind: 'c4', source: `@startuml
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml
Person(user, "Customer")
System_Boundary(shop, "Online shop") {
  Container(web, "Web app", "React")
  Container(api, "API", "Go")
  ContainerDb(db, "Database", "Postgres")
}
Rel(user, web, "Uses")
Rel(web, api, "Calls", "JSON/HTTPS")
Rel(api, db, "Reads and writes")
@enduml` },
  { id: 'c4-component', kind: 'c4', source: `@startuml
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Component.puml
Container_Boundary(api, "API") {
  Component(ctrl, "Orders controller", "HTTP")
  Component(svc, "Orders service", "Domain")
  Component(repo, "Orders repository", "SQL")
}
ComponentDb(db, "Database", "Postgres")
Rel(ctrl, svc, "Uses")
Rel(svc, repo, "Uses")
Rel(repo, db, "Reads and writes")
@enduml` },
  // --- No Graphviz on either side: should match closely --------------------
  { id: 'sequence-basic', kind: 'sequence', source: `@startuml
actor User
participant "Web" as W
participant "API" as A
database "DB" as D
User -> W : click Buy
W -> A : POST /orders
activate A
A -> D : insert order
D --> A : ok
A --> W : 201 Created
deactivate A
W --> User : confirmation
@enduml` },
  { id: 'sequence-fragments', kind: 'sequence', source: `@startuml
autonumber
Alice -> Bob : request
alt success
  Bob --> Alice : 200
else failure
  Bob --> Alice : 500
  loop 3 times
    Alice -> Bob : retry
  end
end
note over Alice, Bob : idempotent call
group cleanup
  Alice -> Alice : clear cache
end
@enduml` },
  { id: 'sequence-theme', kind: 'sequence', source: `@startuml
!theme cerulean
Alice -> Bob : themed request
Bob --> Alice : themed reply
@enduml` },
  { id: 'activity-new', kind: 'activity', source: `@startuml
start
:Receive order;
if (In stock?) then (yes)
  :Reserve items;
  fork
    :Charge card;
  fork again
    :Send email;
  end fork
else (no)
  :Back-order;
endif
:Ship;
stop
@enduml` },
  { id: 'activity-swimlanes', kind: 'activity', source: `@startuml
|Customer|
start
:Place order;
|Shop|
:Check stock;
|Warehouse|
:Pack;
:Ship;
|Customer|
:Receive;
stop
@enduml` },
  { id: 'mindmap', kind: 'other', source: `@startmindmap
* Release
** Build
*** Unit tests
*** Lint
** Deploy
*** Staging
*** Production
@endmindmap` },
  { id: 'gantt', kind: 'other', source: `@startgantt
[Design] lasts 5 days
[Build] lasts 10 days
[Build] starts at [Design]'s end
[Test] lasts 4 days
[Test] starts at [Build]'s end
@endgantt` },
];
