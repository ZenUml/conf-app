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

// Workspace only calls Split() when forgeIndex has set window.split, which no
// test below does except the split-sizes one — so this mock is inert for the
// rest of the file.
type SplitOptions = {
  sizes: number[];
  minSize?: number[];
  snapOffset?: number[];
  onDragEnd?: (sizes: number[]) => void;
};
const splitCalls: Array<{ sizes: number[] }> = [];
const splitOptions: SplitOptions[] = [];
const splitDestroy = vi.fn();
let splitSizesFromDrag = [35, 65];
vi.mock("split.js", () => ({
  default: (_elements: string[], options: SplitOptions) => {
    splitCalls.push({ sizes: options.sizes });
    splitOptions.push(options);
    return { getSizes: () => splitSizesFromDrag, destroy: splitDestroy };
  },
}));

// Drives split.js's own drag-end callback with the sizes the drag produced,
// which is the only signal Workspace gets that the gutter was let go of.
function dragGutterTo(sizes: number[]) {
  splitSizesFromDrag = sizes;
  splitOptions.at(-1)?.onDragEnd?.(sizes);
}

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
      expect.objectContaining({
        macro_type: "mermaid",
        close_reason: "user_closed",
        session_duration_ms: expect.any(Number),
      }),
    );
  });

  it("applies AI code through the diagram-type action and merges Diagramly metadata", async () => {
    store.commit("updateError", "Syntax error from the previous code");
    (wrapper.vm as any).toggleAIChat();
    await wrapper.vm.$nextTick();
    await wrapper.get('[data-testid="apply-code"]').trigger("click");
    await wrapper.get('[data-testid="bind-diagram"]').trigger("click");

    expect(store.state.diagram.mermaidCode).toBe("updated by AI");
    expect(store.state.error).toBeNull();
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

  it("closes the overlay from the responsive workspace backdrop", async () => {
    (wrapper.vm as any).toggleAIChat();
    await wrapper.vm.$nextTick();

    await wrapper.get('[data-testid="ai-chat-backdrop"]').trigger("click");

    expect(wrapper.find('[data-testid="ai-chat-panel-stub"]').exists()).toBe(false);
    expect((wrapper.vm as any).showCodeEditor).toBe(true);
  });

  it("does not open AI Chat for Graph diagrams", async () => {
    store.commit("updateDiagramType", DiagramType.Graph);
    (wrapper.vm as any).toggleAIChat();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="ai-chat-panel-stub"]').exists()).toBe(false);
  });
});

// The left source pane is where the user types sequence / mermaid / plantuml
// source; collapsing it hands the diagram preview the whole width. The state
// and the split.js instance live in Workspace, the control lives in Header, so
// this is the only place the two halves meet.
describe("Workspace code-panel collapse", () => {
  let wrapper;

  // Mirrors the real Header: it takes no code-panel prop and emits no
  // code-panel event, because every control for that pane lives at the pane.
  const HeaderStub = defineComponent({
    name: "HeaderStub",
    props: { aiChatOpen: Boolean },
    emits: ["toggle-ai-chat"],
    template: `<header data-testid="header-stub" />`,
  });

  function mountWorkspace() {
    return mount(Workspace, {
      // initializeSplit() resolves its panes with document.querySelector, so
      // the tree has to be in the document for split.js to be wired at all.
      attachTo: document.body,
      global: {
        plugins: [store],
        stubs: {
          Header: HeaderStub,
          Editor: { template: '<div data-testid="editor-stub" />' },
          DiagramPortal: true,
          SyntaxErrorBox: true,
          ForeignDialectHint: true,
          AIChatPanel: true,
        },
      },
    });
  }

  beforeEach(() => {
    vi.mocked(trackAnalyticsEvent).mockClear();
    splitCalls.length = 0;
    splitOptions.length = 0;
    splitDestroy.mockClear();
    splitSizesFromDrag = [35, 65];
    delete (window as any).split;
    store.commit("updateDiagramType", DiagramType.Sequence);
    store.commit("updateCode2", "A->B.method()");
    wrapper = mountWorkspace();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    delete (window as any).split;
  });

  it("collapses and restores the pane, reporting the state it moved into", async () => {
    expect(wrapper.get("#workspace-left").attributes("style")).not.toContain("display: none");

    await wrapper.get('[data-testid="code-panel-collapse"]').trigger("click");

    expect(wrapper.get("#workspace-left").attributes("style")).toContain("display: none");
    expect(wrapper.get(".workspace-main").classes()).toContain("code-editor-hidden");
    // The editor itself stays mounted, so CodeMirror keeps its undo history
    // and the unsaved buffer survives a collapse.
    expect(wrapper.find('[data-testid="editor-stub"]').exists()).toBe(true);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith("editor_code_panel_toggled", {
      feature_area: "macro",
      surface: "editor",
      macro_type: DiagramType.Sequence,
      interaction_state: "hidden",
      code_panel_trigger: "panel_footer",
    });

    vi.mocked(trackAnalyticsEvent).mockClear();
    await wrapper.get('[data-testid="code-panel-restore"]').trigger("click");

    expect(wrapper.get("#workspace-left").attributes("style")).not.toContain("display: none");
    expect(wrapper.get(".workspace-main").classes()).not.toContain("code-editor-hidden");
    expect(wrapper.find('[data-testid="code-panel-restore"]').exists()).toBe(false);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith("editor_code_panel_toggled", {
      feature_area: "macro",
      surface: "editor",
      macro_type: DiagramType.Sequence,
      interaction_state: "shown",
      code_panel_trigger: "restore_widget",
    });
  });

  it("keeps every control for the pane at the pane, never in the toolbar", async () => {
    // Header is stubbed, so this asserts the wiring rather than the markup:
    // Workspace hands it no code-panel prop and listens for no code-panel
    // event. Header.spec.ts covers the toolbar itself being empty of one.
    const header = wrapper.getComponent({ name: "HeaderStub" });
    expect(header.props()).not.toHaveProperty("codePanelVisible");
    expect(wrapper.find('[data-testid="code-panel-collapse"]').exists()).toBe(true);
  });

  it("restores the width the user dragged to, not the 35/65 default", async () => {
    wrapper.unmount();
    (window as any).split = true;
    wrapper = mountWorkspace();
    await wrapper.vm.$nextTick();
    expect(splitCalls).toEqual([{ sizes: [35, 65] }]);

    // The user drags the gutter, then collapses the pane.
    dragGutterTo([20, 80]);
    await wrapper.get('[data-testid="code-panel-collapse"]').trigger("click");
    expect(splitDestroy).toHaveBeenCalled();

    await wrapper.get('[data-testid="code-panel-restore"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(splitCalls.at(-1)).toEqual({ sizes: [20, 80] });
  });

  it("collapses from the control in the panel's own bottom-left corner", async () => {
    await wrapper.get('[data-testid="code-panel-collapse"]').trigger("click");

    expect(wrapper.get("#workspace-left").attributes("style")).toContain("display: none");
    expect(trackAnalyticsEvent).toHaveBeenCalledWith("editor_code_panel_toggled", {
      feature_area: "macro",
      surface: "editor",
      macro_type: DiagramType.Sequence,
      interaction_state: "hidden",
      code_panel_trigger: "panel_footer",
    });

    // The stub in the same corner owns the way back.
    await wrapper.get('[data-testid="code-panel-restore"]').trigger("click");
    expect(wrapper.get("#workspace-left").attributes("style")).not.toContain("display: none");
  });

  it("leaves the pane's visibility to AI chat while AI chat is open", async () => {
    expect(wrapper.find('[data-testid="code-panel-collapse"]').exists()).toBe(true);

    (wrapper.vm as any).openAIChat("ai_prompt");
    (wrapper.vm as any).toggleCodeEditor();
    await wrapper.vm.$nextTick();

    // The pane is back on screen, but through AI chat's own toggle — so the
    // footer control (and its editor_code_panel_toggled event) stays out.
    expect(wrapper.get("#workspace-left").attributes("style")).not.toContain("display: none");
    expect(wrapper.find('[data-testid="code-panel-collapse"]').exists()).toBe(false);

    // ...and with the pane hidden again it is still AI chat's control, not
    // ours: no stub either.
    (wrapper.vm as any).toggleCodeEditor();
    await wrapper.vm.$nextTick();
    expect(wrapper.get("#workspace-left").attributes("style")).toContain("display: none");
    expect(wrapper.find('[data-testid="code-panel-restore"]').exists()).toBe(false);
  });

  it("lets the gutter be dragged to the far left, and closes the pane there", async () => {
    wrapper.unmount();
    (window as any).split = true;
    wrapper = mountWorkspace();
    await wrapper.vm.$nextTick();

    // A code pane that cannot reach 0 cannot be dragged shut, and without the
    // snap the user would have to land on the edge pixel-perfectly.
    expect(splitOptions.at(-1)?.minSize?.[0]).toBe(0);
    expect(splitOptions.at(-1)?.snapOffset?.[0]).toBeGreaterThan(0);
    // ...while the diagram keeps a floor: only the code pane collapses.
    expect(splitOptions.at(-1)?.minSize?.[1]).toBeGreaterThan(0);

    dragGutterTo([0, 100]);
    await wrapper.vm.$nextTick();

    expect(wrapper.get("#workspace-left").attributes("style")).toContain("display: none");
    expect(splitDestroy).toHaveBeenCalled();
    expect(trackAnalyticsEvent).toHaveBeenCalledWith("editor_code_panel_toggled", {
      feature_area: "macro",
      surface: "editor",
      macro_type: DiagramType.Sequence,
      interaction_state: "hidden",
      code_panel_trigger: "gutter_drag",
    });
    // Whatever closed the pane, the stub is what reopens it.
    expect(wrapper.find('[data-testid="code-panel-restore"]').exists()).toBe(true);
  });

  it("does not restore into the sliver a collapsing drag left behind", async () => {
    wrapper.unmount();
    (window as any).split = true;
    wrapper = mountWorkspace();
    await wrapper.vm.$nextTick();

    // A real width first, so there is something to come back to.
    dragGutterTo([25, 75]);
    // Then the user drags the gutter away and the pane snaps shut.
    dragGutterTo([0, 100]);
    await wrapper.vm.$nextTick();

    await wrapper.get('[data-testid="code-panel-restore"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(splitCalls.at(-1)).toEqual({ sizes: [25, 75] });
  });

  it("keeps an ordinary drag's width", async () => {
    wrapper.unmount();
    (window as any).split = true;
    wrapper = mountWorkspace();
    await wrapper.vm.$nextTick();

    dragGutterTo([45, 55]);
    await wrapper.vm.$nextTick();

    // No collapse: the pane is still there.
    expect(wrapper.get("#workspace-left").attributes("style")).not.toContain("display: none");
    expect(trackAnalyticsEvent).not.toHaveBeenCalledWith(
      "editor_code_panel_toggled",
      expect.anything(),
    );

    await wrapper.get('[data-testid="code-panel-collapse"]').trigger("click");
    await wrapper.get('[data-testid="code-panel-restore"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(splitCalls.at(-1)).toEqual({ sizes: [45, 55] });
  });
});
