import { mount } from "@vue/test-utils";
import { vi } from "vitest";
import ForeignDialectHint from "@/components/ForeignDialectHint.vue";
import { DiagramType } from "@/model/Diagram/Diagram";
import store from "@/model/store2/";

vi.mock("@/utils/analytics/trackAnalyticsEvent", () => ({
  trackAnalyticsEvent: vi.fn(),
}));
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";

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

describe("ForeignDialectHint (#373)", () => {
  let activeWrapper;

  beforeEach(() => {
    vi.mocked(trackAnalyticsEvent).mockClear();
    store.commit("updateDiagramType", DiagramType.Sequence);
    store.commit("updateCode2", "");
  });

  afterEach(() => {
    // Each test mounts a fresh instance against the shared singleton store;
    // an un-unmounted prior instance keeps its watch(visible) live and
    // double-fires "shown" when a later test commits new code.
    activeWrapper?.unmount();
    activeWrapper = null;
  });

  it("does NOT appear for valid ZenUML sequence source", async () => {
    store.commit("updateCode2", VALID_ZENUML);
    const wrapper = activeWrapper = mount(ForeignDialectHint, { global: { plugins: [store] } });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="foreign-dialect-hint"]').exists()).toBe(false);
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
  });

  it("appears for the issue #373 reproduction source and fires the shown event once", async () => {
    const wrapper = activeWrapper = mount(ForeignDialectHint, { global: { plugins: [store] } });
    await wrapper.vm.$nextTick();

    store.commit("updateCode2", ISSUE_373_REPRO);
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="foreign-dialect-hint"]').exists()).toBe(true);
    expect(trackAnalyticsEvent).toHaveBeenCalledTimes(1);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith("foreign_dialect_hint_shown", {
      feature_area: "macro",
      surface: "editor",
      macro_type: DiagramType.Sequence,
      detected_dialect: "plantuml",
    });

    // Re-render with the same code must not re-fire "shown".
    await wrapper.vm.$nextTick();
    expect(trackAnalyticsEvent).toHaveBeenCalledTimes(1);
  });

  it("dismiss hides the hint for that code and fires foreign_dialect_hint_dismissed", async () => {
    store.commit("updateCode2", ISSUE_373_REPRO);
    const wrapper = activeWrapper = mount(ForeignDialectHint, { global: { plugins: [store] } });
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="foreign-dialect-dismiss"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="foreign-dialect-hint"]').exists()).toBe(false);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith("foreign_dialect_hint_dismissed", expect.objectContaining({
      detected_dialect: "plantuml",
    }));
  });

  it("switching to PlantUML moves the code, changes the diagram type, and fires foreign_dialect_hint_switch_clicked", async () => {
    store.commit("updateCode2", ISSUE_373_REPRO);
    const wrapper = activeWrapper = mount(ForeignDialectHint, { global: { plugins: [store] } });
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="foreign-dialect-switch"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(store.state.diagram.diagramType).toBe(DiagramType.PlantUml);
    expect(store.state.diagram.plantUmlCode).toBe(ISSUE_373_REPRO);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith("foreign_dialect_hint_switch_clicked", expect.objectContaining({
      detected_dialect: "plantuml",
    }));
  });

  // Editor.vue's error-clearing watcher keys off the `code` computed's VALUE,
  // not off diagramType. switchToPlantUml() moves the exact same source
  // string from diagram.code into diagram.plantUmlCode, so the computed's
  // value is unchanged across the switch and the watcher never fires — the
  // stale Sequence-tab error stays in store.state.error even though the
  // PlantUML tab is now showing valid, unrelated source.
  it("clears a stale error left over from the Sequence tab when switching to PlantUML", async () => {
    store.commit("updateCode2", ISSUE_373_REPRO);
    store.commit("updateError", "Sequence syntax error: at line 1, column 0: leftover from before the paste");
    const wrapper = activeWrapper = mount(ForeignDialectHint, { global: { plugins: [store] } });
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="foreign-dialect-switch"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(store.state.error).toBeNull();
  });
});

const MERMAID_ER = `erDiagram
    USER {
        uuid id PK
    }
    ORDER {
        uuid id PK, FK
    }
    USER ||--o{ ORDER : places`;

describe("ForeignDialectHint — mermaid", () => {
  let activeWrapper;

  beforeEach(() => {
    vi.mocked(trackAnalyticsEvent).mockClear();
    store.commit("updateDiagramType", DiagramType.Sequence);
    store.commit("updateCode2", "");
    store.commit("updateMermaidCode", "");
  });

  afterEach(() => {
    activeWrapper?.unmount();
    activeWrapper = null;
  });

  it("appears for a pasted Mermaid erDiagram with Mermaid-specific copy and fires shown once", async () => {
    const wrapper = activeWrapper = mount(ForeignDialectHint, { global: { plugins: [store] } });
    await wrapper.vm.$nextTick();

    store.commit("updateCode2", MERMAID_ER);
    await wrapper.vm.$nextTick();

    const hint = wrapper.find('[data-testid="foreign-dialect-hint"]');
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain("Mermaid");
    expect(hint.text()).not.toContain("PlantUML");
    expect(wrapper.find('[data-testid="foreign-dialect-switch"]').text()).toBe("Switch to Mermaid");
    expect(trackAnalyticsEvent).toHaveBeenCalledTimes(1);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith("foreign_dialect_hint_shown", {
      feature_area: "macro",
      surface: "editor",
      macro_type: DiagramType.Sequence,
      detected_dialect: "mermaid",
    });
  });

  it("switching to Mermaid moves the code, changes the diagram type, and fires switch_clicked", async () => {
    store.commit("updateCode2", MERMAID_ER);
    const wrapper = activeWrapper = mount(ForeignDialectHint, { global: { plugins: [store] } });
    await wrapper.vm.$nextTick();

    await wrapper.find('[data-testid="foreign-dialect-switch"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(store.state.diagram.diagramType).toBe(DiagramType.Mermaid);
    expect(store.state.diagram.mermaidCode).toBe(MERMAID_ER);
    expect(store.state.diagram.plantUmlCode || "").toBe("");
    expect(trackAnalyticsEvent).toHaveBeenCalledWith("foreign_dialect_hint_switch_clicked", expect.objectContaining({
      detected_dialect: "mermaid",
    }));
  });

  it("does not appear once the diagram type is already Mermaid", async () => {
    store.commit("updateMermaidCode", MERMAID_ER);
    store.commit("updateDiagramType", DiagramType.Mermaid);
    const wrapper = activeWrapper = mount(ForeignDialectHint, { global: { plugins: [store] } });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="foreign-dialect-hint"]').exists()).toBe(false);
  });
});
