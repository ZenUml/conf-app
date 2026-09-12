import { createApp } from 'vue';
import GetStarted from '@/components/GetStarted/GetStarted.vue';
import { trackEvent } from '@/utils/window';
import globals from '@/model/globals';

export async function handleGetStartedRoute() {
  try {
    // Initialize context
    await globals.apWrapper.initializeContext();

    // Page-view analytics fires once, from GetStarted.vue's mounted() hook
    // (get_started_viewed via trackAnalyticsEvent) — not here, to avoid a
    // route-level + component-level double count of the same page load.

    // Create and mount the Vue app
    const app = createApp(GetStarted);
    
    // Mount to the app container
    const container = document.getElementById('app');
    if (container) {
      app.mount(container);
    } else {
      console.error('App container not found');
    }
    
  } catch (error) {
    console.error('Error handling get started route:', error);
    trackEvent('', 'get_started_route_error', 'forge_get_started', {
      error: error.message
    });
  }
}
