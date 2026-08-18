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

// `import.meta.env.VITE_SECOND_DIAGRAM_PROMPT_ENABLED` is statically replaced
// by esbuild/Vite's `define` block (vite.config.mjs) at transform time — in
// BOTH `pnpm build:*` and `vitest --run`, since vitest shares the same
// `defineConfig`. `vi.stubEnv` cannot override a value the transform already
// inlined as a literal, so it silently no-ops here. Mock the accessor module
// instead (src/utils/featureConstants.ts) and control its return value
// directly. `importOriginal` keeps the real (build-time-default) function as
// the mock's default implementation, so the one test that intentionally
// exercises the unmocked default doesn't need any override.
vi.mock("@/utils/featureConstants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/featureConstants")>();
  return {
    ...actual,
    isSecondDiagramPromptEnabled: vi.fn(actual.isSecondDiagramPromptEnabled),
  };
});
import { isSecondDiagramPromptEnabled } from "@/utils/featureConstants";

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
  beforeEach(async () => {
    vi.mocked(trackAnalyticsEvent).mockClear();
    // Reset to the REAL implementation (not just clear call history) before
    // every test, so mockReturnValue(true) set by one test can't leak into
    // the next via a shared mock instance.
    const actual = await vi.importActual<typeof import("@/utils/featureConstants")>(
      "@/utils/featureConstants",
    );
    vi.mocked(isSecondDiagramPromptEnabled).mockImplementation(actual.isSecondDiagramPromptEnabled);
  });

  it("is hidden by default — the VITE_SECOND_DIAGRAM_PROMPT_ENABLED constant defaults OFF", async () => {
    // No mockReturnValue override here: this exercises the REAL build-time
    // default from vite.config.mjs (via importOriginal), not a mocked value.
    const wrapper = mountPrompt();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="second-diagram-prompt"]').exists()).toBe(false);
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
  });

  it("renders when the constant is on and every implemented display condition holds", async () => {
    vi.mocked(isSecondDiagramPromptEnabled).mockReturnValue(true);
    const wrapper = mountPrompt();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="second-diagram-prompt"]').exists()).toBe(true);
  });

  it("stays hidden when the constant is on but the viewer is not the creator", async () => {
    vi.mocked(isSecondDiagramPromptEnabled).mockReturnValue(true);
    const wrapper = mountPrompt({ currentAccountId: OTHER });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="second-diagram-prompt"]').exists()).toBe(false);
    expect(trackAnalyticsEvent).not.toHaveBeenCalled();
  });

  it("stays hidden when the constant is on but the viewer is not yet ready", async () => {
    vi.mocked(isSecondDiagramPromptEnabled).mockReturnValue(true);
    const wrapper = mountPrompt({ ready: false });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="second-diagram-prompt"]').exists()).toBe(false);
  });

  it("stays hidden with no attribution (author unknown) even when the constant is on", async () => {
    vi.mocked(isSecondDiagramPromptEnabled).mockReturnValue(true);
    const wrapper = mountPrompt({ attribution: null });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="second-diagram-prompt"]').exists()).toBe(false);
  });

  it("fires macro_second_diagram_prompt_shown exactly once when it becomes visible", async () => {
    vi.mocked(isSecondDiagramPromptEnabled).mockReturnValue(true);
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
    vi.mocked(isSecondDiagramPromptEnabled).mockReturnValue(true);
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
