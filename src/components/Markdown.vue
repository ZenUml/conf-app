<template>
  <div class="markdown-document" :aria-busy="rendering" :data-markdown-source-hash="renderedHash">
    <p v-if="!source" class="markdown-empty">Paste Markdown here, including Mermaid code blocks, to preview your document.</p>
    <p v-else-if="error" role="alert">Could not render this document. Your source is preserved.</p>
    <article v-else v-html="html" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { renderMarkdown } from '@/utils/markdown/renderMarkdown';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { trackRenderTime } from '@/utils/analytics/trackRenderTime';
import { hasLayout, awaitLayout } from '@/utils/renderGate/documentLayout';
import EventBus from '@/EventBus';
import md5 from 'md5';

const store = useStore();
const source = computed(() => store.state.diagram.markdownCode ?? '');
const html = ref('');
const renderedHash = ref('');
const error = ref(false);
const rendering = ref(false);
let revision = 0;
let timer: ReturnType<typeof setTimeout>;
watch(source, (code: string) => {
  const current = ++revision;
  clearTimeout(timer);
  error.value = false;
  renderedHash.value = '';
  rendering.value = !!code;
  if (!code) {
    html.value = '';
    renderedHash.value = md5('');
    nextTick(() => {
      if (current === revision) EventBus.$emit('diagramLoaded', '', 'markdown');
    });
    return;
  }
  timer = setTimeout(async () => {
    const properties = {
      feature_area: 'content' as const,
      surface: store.getters.isDisplayMode ? 'viewer' as const : 'editor' as const,
      macro_type: 'markdown' as const,
      source_length: code.length,
    };
    trackAnalyticsEvent('markdown_render_requested', properties);
    try {
      if (!hasLayout()) await awaitLayout();
      if (current !== revision) return;
      const result = await renderMarkdown(code);
      if (current !== revision) return;
      html.value = result.html;
      renderedHash.value = md5(code);
      trackAnalyticsEvent(result.failedBlocks ? 'markdown_render_failed' : 'markdown_render_succeeded', {
        ...properties,
        markdown_mermaid_blocks: result.mermaidBlocks,
        markdown_failed_blocks: result.failedBlocks,
      });
      await nextTick();
      trackRenderTime('markdown', store.getters.isDisplayMode);
      EventBus.$emit('diagramLoaded', code, 'markdown');
    } catch {
      if (current !== revision) return;
      error.value = true;
      trackAnalyticsEvent('markdown_render_failed', properties);
    } finally {
      if (current === revision) rendering.value = false;
    }
  }, 250);
}, { immediate: true });
onBeforeUnmount(() => { revision++; clearTimeout(timer); });
</script>

<style scoped>
.markdown-document { width: 100%; min-width: 0; padding: 24px; background: #fff; color: #172b4d; text-align: left; overflow-wrap: anywhere; }
.markdown-empty { color: #6b7280; padding: 32px 0; }
.markdown-document :deep(article) { font-size: 15px; line-height: 1.7; }
.markdown-document :deep(h1) { font-size: 2em; font-weight: 700; margin: 0 0 .7em; }
.markdown-document :deep(h2) { font-size: 1.5em; font-weight: 650; margin: 1.4em 0 .6em; }
.markdown-document :deep(h3), .markdown-document :deep(h4), .markdown-document :deep(h5), .markdown-document :deep(h6) { font-weight: 650; margin: 1em 0 .5em; }
.markdown-document :deep(p), .markdown-document :deep(ul), .markdown-document :deep(ol) { margin: 0 0 1em; }
.markdown-document :deep(ul) { list-style: disc; padding-left: 1.5em; }
.markdown-document :deep(ol) { list-style: decimal; padding-left: 1.5em; }
.markdown-document :deep(a) { color: #0052cc; text-decoration: underline; }
.markdown-document :deep(pre) { background: #f4f5f7; padding: 16px; border-radius: 6px; overflow: auto; white-space: pre; margin: 1em 0; }
.markdown-document :deep(code) { font-family: monospace; background: #f4f5f7; border-radius: 3px; }
.markdown-document :deep(blockquote) { border-left: 3px solid #dfe1e6; padding-left: 16px; color: #5e6c84; }
.markdown-document :deep(table) { border-collapse: collapse; display: block; overflow-x: auto; margin: 1em 0; }
.markdown-document :deep(th), .markdown-document :deep(td) { border: 1px solid #dfe1e6; padding: 8px 12px; }
.markdown-document :deep(th) { background: #f4f5f7; }
.markdown-document :deep(img) { max-width: 100%; }
.markdown-document :deep(hr) { margin: 24px 0; border-top: 1px solid #dfe1e6; }
.markdown-document :deep(.markdown-diagram) { margin: 20px 0; overflow-x: auto; }
.markdown-document :deep(.markdown-diagram svg) { max-width: 100%; height: auto; }
.markdown-document :deep([role=alert]) { border-left: 3px solid #de350b; padding-left: 16px; }
</style>
