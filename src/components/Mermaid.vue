<template>
  <div class="mermaid-root" :class="{ 'mermaid-root--editor': !isDisplayMode }">
    <div v-if="!mermaidCode" class="flex flex-col items-center justify-center py-16 px-8 text-center select-none">
      <div class="text-4xl mb-3">🌿</div>
      <div class="text-sm font-semibold text-emerald-700 mb-1">Start with Mermaid</div>
      <div class="text-xs text-gray-400 mb-4">Type or paste Mermaid syntax in the editor</div>
      <pre class="text-left text-xs font-mono bg-gray-900 text-emerald-300 rounded-lg px-5 py-4 leading-relaxed">sequenceDiagram
    Alice-&gt;&gt;John: Hello John!
    John--&gt;&gt;Alice: Hi Alice!</pre>
    </div>
    <DiagramViewport
      v-else
      ref="viewport"
      macro-type="mermaid"
      label="Mermaid"
      content-class="mermaid-diagram flex justify-center"
      :html="svg"
    />
  </div>
</template>

<script>
import { renderMermaid } from '@/utils/mermaid/renderMermaid'
import { normalizeSvgSizing } from '@/utils/mermaid/normalizeSvgSizing'
import { normalizeMermaidWhitespace } from '@/utils/mermaid/normalizeWhitespace'
import EventBus from "@/EventBus";
import {DiagramType} from "@/model/Diagram/Diagram";
import globals from '@/model/globals';
import { trackRenderTime } from '@/utils/analytics/trackRenderTime';
import { trackViewerRenderCrash } from '@/utils/analytics/trackViewerRenderCrash';
import { awaitSvgTextLayout } from '@/utils/renderGate/documentLayout';
import * as renderPerf from '@/utils/analytics/renderPerf';
import DiagramViewport from '@/components/Viewer/DiagramViewport.vue';
import { attachMermaidHighlights } from '../../tools/mermaid-highlights/src/mermaid-highlights.mjs';

export default {
  name: "Mermaid",
  components: { DiagramViewport },
  props: {
    relationshipHighlights: { type: Boolean, default: false },
    readOnly: { type: Boolean, default: false },
  },
  emits: ['highlight-ready', 'highlight-used'],
  data() {
    return {
      svg: null,
      captureMode: false,
      highlightController: null,
      highlightCleanup: null,
      currentFlowchartModel: null,
      highlightUsedGeneration: -1,
      renderGeneration: 0,
      layoutWaitController: null,
    }
  },
  computed: {
    mermaidCode() {
      const { diagramType, mermaidCode } = this.$store.state.diagram;
      if (diagramType !== DiagramType.Mermaid || !mermaidCode) return false;
      // A body of only blank lines or U+00A0 is treated as no diagram; asking
      // Mermaid to parse it throws "No diagram type detected".
      return normalizeMermaidWhitespace(mermaidCode).trim() ? mermaidCode : false;
    },
    isDisplayMode() {
      return this.$store.getters.isDisplayMode;
    },
    highlightSurfaceAllowed() {
      // Export-entry renders are photographed at native size, never interactive.
      return this.isDisplayMode && !this.readOnly && !this.captureMode
        && window.forgeGlobal?.forgeContext?.extension?.modal?.openExport !== true;
    },
  },
  async mounted() {
    const code = this.mermaidCode;
    if (!code) return;
    const applied = await this.renderAndApply(code, true);
    if (applied) {
      trackRenderTime('mermaid', this.isDisplayMode);
      EventBus.$emit('diagramLoaded', code, DiagramType.Mermaid);
    }
    await globals.apWrapper.initializeContext();
  },
  beforeUnmount() {
    // An already queued render may finish after this component is gone.
    this.renderGeneration++;
    this.clearHighlights();
    this.layoutWaitController?.abort();
    this.layoutWaitController = null;
  },
  watch: {
    readOnly() {
      this.clearHighlights();
      if (this.relationshipHighlights && this.highlightSurfaceAllowed && this.mermaidCode) this.renderAndApply(this.mermaidCode);
    },
    relationshipHighlights() {
      this.clearHighlights();
      if (this.relationshipHighlights && this.highlightSurfaceAllowed) {
        if (this.currentFlowchartModel) this.installHighlights();
        else if (this.mermaidCode) this.renderAndApply(this.mermaidCode);
      }
    },
    isDisplayMode() {
      this.clearHighlights();
      if (this.relationshipHighlights && this.highlightSurfaceAllowed && this.mermaidCode) this.renderAndApply(this.mermaidCode);
    },
    async mermaidCode(newVal) {
      if (!newVal) {
        this.renderGeneration++;
        this.layoutWaitController?.abort();
        this.layoutWaitController = null;
        this.clearHighlights();
        this.currentFlowchartModel = null;
        this.svg = null;
      } else {
        await this.renderAndApply(newVal);
      }
    }
  },
  methods: {
    /** Synchronous capture boundary: call before ExportModal starts cloning DOM. */
    setCaptureMode(active) {
      this.captureMode = !!active;
      this.clearHighlights();
      if (!this.captureMode && this.relationshipHighlights && this.highlightSurfaceAllowed) {
        if (this.currentFlowchartModel) this.installHighlights();
        else if (this.mermaidCode) this.renderAndApply(this.mermaidCode);
      }
    },
    clearHighlights() {
      this.highlightCleanup?.();
      this.highlightCleanup = null;
      this.highlightController?.destroy();
      this.highlightController = null;
      this.$emit('highlight-ready', false);
    },
    installHighlights() {
      if (!this.relationshipHighlights || !this.highlightSurfaceAllowed || !this.currentFlowchartModel) return;
      const svg = this.$refs.viewport?.$el?.querySelector('svg');
      if (!svg) return;
      try {
        this.highlightController = attachMermaidHighlights(svg, this.currentFlowchartModel);
        let used = this.highlightUsedGeneration === this.renderGeneration, timer = null, hovered = null;
        const target = event => {
          const el = event.target.closest?.('[data-hit-node],[data-hit-edge],g[data-node],path[data-edge]');
          if (!el || !svg.contains(el)) return null;
          return { el, kind: el.hasAttribute('data-hit-node') || el.hasAttribute('data-node') ? 'node' : 'edge' };
        };
        const cancel = () => { clearTimeout(timer); timer = null; hovered = null; };
        const report = item => {
          if (!item || used) return;
          used = true;
          this.highlightUsedGeneration = this.renderGeneration;
          cancel();
          this.$emit('highlight-used', { kind: item.kind });
        };
        const over = event => {
          const item = target(event);
          if (!item || used || hovered === item.el) return;
          cancel(); hovered = item.el;
          timer = setTimeout(() => report(item), 700);
        };
        const out = event => {
          if (hovered && hovered.contains(event.target) && !hovered.contains(event.relatedTarget)) cancel();
        };
        const select = event => report(target(event));
        const listeners = [['pointerover', over], ['pointerout', out], ['pointerleave', cancel], ['click', select], ['focusin', select]];
        for (const [name, handler] of listeners) svg.addEventListener(name, handler);
        this.highlightCleanup = () => { cancel(); for (const [name, handler] of listeners) svg.removeEventListener(name, handler); };
        this.$emit('highlight-ready', true);
      } catch {
        // Relationship highlighting is optional. Keep the real rendered diagram.
        this.clearHighlights();
      }
    },
    /** Re-bind the pan/zoom viewport after the slotted SVG changes. */
    initializeViewport() {
      return this.$refs.viewport?.attach();
    },
    async renderAndApply(code, measureInitialAttempt = false) {
      this.clearHighlights();
      this.layoutWaitController?.abort();
      const layoutWaitController = new AbortController();
      this.layoutWaitController = layoutWaitController;
      const generation = ++this.renderGeneration;
      let svg;
      try {
        svg = await this.render(code, measureInitialAttempt, layoutWaitController.signal);
      } finally {
        if (this.layoutWaitController === layoutWaitController) {
          this.layoutWaitController = null;
        }
      }
      // Latest request wins. This also prevents a queued result from writing
      // into a component that changed diagram type or was unmounted.
      if (!svg || generation !== this.renderGeneration || this.mermaidCode !== code) {
        return false;
      }
      this.currentFlowchartModel = typeof svg === 'string' ? null : svg.flowchartModel;
      this.svg = typeof svg === 'string' ? svg : svg.svg;
      await this.$nextTick();
      if (generation !== this.renderGeneration || this.mermaidCode !== code) {
        return false;
      }
      await this.initializeViewport();
      if (generation !== this.renderGeneration || this.mermaidCode !== code) return false;
      this.installHighlights();
      return true;
    },
    async runMermaid(code) {
      const renderId = `mermaid-${crypto.randomUUID()}`;
      // Bodies stored before the save-time normalisation still carry pasted
      // U+00A0, which mermaid's Langium grammars refuse. Normalising here is
      // what makes those diagrams render again without a data migration.
      const source = normalizeMermaidWhitespace(code);
      const captureFlowchartModel = this.relationshipHighlights && this.highlightSurfaceAllowed;
      const { svg, flowchartModel } = captureFlowchartModel
        ? await renderMermaid(renderId, source, { captureFlowchartModel: true })
        : await renderMermaid(renderId, source);
      // A `useMaxWidth: false` diagram carries a fixed height that our flex
      // wrapper cannot shrink, which letterboxes the drawing. See
      // normalizeSvgSizing for the measurement.
      const normalized = normalizeSvgSizing(svg);
      return captureFlowchartModel ? { svg: normalized, flowchartModel } : normalized;
    },
    reportCrash(error) {
      console.error('mermaid render error', error);
      // reliability-audit-2026-08-06 §3/§12.1: a mermaid.js exception used to
      // be console.error-only and the blank result was recorded as a successful
      // macro_viewed. This path runs only after any safe retry is exhausted;
      // mounted() now records macro_viewed only when an SVG was actually applied.
      trackViewerRenderCrash('mermaid', this.isDisplayMode, error);
    },
    isTransientRenderError(error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      return message.includes('svg element not in render tree')
        || /matrix (?:is )?(?:not |non[- ]?)invertible/i.test(message);
    },
    async render(code, measureInitialAttempt = false, signal) {
      const firstAttempt = () => measureInitialAttempt
        ? renderPerf.time('render', () => this.runMermaid(code))
        : this.runMermaid(code);
      try {
        return await firstAttempt();
      } catch (error) {
        if (signal?.aborted) return;
        // Parser and module-load failures are deterministic here. Waiting for
        // layout cannot change them, so preserve the original failure signal.
        if (!this.isTransientRenderError(error)) {
          this.reportCrash(error);
          return;
        }
        // Mermaid's own failure condition is a 0 x 0 SVG text getBBox(), not
        // merely a missing body rect. Wait until that exact measurement works.
        // There is deliberately no ten-second deadline: a collapsed or
        // virtualised Confluence macro can stay hidden longer, and PR #691's
        // timed retry produced the same guaranteed failure a second time.
        const measurable = await awaitSvgTextLayout({ signal });
        if (!measurable || signal?.aborted) return;
        try {
          return await this.runMermaid(code);
        } catch (retryError) {
          if (signal?.aborted) return;
          this.reportCrash(retryError);
        }
      }
    }
  }
}
</script>

<style scoped>
/* The editor preview is a fixed-height pane (Workspace.vue makes the column a
   flex box). This is the first link of the chain that lets DiagramViewport fill
   it instead of collapsing to the diagram's height. */
.mermaid-root--editor {
  height: 100%;
  min-height: 0;
}
</style>
