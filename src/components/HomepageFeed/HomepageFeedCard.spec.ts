import { mount } from "@vue/test-utils";
import { vi } from "vitest";
import HomepageFeedCard from "@/components/HomepageFeed/HomepageFeedCard.vue";

vi.mock("@/utils/analytics/trackAnalyticsEvent", () => ({
  trackAnalyticsEvent: vi.fn(),
}));
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";

vi.mock("@/model/globals/forgeGlobal", () => ({
  openUrl: vi.fn(),
}));
import { openUrl } from "@/model/globals/forgeGlobal";

describe("HomepageFeedCard (confluence:homepageFeed)", () => {
  beforeEach(() => {
    vi.mocked(trackAnalyticsEvent).mockClear();
    vi.mocked(openUrl).mockClear();
  });

  it("renders and fires homepage_feed_viewed exactly once on mount", async () => {
    const wrapper = mount(HomepageFeedCard);
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="homepage-feed-card"]').exists()).toBe(true);
    expect(trackAnalyticsEvent).toHaveBeenCalledTimes(1);
    expect(trackAnalyticsEvent).toHaveBeenCalledWith("homepage_feed_viewed", {
      feature_area: "homepage_feed",
      surface: "route",
      entry_point: "route",
    });
  });

  it("fires homepage_feed_action_clicked and opens the quick-start URL on the action click", async () => {
    const wrapper = mount(HomepageFeedCard);
    await wrapper.vm.$nextTick();
    vi.mocked(trackAnalyticsEvent).mockClear();

    await wrapper.find('[data-testid="homepage-feed-action"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(trackAnalyticsEvent).toHaveBeenCalledWith("homepage_feed_action_clicked", {
      feature_area: "homepage_feed",
      surface: "route",
      entry_point: "route",
    });
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith(wrapper.vm.QUICK_START_URL);
  });
});
