import { createApp } from 'vue';
import globals from '@/model/globals';

/**
 * confluence:homepageFeed host (`zenuml-homepage-feed`) — the card in the
 * right panel of the Confluence Home page. Unlike the byline modal below,
 * Confluence renders this card's iframe on every Home-page visit whose
 * section is expanded (not gated behind a click), so `homepage_feed_viewed`
 * genuinely measures impressions, not opens.
 *
 * The `homepage_feed_viewed` event is emitted by the component (on mount),
 * not here — same reasoning as handleBylineRoute: this route only needs to
 * get the component on screen.
 */
export async function handleHomepageFeedRoute() {
  const container = document.getElementById('app');
  if (!container) {
    console.error('[homepageFeed] #app container not found');
    return;
  }

  try {
    await globals.apWrapper.initializeContext();
    const HomepageFeedCard = (await import('@/components/HomepageFeed/HomepageFeedCard.vue')).default;
    createApp(HomepageFeedCard).mount(container);
  } catch (e) {
    console.error('[homepageFeed] failed to mount', e);
  }
}
