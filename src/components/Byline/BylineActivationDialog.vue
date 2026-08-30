<template>
  <div class="byline-activation">
    <!-- LOADING: a real backend call answered from cache, dressed in ~2s of
         theatre that communicates "drawn from your page". aria-live announces
         the phases; Cancel exits. -->
    <section v-if="phase === 'loading'" class="ba-center" aria-live="polite">
      <div class="ba-spark" role="img" aria-label="Working"></div>
      <p class="ba-loading-copy">{{ loadingCopy }}</p>
      <button class="ba-text-btn" @click="cancel">Cancel</button>
    </section>

    <!-- PREVIEW: the curated diagram, read-only. No regenerate;
         dissatisfaction routes to Edit. -->
    <section v-else-if="phase === 'preview'" class="ba-preview-wrap">
      <header class="ba-head">
        <h1 class="ba-title">This page, as a diagram</h1>
        <p class="ba-sub">Just a preview — nothing has been saved.</p>
      </header>
      <div class="ba-preview">
        <DiagramPortal :hide-header="true" :read-only="true" />
      </div>
      <footer class="ba-actions">
        <button class="ba-btn ba-primary" :disabled="busy" @click="useThisDiagram">
          {{ busy ? 'Saving…' : 'Use this diagram' }}
        </button>
        <button class="ba-btn ba-secondary" :disabled="busy" @click="editDiagram">
          Edit diagram
        </button>
      </footer>
    </section>

    <!-- COMPLETION: mint a deeplink; primary action copies it. -->
    <section v-else-if="phase === 'completion'" class="ba-center">
      <div class="ba-check" role="img" aria-label="Done"></div>
      <h1 class="ba-title">Your diagram is ready</h1>
      <p class="ba-sub">Paste the link into any Confluence page — it becomes the diagram.</p>
      <button class="ba-btn ba-primary" @click="copyLink">
        {{ copied ? 'Copied' : 'Copy diagram link' }}
      </button>
      <button class="ba-text-btn" @click="close">Done</button>
    </section>

    <!-- CACHE MISS / ERROR: graceful, honest, no dead end. -->
    <section v-else class="ba-center">
      <h1 class="ba-title">Couldn't load a diagram</h1>
      <p class="ba-sub">{{ errorCopy }}</p>
      <button class="ba-text-btn" @click="close">Close</button>
    </section>
  </div>
</template>

<script>
import DiagramPortal from '@/components/DiagramPortal.vue';
import { DiagramType } from '@/model/Diagram/Diagram';
import store from '@/model/store2';
import globals from '@/model/globals';
import forgeGlobal, { openModal } from '@/model/globals/forgeGlobal';
import { view } from '@forge/bridge';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import {
  fetchPreparedDiagram,
  preparedToDiagram,
  preparedAgeDays,
} from '@/services/ActivationPrepared';
import { capturePng, blobToBase64 } from '@/model/Attachment';
import { callRemote } from '@/utils/requestUtil';
import { deeplinkHostForProductType, buildEmbedDeeplink } from '@/utils/embedDeeplink';
import { diagnoseSaveFailure, GENERIC_SAVE_FAILED_MESSAGE } from '@/model/saveFailureDiagnosis';

const LOADING_MIN_MS = 1800; // theatre floor even on a fast cache hit
// Diagram types DiagramPortal can render read-only in the preview. Graph
// (DrawIO) / openapi / asyncapi need heavier viewers and ~6s loads — excluded
// from the prepared preview for v1.
const RENDERABLE_TYPES = new Set([DiagramType.Sequence, DiagramType.Mermaid, DiagramType.PlantUml]);

// Base analytics props for every byline/activation event. surface is passed
// EXPLICITLY (never inferred) — the byline iframe would otherwise be labelled
// `viewer` (#368).
function baseProps(extra = {}) {
  return { feature_area: 'macro', surface: 'byline', ...extra };
}

export default {
  name: 'BylineActivationDialog',
  components: { DiagramPortal },
  data() {
    return {
      phase: 'loading',
      loadingCopy: 'Reading this page…',
      busy: false,
      copied: false,
      deeplinkUrl: '',
      errorCopy: 'This preview has expired. Try again from the page.',
      pageId: undefined,
      savedContentId: undefined,
      preparedAge: undefined,
      pngBase64: undefined,
    };
  },
  async mounted() {
    this.pageId = globals.apWrapper.currentPageId
      || forgeGlobal.forgeContext?.extension?.content?.id;

    trackAnalyticsEvent('activation_nudge_clicked', baseProps());
    await this.enterPreparedMode();
  },
  methods: {
    async enterPreparedMode() {
      const started = Date.now();
      // Phase the loading copy so the theatre reads as "understanding → drawing".
      const t = setTimeout(() => { this.loadingCopy = 'Drawing it as a diagram…'; }, 700);
      let payload;
      try {
        payload = await fetchPreparedDiagram(String(this.pageId));
      } catch (e) {
        console.error('byline: prepared fetch failed', e);
      }
      clearTimeout(t);
      await this.holdTheatre(started);

      if (!payload) {
        trackAnalyticsEvent('activation_cache_miss', baseProps());
        this.errorCopy = 'We couldn’t find a prepared diagram for this page.';
        this.phase = 'error';
        return;
      }
      // The preview renders through DiagramPortal, which only mounts sequence/
      // mermaid/plantuml. A curated graph/openapi/asyncapi payload would render
      // a blank preview — treat it as a miss until DiagramPortal gains those
      // renderers, so the pipeline can safely never target them for v1.
      if (!RENDERABLE_TYPES.has(payload.diagramType)) {
        trackAnalyticsEvent('activation_cache_miss', baseProps({
          macro_type: payload.diagramType,
        }));
        this.errorCopy = 'This diagram type isn’t supported here yet.';
        this.phase = 'error';
        return;
      }
      this.preparedAge = preparedAgeDays(payload);
      store.state.diagram = preparedToDiagram(payload);
      store.state.diagramLoadComplete = true;
      this.phase = 'preview';
      trackAnalyticsEvent('activation_served', baseProps({
        macro_type: payload.diagramType,
        prepared_age_days: this.preparedAge,
      }));
    },

    // Keep the loading screen up for at least LOADING_MIN_MS so a warm cache
    // hit still reads as "drawn from your page", not a flash.
    async holdTheatre(startedAt) {
      const elapsed = Date.now() - startedAt;
      if (elapsed < LOADING_MIN_MS) {
        await new Promise((r) => setTimeout(r, LOADING_MIN_MS - elapsed));
      }
    },

    async useThisDiagram() {
      if (this.busy) return;
      this.busy = true;
      try {
        await this.captureNow();
        const saved = await globals.apWrapper.createCustomContentV2(store.state.diagram);
        this.savedContentId = saved?.id;
        await this.mintDeeplink();
        trackAnalyticsEvent('activation_completed', baseProps({
          macro_type: store.state.diagram.diagramType,
          activation_path: 'copy_link',
        }));
        this.phase = 'completion';
      } catch (e) {
        console.error('byline: useThisDiagram failed', e);
        // A create-time 404 is probed once (save_failed_diagnosed); a proven
        // permission gap is named instead of "try again" (which cannot help).
        const diagnosed = await diagnoseSaveFailure(
          e, { surface: 'byline', macro_type: store.state.diagram.diagramType }, globals.apWrapper,
        );
        this.errorCopy = diagnosed === GENERIC_SAVE_FAILED_MESSAGE
          ? 'Saving the diagram failed. Please try again.'
          : diagnosed;
        this.phase = 'error';
      } finally {
        this.busy = false;
      }
    },

    async editDiagram() {
      if (this.busy) return;
      this.busy = true;
      try {
        await this.captureNow();
        const saved = await globals.apWrapper.createCustomContentV2(store.state.diagram);
        this.savedContentId = saved?.id;
        trackAnalyticsEvent('activation_diagram_edited', baseProps({
          macro_type: store.state.diagram.diagramType,
        }));
        // Hand off to the real editor with the saved diagram preloaded.
        // NOTE: openModal from within a viewportContainer:modal byline is
        // UNVERIFIED (nested Forge Modal) — probe on lite-dev before relying
        // on it; falls through to completion if the modal never opens.
        await openModal({
          resource: 'main',
          size: 'fullscreen',
          context: { customContentId: this.savedContentId, macroMode: 'editor' },
          onClose: async () => { await this.afterEdit(); },
        });
      } catch (e) {
        console.error('byline: editDiagram failed', e);
        await this.mintDeeplink().catch(() => {});
        this.phase = 'completion';
      } finally {
        this.busy = false;
      }
    },

    async afterEdit() {
      await this.mintDeeplink().catch(() => {});
      trackAnalyticsEvent('activation_completed', baseProps({
        macro_type: store.state.diagram.diagramType,
        activation_path: 'copy_link',
      }));
      this.phase = 'completion';
    },

    // Capture the PNG WHILE the preview is still mounted (the DOM lookup in
    // capturePng is not scoped to a ref). Best-effort — a miss leaves the mint
    // without an image, which the deeplink Worker handles as the no-preview case.
    async captureNow() {
      try {
        const d = store.state.diagram;
        const src = d.code || d.mermaidCode || d.plantUmlCode || d.graphXml || '';
        const blob = await capturePng(d.diagramType, src);
        if (blob) this.pngBase64 = await blobToBase64(blob);
      } catch (e) {
        console.warn('byline: PNG capture failed (non-fatal)', e);
      }
    },

    // Never throws: a saved diagram must always reach the completion screen
    // with a working link. The rich Slack-preview ticket needs a PNG; without
    // one (capture miss) or if the mint fails, fall back to the plain deeplink,
    // which still autoconverts when pasted into Confluence.
    async mintDeeplink() {
      if (!this.savedContentId) return;
      const cloudId = forgeGlobal.forgeContext?.cloudId;
      const host = deeplinkHostForProductType(import.meta.env.PRODUCT_TYPE);
      const plainUrl = cloudId && host
        ? buildEmbedDeeplink(host, cloudId, this.savedContentId)
        : '';
      if (!this.pngBase64) { this.deeplinkUrl = plainUrl; return; }
      try {
        const raw = await callRemote('/deeplink-ticket', 'POST', {
          contentId: this.savedContentId,
          pageId: String(this.pageId),
          title: store.state.diagram.title || 'Diagram',
          pngBase64: this.pngBase64,
        });
        const result = typeof raw === 'string' ? JSON.parse(raw) : raw;
        this.deeplinkUrl = result?.url || plainUrl;
      } catch (e) {
        console.warn('byline: ticket mint failed, using plain link', e);
        this.deeplinkUrl = plainUrl;
      }
    },

    async copyLink() {
      if (!this.deeplinkUrl) return;
      this.copied = await this.copyText(this.deeplinkUrl);
    },

    // text/plain only — a text/html clipboard flavour is eaten by Confluence's
    // paste handling before autoConvert can match (verified during #360).
    async copyText(text) {
      if (navigator.clipboard && window.isSecureContext) {
        try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
      }
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.setAttribute('readonly', '');
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    },

    cancel() {
      trackAnalyticsEvent('activation_nudge_dismissed', baseProps());
      this.close();
    },

    close() {
      try { view.close(); } catch (e) { console.warn('byline: view.close failed', e); }
    },
  },
};
</script>

<style scoped>
.byline-activation {
  font: 15px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #172b4d;
  height: 100vh;
  display: flex;
  flex-direction: column;
}
.ba-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  text-align: center;
  padding: 24px;
}
.ba-head { padding: 24px 24px 8px; }
.ba-title { font-size: 1.35rem; font-weight: 600; margin: 0; }
.ba-sub { color: #626f86; margin: 6px 0 0; }
.ba-preview-wrap { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.ba-preview { flex: 1; min-height: 0; overflow: auto; padding: 8px 24px; }
.ba-actions { display: flex; gap: 12px; padding: 16px 24px; border-top: 1px solid #e4e6ea; }
.ba-btn {
  font: inherit; font-weight: 600; border: 0; border-radius: 6px;
  padding: 9px 18px; cursor: pointer;
}
.ba-btn:disabled { opacity: 0.6; cursor: default; }
.ba-primary { background: #0c66e4; color: #fff; }
.ba-secondary { background: #f1f2f4; color: #172b4d; }
.ba-text-btn { background: none; border: 0; color: #626f86; cursor: pointer; text-decoration: underline; }
.ba-spark {
  width: 44px; height: 44px; border-radius: 10px;
  background: linear-gradient(135deg, #0c66e4, #964ac2);
  animation: ba-pulse 1.1s ease-in-out infinite;
}
.ba-check {
  width: 44px; height: 44px; border-radius: 50%;
  background: #22a06b;
}
@keyframes ba-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
@media (prefers-reduced-motion: reduce) { .ba-spark { animation: none; } }
</style>
