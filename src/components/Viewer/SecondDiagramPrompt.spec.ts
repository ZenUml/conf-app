import { mount } from "@vue/test-utils";
import { vi } from "vitest";
import SecondDiagramPrompt from "@/components/Viewer/SecondDiagramPrompt.vue";
import type { DiagramAttribution } from "@/model/DiagramAttribution";

vi.mock("@/utils/analytics/trackAnalyticsEvent", () => ({
  trackAnalyticsEvent: vi.fn(),
}));
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";

vi.mock("@/model/globals", () => ({
  default: { apWrapper: undefined },
}));

const CREATOR = "acct-creator";
const OTHER = "acct-other";

const creatorAttribution: DiagramAttribution = {
  customContentId: "93093905",
  createdByAccountId: CREATOR,
};

function mountPrompt(props: Partial<InstanceType<typeof SecondDiagramPrompt>["$props"]> = {}) {
  return mount(SecondDiagramPrompt, {
    props: {
      attribution: creatorAttribution,
      macroType: "sequence",
      ready: true,
      currentAccountId: CREATOR,
      ...props,
    },
  });
}

describe("SecondDiagramPrompt (viewer 'second diagram' affordance)", () => {
  beforeEach(() => {
    vi.mocked(trackAnalyticsEvent).mockClear();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is hidden by default — the VITE_SECOND_DIAGRAM_PROMPT_ENABLED constant defaults OFF", async () => {
    // No vi.stubEnv here: this exercises the REAL build-time default from
    // vite.config.mjs, not a mocked override.
    const wrapper = mountPrompt();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="second-diagram-prompt"]').exists()).toBe(false);
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
  });

  it("renders when the constant is on and every implemented display condition holds", async () => {
    vi.stubEnv("VITE_SECOND_DIAGRAM_PROMPT_ENABLED", "true");
    const wrapper = mountPrompt();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="second-diagram-prompt"]').exists()).toBe(true);
  });

  it("stays hidden when the constant is on but the viewer is not the creator", async () => {
    vi.stubEnv("VITE_SECOND_DIAGRAM_PROMPT_ENABLED", "true");
    const wrapper = mountPrompt({ currentAccountId: OTHER });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="second-diagram-prompt"]').exists()).toBe(false);
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
  });

  it("stays hidden when the constant is on but the viewer is not yet ready", async () => {
    vi.stubEnv("VITE_SECOND_DIAGRAM_PROMPT_ENABLED", "true");
    const wrapper = mountPrompt({ ready: false });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="second-diagram-prompt"]').exists()).toBe(false);
  });

  it("stays hidden with no attribution (author unknown) even when the constant is on", async () => {
    vi.stubEnv("VITE_SECOND_DIAGRAM_PROMPT_ENABLED", "true");
    const wrapper = mountPrompt({ attribution: null });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="second-diagram-prompt"]').exists()).toBe(false);
  });

  it("fires macro_second_diagram_prompt_shown exactly once when it becomes visible", async () => {
    vi.stubEnv("VITE_SECOND_DIAGRAM_PROMPT_ENABLED", "true");
    const wrapper = mountPrompt();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(trackAnalyticsEvent).toHaveBeenCalledTimes(1);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith("macro_second_diagram_prompt_shown", {
      feature_area: "macro",
      surface: "viewer",
      macro_type: "sequence",
    });
  });

  it("fires macro_second_diagram_prompt_clicked on click, with the documented properties", async () => {
    vi.stubEnv("VITE_SECOND_DIAGRAM_PROMPT_ENABLED", "true");
    const wrapper = mountPrompt();
    await wrapper.vm.$nextTick();
    vi.mocked(trackAnalyticsEvent).mockClear();

    await wrapper.find('[data-testid="second-diagram-prompt-cta"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(trackAnalyticsEvent).toHaveBeenCalledWith("macro_second_diagram_prompt_clicked", {
      feature_area: "macro",
      surface: "viewer",
      macro_type: "sequence",
    });
  });
});
