
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
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
    // Keep the legacy mount's synchronous error boundary: this route records
    // initial render failures instead of letting them escape the async root.
    flushSync(() => {
      createRoot(container).render(React.createElement(AiAide as any, {}));
    });
  } catch (e) {
    console.error('Error rendering AiAide component:', e);
    trackEvent(JSON.stringify(e), 'ai_aide_render_error', 'error', { error: (e && (e as any).message) || String(e) });
  }
}
