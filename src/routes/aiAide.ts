
import React from 'react';
import ReactDOM from 'react-dom';
import AiAide from "@/components/react/AiAide";
import { trackEvent } from '@/utils/window';

export async function handleAiAideRoute() {
  // Track that the AI Aide route was accessed
  trackEvent('', 'ai_aide_route_accessed', 'ai', { page_type: 'ai_aide' });

  const container = document.getElementById('app');
  if (!container) {
    console.error('handleAiAideRoute: #app container not found');
    return;
  }

  try {
    // Render the React component into the app container. Guard errors to avoid breaking the page.
    ReactDOM.render(React.createElement(AiAide as any, {}), container);
  } catch (e) {
    console.error('Error rendering AiAide component:', e);
    trackEvent(JSON.stringify(e), 'ai_aide_render_error', 'error', { error: (e && (e as any).message) || String(e) });
  }
}
