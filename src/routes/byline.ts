import { createApp } from 'vue';
import globals from '@/model/globals';

/**
 * Lite byline modal host (`zenuml-byline-diagrams`).
 *
 * Confluence boots this iframe only when the user clicks the byline item —
 * measured 2026-08-01, 5 opens against 39,197 macro views on the variants that
 * ship a byline entry — so nothing here runs on a normal page load and the
 * component may load heavy dependencies without a page-load cost argument.
 *
 * The `byline_opened` event is emitted by the component, not here, because it
 * carries the page's diagram count and that is only known after the list
 * resolves. Firing a context-free event at route entry would produce exactly
 * the ambiguity that made Diagramly's `ai_aide_route_accessed` unusable as a
 * numerator.
 */
export async function handleBylineRoute() {
  const container = document.getElementById('app');
  if (!container) {
    console.error('[byline] #app container not found');
    return;
  }

  try {
    await globals.apWrapper.initializeContext();
    const BylineDiagrams = (await import('@/components/Byline/BylineDiagrams.vue')).default;
    createApp(BylineDiagrams).mount(container);
  } catch (e) {
    console.error('[byline] failed to mount', e);
  }
}
