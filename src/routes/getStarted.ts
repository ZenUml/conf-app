import { createApp } from 'vue';
import GetStarted from '@/components/GetStarted/GetStarted.vue';
import { trackEvent } from '@/utils/window';
import globals from '@/model/globals';

export async function handleGetStartedRoute() {
  try {
    // Initialize context
    await globals.apWrapper.initializeContext();
    
    // Track page view
    trackEvent('', 'get_started_route_accessed', 'forge_get_started', {
      page_type: 'global_settings_get_started',
      version: '2025.04'
    });
    
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
