import { mount } from "@vue/test-utils";
import { vi } from "vitest";
import HomepageFeedCard from "@/components/HomepageFeed/HomepageFeedCard.vue";
import { DiagramType } from "@/model/Diagram/Diagram";

vi.mock("@/utils/analytics/trackAnalyticsEvent", () => ({
  trackAnalyticsEvent: vi.fn(),
}));
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";

vi.mock("@/model/globals/forgeGlobal", () => ({
  openUrl: vi.fn(),
  navigateToPage: vi.fn(),
}));
import { openUrl, navigateToPage } from "@/model/globals/forgeGlobal";

const isAgentLinkEnabled = vi.fn();
vi.mock("@/apis/aiTitleFeatureFlag", () => ({
  isAgentLinkEnabled: () => isAgentLinkEnabled(),
}));

vi.mock("@/composables/agentLink/connectInstructions", () => ({
  mcpAddCommand: () => "claude mcp add --transport http zenuml https://conf-lite.zenuml.com/agent-link/mcp",
  mcpServerName: () => "zenuml",
  buildHomepagePrompt: ({ cloudId }: { cloudId?: string }) => `home prompt for ${cloudId || "-"}`,
}));

const writeClipboard = vi.fn();
vi.mock("@/utils/clipboard", () => ({
  writeClipboard: (text: string) => writeClipboard(text),
}));

// The shape searchDiagramsForge really returns (ApWrapper2.DiagramSearchHit):
// a v1 CQL hit enriched with the v2 body's diagramType and pageId. Building
// rows from anything narrower is how the card would pass its tests while
// rendering nothing in production.
const searchDiagramsForge = vi.fn();
vi.mock("@/model/globals", () => ({
  default: {
    get apWrapper() {
      return { searchDiagramsForge: (...args: unknown[]) => searchDiagramsForge(...args) };
    },
  },
}));

function hit(over: Partial<Record<string, unknown>> = {}) {
  return {
    contentId: "cc-1",
    title: "Checkout state machine",
    diagramType: DiagramType.Mermaid,
    spaceKey: "PAYMENTS",
    pageId: "67371062",
    excerpt: "",
    lastModified: "2026-08-20T00:00:00.000Z",
    ...over,
  };
}

const BASE_PROPS = {
  feature_area: "homepage_feed",
  surface: "route",
  entry_point: "route",
};

async function mountSettled(hits: unknown[]) {
  searchDiagramsForge.mockResolvedValue(hits);
  const wrapper = mount(HomepageFeedCard);
  // mount -> onMounted -> loadRecent resolves -> loading flips -> re-render
  await wrapper.vm.$nextTick();
  await Promise.resolve();
  await wrapper.vm.$nextTick();
  return wrapper;
}

describe("HomepageFeedCard (confluence:homepageFeed)", () => {
  beforeEach(() => {
    vi.mocked(trackAnalyticsEvent).mockClear();
    vi.mocked(openUrl).mockClear();
    vi.mocked(navigateToPage).mockClear();
    searchDiagramsForge.mockReset();
    isAgentLinkEnabled.mockReset().mockResolvedValue(false);
    writeClipboard.mockReset();
  });

  it("renders and fires homepage_feed_viewed exactly once on mount", async () => {
    const wrapper = await mountSettled([]);

    expect(wrapper.find('[data-testid="homepage-feed-card"]').exists()).toBe(true);
    expect(trackAnalyticsEvent).toHaveBeenCalledTimes(1);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith("homepage_feed_viewed", BASE_PROPS);
  });

  it("keeps the action visible while the lookup is still running", async () => {
    // The action must not appear late and push the list under the pointer, so
    // it lives outside the loading branch.
    searchDiagramsForge.mockReturnValue(new Promise(() => {}));
    const wrapper = mount(HomepageFeedCard);
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="homepage-feed-loading"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="homepage-feed-action"]').exists()).toBe(true);
  });

  it("fires homepage_feed_action_clicked and opens the quick-start URL on the action click", async () => {
    const wrapper = await mountSettled([]);
    vi.mocked(trackAnalyticsEvent).mockClear();

    await wrapper.find('[data-testid="homepage-feed-action"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(trackAnalyticsEvent).toHaveBeenCalledWith("homepage_feed_action_clicked", BASE_PROPS);
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith(wrapper.vm.QUICK_START_URL);
  });

  it("fills the list to four rows, own diagrams first, examples for untried types", async () => {
    const wrapper = await mountSettled([hit()]);

    expect(wrapper.vm.diagrams).toHaveLength(1);
    // One Mermaid diagram covers the flowchart example, so the remaining three
    // slots go to the types the viewer has not tried, in measured usage order.
    expect(wrapper.vm.examples.map((e: { key: string }) => e.key)).toEqual([
      "graph",
      "sequence",
      "openapi",
    ]);
  });

  it("still offers one untried type when the viewer already has three diagrams", async () => {
    const wrapper = await mountSettled([
      hit({ contentId: "a", diagramType: DiagramType.Sequence }),
      hit({ contentId: "b", diagramType: DiagramType.Mermaid }),
      hit({ contentId: "c", diagramType: DiagramType.OpenApi }),
    ]);

    expect(wrapper.vm.diagrams).toHaveLength(3);
    expect(wrapper.vm.examples.map((e: { key: string }) => e.key)).toEqual(["graph"]);
  });

  it("drops hits that carry no page to navigate to", async () => {
    // A row without pageId has nothing for router.navigate to open; rendering
    // it would be a control that does nothing when clicked.
    const wrapper = await mountSettled([
      hit({ contentId: "a", pageId: "" }),
      hit({ contentId: "b", spaceKey: "" }),
      hit({ contentId: "c" }),
    ]);

    expect(wrapper.vm.diagrams.map((d: { contentId: string }) => d.contentId)).toEqual(["c"]);
  });

  it("navigates to the page carrying the diagram, reporting the macro type", async () => {
    const wrapper = await mountSettled([hit()]);
    vi.mocked(trackAnalyticsEvent).mockClear();

    await wrapper.find('[data-testid="homepage-feed-diagram-cc-1"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(trackAnalyticsEvent).toHaveBeenCalledWith("homepage_feed_diagram_opened", {
      ...BASE_PROPS,
      macro_type: "mermaid",
    });
    expect(navigateToPage).toHaveBeenCalledTimes(1);
    expect(navigateToPage).toHaveBeenCalledWith("PAYMENTS", "67371062");
  });

  it("opens an example row in place, one at a time, without navigating", async () => {
    const wrapper = await mountSettled([]);
    vi.mocked(trackAnalyticsEvent).mockClear();

    await wrapper.find('[data-testid="homepage-feed-example-graph"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.openExample).toBe("graph");
    expect(trackAnalyticsEvent).toHaveBeenCalledWith("homepage_feed_example_expanded", {
      ...BASE_PROPS,
      macro_type: "graph",
    });
    expect(navigateToPage).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();

    // Accordion: opening a second row closes the first.
    await wrapper.find('[data-testid="homepage-feed-example-sequence"]').trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.openExample).toBe("sequence");

    // Clicking the open row closes it.
    await wrapper.find('[data-testid="homepage-feed-example-sequence"]').trigger("click");
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.openExample).toBe(null);
  });

  it("binds an example image only once its row has been opened", async () => {
    const wrapper = await mountSettled([]);

    expect(wrapper.findAll(".disclosure img")).toHaveLength(0);

    await wrapper.find('[data-testid="homepage-feed-example-flowchart"]').trigger("click");
    await wrapper.vm.$nextTick();

    const img = wrapper.find(".disclosure img");
    expect(img.exists()).toBe(true);
    // Relative on purpose: Vite builds with base './' and an absolute /image/
    // URL does not resolve against the Forge CDN's hashed asset paths.
    expect(img.attributes("src")).toBe("./image/byline-example-flowchart.png");
  });

  it("treats a lower-case stored OpenAPI type as a covered type", async () => {
    // Real bodies on lite-dev store `openapi`, while DiagramType.OpenApi is
    // 'OpenAPI' (custom content 67600411, verified 2026-08-21). Before the
    // folded lookup the row rendered as "Diagram" with the neutral spine, and
    // the OpenAPI example row still offered a type the viewer already had.
    const wrapper = await mountSettled([hit({ contentId: "a", diagramType: "openapi" })]);

    expect(wrapper.vm.examples.map((e: { key: string }) => e.key)).not.toContain("openapi");
    expect(wrapper.find('[data-testid="homepage-feed-diagram-a"]').text()).toContain("OpenAPI");
  });

  it("falls back to a full set of example rows when the lookup fails", async () => {
    searchDiagramsForge.mockRejectedValue(new Error("boom"));
    const wrapper = mount(HomepageFeedCard);
    await wrapper.vm.$nextTick();
    await Promise.resolve();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.loading).toBe(false);
    expect(wrapper.vm.diagrams).toHaveLength(0);
    expect(wrapper.vm.examples).toHaveLength(4);
  });

  describe("Connect MCP row", () => {
    const MCP_PROPS = {
      feature_area: "agent_link",
      surface: "route",
      entry_point: "route",
      mcp_mode: "headless",
      mcp_button_placement: "homepage_feed",
    };

    async function mountWithFlag(enabled: boolean) {
      isAgentLinkEnabled.mockResolvedValue(enabled);
      const wrapper = await mountSettled([]);
      await Promise.resolve();
      await wrapper.vm.$nextTick();
      return wrapper;
    }

    afterEach(() => {
      delete (window as unknown as { forgeGlobal?: unknown }).forgeGlobal;
    });

    it("stays hidden while the agent-link flag is off", async () => {
      const wrapper = await mountWithFlag(false);
      expect(wrapper.find('[data-testid="homepage-feed-mcp"]').exists()).toBe(false);
    });

    it("stays hidden when the flag lookup fails", async () => {
      isAgentLinkEnabled.mockRejectedValue(new Error("flags down"));
      const wrapper = await mountSettled([]);
      await Promise.resolve();
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-testid="homepage-feed-mcp"]').exists()).toBe(false);
    });

    it("opens the setup command and a site-scoped prompt, and reports the open", async () => {
      (window as unknown as { forgeGlobal: unknown }).forgeGlobal = { forgeContext: { cloudId: "c-1" } };
      const wrapper = await mountWithFlag(true);
      vi.mocked(trackAnalyticsEvent).mockClear();

      await wrapper.find('[data-testid="homepage-feed-mcp-toggle"]').trigger("click");

      expect(wrapper.find('[data-testid="homepage-feed-mcp-setup"]').text()).toContain("claude mcp add");
      expect(wrapper.find('[data-testid="homepage-feed-mcp-prompt"]').text()).toBe("home prompt for c-1");
      expect(trackAnalyticsEvent).toHaveBeenCalledWith("agent_link_mcp_dialog_opened", MCP_PROPS);
    });

    it("reports the dwell when the row is closed again", async () => {
      const wrapper = await mountWithFlag(true);
      const toggle = wrapper.find('[data-testid="homepage-feed-mcp-toggle"]');
      await toggle.trigger("click");
      vi.mocked(trackAnalyticsEvent).mockClear();

      await toggle.trigger("click");

      expect(wrapper.find('[data-testid="homepage-feed-mcp-setup"]').exists()).toBe(false);
      expect(trackAnalyticsEvent).toHaveBeenCalledWith(
        "agent_link_mcp_dialog_closed",
        expect.objectContaining({ ...MCP_PROPS, dwell_ms: expect.any(Number) }),
      );
    });

    it("copies the setup command and reports the outcome", async () => {
      writeClipboard.mockResolvedValue(true);
      const wrapper = await mountWithFlag(true);
      await wrapper.find('[data-testid="homepage-feed-mcp-toggle"]').trigger("click");
      vi.mocked(trackAnalyticsEvent).mockClear();

      const copy = wrapper.find('[data-testid="homepage-feed-mcp-copy-setup"]');
      await copy.trigger("click");
      await Promise.resolve();
      await wrapper.vm.$nextTick();

      expect(writeClipboard).toHaveBeenCalledWith(expect.stringContaining("claude mcp add"));
      expect(copy.text()).toBe("Copied");
      expect(trackAnalyticsEvent).toHaveBeenCalledWith("agent_link_mcp_dialog_copied", {
        ...MCP_PROPS,
        mcp_copy_target: "setup_command",
        outcome: "copied",
      });
    });

    it("offers manual selection when the clipboard is unavailable", async () => {
      writeClipboard.mockResolvedValue(false);
      const wrapper = await mountWithFlag(true);
      await wrapper.find('[data-testid="homepage-feed-mcp-toggle"]').trigger("click");

      const copy = wrapper.find('[data-testid="homepage-feed-mcp-copy-prompt"]');
      await copy.trigger("click");
      await Promise.resolve();
      await wrapper.vm.$nextTick();

      expect(copy.text()).toBe("Select & copy");
      expect(trackAnalyticsEvent).toHaveBeenCalledWith(
        "agent_link_mcp_dialog_copied",
        expect.objectContaining({ mcp_copy_target: "prompt", outcome: "clipboard_failed" }),
      );
    });
  });
});
