import { mount } from "@vue/test-utils";
import { vi } from "vitest";
import Workspace from "@/components/Workspace.vue";
import { DiagramType, NULL_DIAGRAM } from "@/model/Diagram/Diagram";
import store from "@/model/store2/";

vi.mock("@/utils/analytics/trackAnalyticsEvent", () => ({
  trackAnalyticsEvent: vi.fn(),
}));

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

const VALID_ZENUML = `A->B.method(arg) {
  B->C.other()
}`;

// #373: ForeignDialectHint.vue and detectForeignDialect.ts are covered in
// isolation (ForeignDialectHint.spec.ts, detectForeignDialect.spec.ts), and
// Sequence.spec.ts proves the hint never touches rendering. None of those
// prove the hint is actually wired into the editor surface — if
// Workspace.vue stopped rendering <ForeignDialectHint/>, every one of those
// specs would still pass. This test mounts Workspace itself (the real seam)
// so a regression there fails here.
//
// Header/Editor/DiagramPortal/SyntaxErrorBox are stubbed: they pull in
// CodeMirror, split.js, the template gallery, and the full diagram viewer
// tree, none of which this test is about, and stubbing them keeps the test
// fast without weakening what it actually asserts — ForeignDialectHint
// itself is mounted for real, against the real store, exactly as
// ForeignDialectHint.spec.ts does.
describe("Workspace wiring (#373)", () => {
  let activeWrapper;

  beforeEach(() => {
    store.commit("updateDiagramType", DiagramType.Sequence);
    store.commit("updateCode2", "");
    store.state.diagram.architectureTokenBindingReadState = undefined;
  });

  afterEach(() => {
    activeWrapper?.unmount();
    activeWrapper = null;
  });

  function mountWorkspace() {
    return mount(Workspace, {
      global: {
        plugins: [store],
        stubs: { Header: true, Editor: true, DiagramPortal: true, SyntaxErrorBox: true },
      },
    });
  }

  it("renders the foreign-dialect hint for the issue #373 PlantUML repro", async () => {
    store.commit("updateCode2", ISSUE_373_REPRO);
    const wrapper = activeWrapper = mountWorkspace();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="foreign-dialect-hint"]').exists()).toBe(true);
  });

  it("does not render the foreign-dialect hint for valid ZenUML sequence source", async () => {
    store.commit("updateCode2", VALID_ZENUML);
    const wrapper = activeWrapper = mountWorkspace();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="foreign-dialect-hint"]').exists()).toBe(false);
  });

  it("wires the read-only Architecture Token evidence indication into the Mermaid editor", async () => {
    store.state.diagram = {
      ...NULL_DIAGRAM,
      diagramType: DiagramType.Mermaid,
      mermaidCode: 'flowchart TD\n  A --> B',
      architectureTokenBindingReadState: { kind: 'available' },
    };
    const wrapper = activeWrapper = mountWorkspace();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="architecture-token-binding-status"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Architecture Token evidence available');
    expect(wrapper.find('[data-testid="architecture-token-binding-actions"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Binding actions are not configured');
  });
});
