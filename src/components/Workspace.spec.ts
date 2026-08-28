import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { vi } from "vitest";
import Workspace from "@/components/Workspace.vue";
import { DiagramType } from "@/model/Diagram/Diagram";
import store from "@/model/store2/";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";

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
  });

  afterEach(() => {
    activeWrapper?.unmount();
    activeWrapper = null;
  });

  function mountWorkspace() {
    return mount(Workspace, {
      global: {
        plugins: [store],
        stubs: {
          Header: true,
          Editor: true,
          DiagramPortal: true,
          SyntaxErrorBox: true,
          AIChatPanel: true,
        },
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
});

describe("Workspace AI Chat integration", () => {
  let wrapper;

  const AIChatPanelStub = defineComponent({
    name: "AIChatPanelStub",
    props: {
      open: Boolean,
      codeVisible: Boolean,
      diagramType: String,
      currentCode: String,
      diagramlyDiagramId: String,
      syntaxRepairRequestId: Number,
    },
    emits: ["apply-code", "diagramly-diagram-bound", "toggle-code", "close"],
    template: `
      <aside data-testid="ai-chat-panel-stub">
        <span data-testid="ai-chat-code-value">{{ currentCode }}</span>
        <span data-testid="syntax-repair-request-id">{{ syntaxRepairRequestId }}</span>
        <button data-testid="apply-code" @click="$emit('apply-code', 'updated by AI')" />
        <button data-testid="bind-diagram" @click="$emit('diagramly-diagram-bound', 'diagramly-1')" />
        <button data-testid="toggle-code" @click="$emit('toggle-code')" />
        <button data-testid="close-chat" @click="$emit('close')" />
      </aside>
    `,
  });

  const SyntaxErrorBoxStub = defineComponent({
    name: "SyntaxErrorBoxStub",
    emits: ["request-ai-chat-repair"],
    template: `
      <button
        data-testid="ai-repair-stub"
        @click="$emit('request-ai-chat-repair')"
      >AI Repair</button>
    `,
  });

  function mountAIChatWorkspace() {
    return mount(Workspace, {
      global: {
        plugins: [store],
        stubs: {
          Header: true,
          Editor: { template: '<div data-testid="editor-stub" />' },
          DiagramPortal: true,
          SyntaxErrorBox: SyntaxErrorBoxStub,
          ForeignDialectHint: true,
          AIChatPanel: AIChatPanelStub,
        },
      },
    });
  }

  beforeEach(() => {
    vi.mocked(trackAnalyticsEvent).mockClear();
    store.commit("updateDiagramType", DiagramType.Mermaid);
    store.commit("updateMermaidCode", "flowchart LR\nA --> B");
    store.commit("updateMetadata", {
      keep: "existing",
      aiChat: { keepNested: "existing" },
    });
    wrapper = mountAIChatWorkspace();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("opens the panel without unmounting the editor and toggles code visibility", async () => {
    (wrapper.vm as any).toggleAIChat();
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-testid="ai-chat-panel-stub"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="ai-chat-code-value"]').text()).toContain("flowchart LR");
    expect(wrapper.get('[data-testid="editor-stub"]').exists()).toBe(true);
    expect(wrapper.get("#workspace-left").attributes("style")).toContain("display: none");

    await wrapper.get('[data-testid="toggle-code"]').trigger("click");
    expect(wrapper.get("#workspace-left").attributes("style")).not.toContain("display: none");
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "ai_chat_opened",
      expect.objectContaining({ entry_point: "ai_prompt", macro_type: "mermaid" }),
    );

    await wrapper.get('[data-testid="close-chat"]').trigger("click");
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "ai_chat_closed",
      expect.objectContaining({ macro_type: "mermaid" }),
    );
  });

  it("applies AI code through the diagram-type action and merges Diagramly metadata", async () => {
    (wrapper.vm as any).toggleAIChat();
    await wrapper.vm.$nextTick();
    await wrapper.get('[data-testid="apply-code"]').trigger("click");
    await wrapper.get('[data-testid="bind-diagram"]').trigger("click");

    expect(store.state.diagram.mermaidCode).toBe("updated by AI");
    expect(store.state.diagram.metadata).toEqual({
      keep: "existing",
      aiChat: {
        keepNested: "existing",
        diagramlyDiagramId: "diagramly-1",
      },
    });
  });

  it("opens AI Chat and starts syntax repair from the repair action", async () => {
    await wrapper.get('[data-testid="ai-repair-stub"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-testid="ai-chat-panel-stub"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="syntax-repair-request-id"]').text()).toBe("1");
    expect((wrapper.vm as any).showCodeEditor).toBe(false);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith(
      "ai_chat_opened",
      expect.objectContaining({ entry_point: "ai_repair", macro_type: "mermaid" }),
    );
  });

  it("does not open AI Chat for Graph diagrams", async () => {
    store.commit("updateDiagramType", DiagramType.Graph);
    (wrapper.vm as any).toggleAIChat();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="ai-chat-panel-stub"]').exists()).toBe(false);
  });
});
