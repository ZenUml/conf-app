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
});
