<template>
<!-- screen-capture-content class is used in Attachment.ts to select the node. -->
<div class="generic viewer">
  <Debug />
  <error-boundary>
    <!-- Embed/portal hosts request a chrome-less surface — render the diagram only. -->
    <template v-if="!isDisplayMode || hideHeader">
      <div class="screen-capture-content" :class="{'w-full': wide}">
        <slot></slot>
      </div>
    </template>

    <template v-else>
      <div class="v8-frame" :class="{'v8-frame--wide': wide, 'v8-frame--auto': !wide}">
        <div class="v8-surface" :class="{'v8-surface--hover': isHovering}"
             @mouseenter="isHovering = true" @mouseleave="isHovering = false">
          <!-- Top edge: title (left) + Edit / Fullscreen (right) -->
          <div class="v8-edge-top">
            <div class="v8-title-area">
              <span v-if="isEmbedded" class="v8-embed-chip" title="Content is embedded from another page">EMBED</span>
              <span class="v8-title" :title="title">{{ title }}</span>
            </div>
            <div class="v8-top-actions">
              <button v-if="showEdit" @click="edit" aria-label="Edit" class="v8-btn-ghost">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="v8-icon">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                </svg>
                <span>Edit</span>
              </button>
              <button @click="fullscreen" aria-label="Fullscreen" class="v8-btn-primary">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="v8-icon">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                </svg>
                <span>Fullscreen</span>
              </button>
            </div>
          </div>

          <!-- Canvas + bottom-edge pill -->
          <div class="v8-canvas">
            <div class="screen-capture-content" :class="{'w-full': wide}">
              <slot></slot>
            </div>

            <div class="v8-edge-bottom-pill" role="toolbar" aria-label="Diagram actions">
              <button @click="copyCode" title="Copy code" aria-label="Copy code" class="v8-pill-btn">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="v8-icon">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                </svg>
              </button>
              <button @click="showExportModal = true" title="Export PNG" aria-label="Export PNG" class="v8-pill-btn">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="v8-icon">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
              </button>
              <button v-if="isCustomContent" @click="showContentVersions" title="Versions" aria-label="Versions" class="v8-pill-btn">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="v8-icon">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              </button>
              <button @click="copyLink" title="Copy link" aria-label="Copy link" class="v8-pill-btn">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="v8-icon">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                </svg>
              </button>
            </div>

          </div>
        </div>
      </div>
    </template>
  </error-boundary>

  <ExportModal :visible="showExportModal" @close="showExportModal = false" />
</div>
</template>

<script>
import {trackEvent} from "@/utils/window";

import {mapState, mapGetters} from "vuex";
import EventBus from '../../EventBus'
import Debug from '@/components/Debug/Debug.vue'
import ErrorBoundary from "@/components/ErrorBoundary.vue";
import globals from '@/model/globals';
import {DataSource} from "@/model/Diagram/Diagram";
import { getCodeFromDiagram } from "@/model/Diagram/DiagramTypeConfig";
import ExportModal from '@/components/ExportModal/ExportModal.vue'
import { toast } from '@/utils/toast'

const DEFAULT_TITLE = 'Untitled diagram'

export default {
  name: "GenericViewer",
  props: ['wide', 'hideHeader'],
  data: () => ({
    canUserEdit: true,
    isHovering: false,
    showExportModal: false,
  }),
  components: {
    Debug,
    ErrorBoundary,
    ExportModal,
  },
  computed: {
    ...mapState({diagramType: state => state.diagram.diagramType, diagram: state => state.diagram }),
    ...mapGetters({isDisplayMode: 'isDisplayMode'}),
    isEmbedded() {
      const moduleKey = window.forgeGlobal?.forgeContext?.moduleKey || ''
      return /embed-macro/.test(moduleKey)
    },
    isCustomContent() {
      return this.diagram.source === DataSource.CustomContent;
    },
    title() {
      const t = this.diagram?.title?.trim?.()
      return t || DEFAULT_TITLE
    },
    showEdit() {
      if (import.meta.env.DEV) return true;
      const isCustomContent = this.diagram.source === DataSource.CustomContent;
      const isNotCopy = !this.diagram.isCopy;
      return this.canUserEdit && isCustomContent && isNotCopy;
    },
  },
  async mounted() {
    try {
      this.canUserEdit = await globals.apWrapper.canUserEdit();
    } catch (e) {
      console.error('canUserEdit failed', e);
    }
  },
  methods: {
    edit() {
      trackEvent('edit', 'click', 'editing');
      EventBus.$emit('edit');
    },
    fullscreen() {
      trackEvent('fullscreen', 'click', 'viewing');
      EventBus.$emit('fullscreen');
    },
    showContentVersions() {
      trackEvent('show_content_versions', 'click', 'viewing');
      if (!this.diagram.id) {
        toast({ message: 'Version history unavailable', duration: 2000 });
        return;
      }
      console.log(`Getting versions for content ID: ${this.diagram.id}`);
      globals.apWrapper.getAndPrintContentVersions(this.diagram.id)
        .then(versions => console.log(`Retrieved ${versions.length} versions`))
        .catch(error => console.error('Error retrieving content versions:', error));
      toast({ message: 'Version history printed to developer console (F12)', duration: 2200 });
    },
    async copyToClipboard(text) {
      if (navigator.clipboard && window.isSecureContext) {
        try { await navigator.clipboard.writeText(text); return true; }
        catch { /* fall through to legacy */ }
      }
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.setAttribute('readonly', '');
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    },
    async copyCode() {
      trackEvent("copy_code", "click", this.diagramType);
      try {
        const code = getCodeFromDiagram(this.diagram, this.diagramType);
        if (!code) { toast({ message: 'No code to copy', duration: 2000 }); return; }
        const ok = await this.copyToClipboard(code);
        toast({ message: ok ? 'Code copied to clipboard' : 'Failed to copy code', duration: 2000 });
      } catch (error) {
        console.error('copyCode failed', error);
        toast({ message: 'Failed to copy code', duration: 2000 });
      }
    },
    async copyLink() {
      trackEvent('copy_link', 'click', 'viewing');
      try {
        const pageId = window.forgeGlobal?.forgeContext?.extension?.content?.id;
        if (!pageId) { toast({ message: 'Link not available', duration: 2000 }); return; }
        // Dynamic import keeps the standalone (non-Forge) preview harness from breaking at module load.
        const { requestConfluence } = await import('@forge/bridge');
        const res = await requestConfluence(`/wiki/api/v2/pages/${pageId}`);
        if (!res.ok) throw new Error(`Page lookup failed: ${res.status}`);
        const page = await res.json();
        const base = page._links?.base || '';
        const webui = page._links?.webui || '';
        const url = (base && webui) ? `${base}${webui}` : '';
        if (!url) { toast({ message: 'Link not available', duration: 2000 }); return; }
        const ok = await this.copyToClipboard(url);
        toast({ message: ok ? 'Link copied to clipboard' : 'Failed to copy link', duration: 2000 });
      } catch (error) {
        console.error('copyLink failed', error);
        toast({ message: 'Failed to copy link', duration: 2000 });
      }
    },
  },
}
</script>

<style scoped>
/* ----- V8 chrome-less viewer surface ------------------------------------ */
.v8-frame {
  position: relative;
  display: block;
  background: #fff;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}
.v8-frame--auto { width: fit-content; margin-left: auto; margin-right: auto; }
.v8-frame--wide { width: 100%; }

.v8-surface { position: relative; }

.v8-edge-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: #fff;
  border-bottom: 1px solid transparent;
  transition: border-color 200ms ease;
}
.v8-surface--hover .v8-edge-top { border-bottom-color: #E5E7EB; }

.v8-title-area {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-shrink: 1;
  margin-right: 12px;
}
.v8-title {
  font-size: 14px;
  font-weight: 600;
  color: #172B4D;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 420px;
}
.v8-embed-chip {
  flex-shrink: 0;
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: #6B7280;
  background: #F3F4F6;
  border-radius: 4px;
  text-transform: uppercase;
}

.v8-top-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: 0;
  transition: opacity 200ms ease;
}
.v8-surface--hover .v8-top-actions { opacity: 1; }

.v8-btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: transparent;
  color: #374151;
  border: 1px solid transparent;
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 200ms ease, color 200ms ease;
}
.v8-btn-ghost:hover { background: #F3F4F6; color: #111827; }

.v8-btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: #0052CC;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 200ms ease;
}
.v8-btn-primary:hover { background: #0747A6; }
.v8-btn-primary:active { background: #064395; }

.v8-icon { width: 16px; height: 16px; }

.v8-canvas {
  position: relative;
  background: #fff;
  min-height: 64px;
}
.v8-canvas .screen-capture-content { position: relative; z-index: 0; }
.v8-canvas .screen-capture-content.w-full { width: 100%; }

.v8-edge-bottom-pill {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%) translateY(8px);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  background: #fff;
  border: 1px solid #E5E7EB;
  border-radius: 9999px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.10);
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms ease, transform 200ms ease;
  z-index: 2;
}
.v8-surface--hover .v8-edge-bottom-pill {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(-50%) translateY(0);
}

.v8-pill-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: transparent;
  color: #6B7280;
  border: none;
  border-radius: 9999px;
  cursor: pointer;
  transition: background-color 200ms ease, color 200ms ease;
}
.v8-pill-btn:hover { background: #F3F4F6; color: #374151; }
</style>

<!--
  Tailwind's preflight resets h1-h6 to `font-size: inherit; font-weight: inherit`
  and zeros heading/paragraph margins. That clobbers DrawIO Textbox shapes whose
  HTML payload (e.g. `<h1>Heading</h1><p>...</p>`) relies on UA defaults to render
  the heading in bold/larger text. Restore UA defaults inside foreignObjects only.
-->
<style>
.screen-capture-content foreignObject h1,
.screen-capture-content foreignObject h2,
.screen-capture-content foreignObject h3,
.screen-capture-content foreignObject h4,
.screen-capture-content foreignObject h5,
.screen-capture-content foreignObject h6,
.screen-capture-content foreignObject p,
.screen-capture-content foreignObject blockquote {
  font-size: revert;
  font-weight: revert;
  margin: revert;
}
</style>
