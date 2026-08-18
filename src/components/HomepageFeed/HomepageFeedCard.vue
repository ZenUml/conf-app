<template>
  <div class="homepage-feed-card" data-testid="homepage-feed-card">
    <p class="homepage-feed-card__body">
      Turn text into sequence, flowchart, and API diagrams on any Confluence page.
    </p>
    <button
      type="button"
      class="homepage-feed-card__action"
      data-testid="homepage-feed-action"
      @click="openQuickStart"
    >
      View the quick-start guide
    </button>
  </div>
</template>

<script setup>
// confluence:homepageFeed card (see manifest.yml). Confluence renders this in
// the right panel of the Home page — a surface with no page/content context,
// so "insert a macro" is not an actionable link here the way it is from
// GetStarted.vue (which lives inside a specific page's editor context). The
// one action this card offers is a deep link to the documentation, which
// works identically regardless of which page (if any) the user lands on
// next.
//
// One action only, by design (see the onboarding spec this ships under):
// a Home-page card viewed on a shared/kiosk screen should read as plain and
// professional, not as a marketing surface.
import { onMounted } from "vue";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import { openUrl } from "@/model/globals/forgeGlobal";

const QUICK_START_URL = "https://zenuml.atlassian.net/wiki/spaces/Doc/overview";

function baseProps() {
  return {
    feature_area: "homepage_feed",
    surface: "route",
    entry_point: "route",
  };
}

onMounted(() => {
  trackAnalyticsEvent("homepage_feed_viewed", baseProps());
});

async function openQuickStart() {
  trackAnalyticsEvent("homepage_feed_action_clicked", baseProps());
  await openUrl(QUICK_START_URL);
}

defineExpose({ openQuickStart, QUICK_START_URL });
</script>

<style scoped>
.homepage-feed-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 4px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #172b4d;
}

.homepage-feed-card__body {
  margin: 0;
  font-size: 14px;
  line-height: 1.4;
  color: #44546f;
}

.homepage-feed-card__action {
  align-self: flex-start;
  padding: 6px 12px;
  border: 1px solid #0052cc;
  border-radius: 4px;
  background: #ffffff;
  color: #0052cc;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.homepage-feed-card__action:hover {
  background: #deebff;
}
</style>
