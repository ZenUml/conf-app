import { createApp } from 'vue';
import store from '@/model/store2';
import globals from '@/model/globals';
import BylineActivationDialog from '@/components/Byline/BylineActivationDialog.vue';
import { trackEvent } from '@/utils/window';

// Route for the "View as diagram" contentBylineItem (moduleKey
// zenuml-byline-newuser). Distinct from the Aide byline (routes/aiAide.ts).
// MUST use `.use(store)` — the dialog mounts DiagramPortal, whose Sequence/
// Mermaid children read this.$store; getStarted.ts omits it and would throw.
export async function handleBylineActivationRoute() {
  try {
    await globals.apWrapper.initializeContext();
    const container = document.getElementById('app');
    if (!container) {
      console.error('handleBylineActivationRoute: #app container not found');
      return;
    }
    createApp(BylineActivationDialog).use(store).mount(container);
  } catch (e) {
    console.error('Error handling byline activation route:', e);
    trackEvent(JSON.stringify(e), 'byline_activation_route_error', 'error');
  }
}
