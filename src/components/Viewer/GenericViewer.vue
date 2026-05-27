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
      <div class="viewer-frame" :class="{'viewer-frame--wide': wide, 'viewer-frame--auto': !wide}">
        <div class="viewer-surface" :class="{'viewer-surface--hover': isHovering}"
             @mouseenter="isHovering = true" @mouseleave="isHovering = false">
          <!-- Top edge: title (left) + Edit / Fullscreen (right) -->
          <div class="viewer-edge-top">
            <div class="viewer-title-area">
              <span v-if="isEmbedded" class="viewer-embed-chip" title="Content is embedded from another page">EMBED</span>
              <!--
                ZEN-1170 Defect 2b: visible chip + tooltip when the diagram was
                loaded via orphan-sibling recovery. The disabled Edit button's
                title alone wouldn't surface on touch / for keyboard users —
                this chip is always visible and keyboard-focusable.
              -->
              <span
                v-if="diagram.recoveredFromOrphan"
                class="viewer-recovered-chip"
                role="status"
                aria-label="Diagram recovered from a backup, read-only until you re-save via the page editor."
                tabindex="0"
                :title="recoveredFromOrphanMessage"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="viewer-recovered-chip-icon" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
                READ-ONLY
              </span>
              <span class="viewer-title" :title="title">{{ title }}</span>
            </div>
            <div class="viewer-top-actions">
              <button v-if="showEdit && !isFullscreenMode" :disabled="!!editDisabledReason" :title="editDisabledReason || undefined" @click="edit" aria-label="Edit" class="viewer-btn-ghost">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-icon">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                </svg>
                <span>Edit</span>
              </button>
              <button v-if="!isFullscreenMode" @click="fullscreen" aria-label="Fullscreen" class="viewer-btn-primary">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-icon">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                </svg>
                <span>Fullscreen</span>
              </button>
            </div>
          </div>

          <!--
            ZEN-1170 Defect 2b recovery banner. Always-visible, accessible
            explanation of how to actually edit the macro when its
            customContentId is dead. Sits above the canvas so it's noticed
            even by users who skip the disabled Edit button.
          -->
          <div
            v-if="diagram.recoveredFromOrphan"
            class="viewer-recovered-banner"
            role="status"
            data-testid="recovered-banner"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-recovered-banner-icon" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            </svg>
            <span>
              Recovered from backup.
              <span class="viewer-recovered-banner-hint">To save changes, open page editor → edit this macro.</span>
            </span>
          </div>


          <!-- Canvas + bottom-edge pill -->
          <div class="viewer-canvas">
            <!-- #152: permission-denied empty state (403) -->
            <div v-if="isPermissionError" class="viewer-load-failed" role="alert" data-testid="load-failed-permission">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-load-failed-icon" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
              <div class="viewer-load-failed-body">
                <strong>You may not have permission to view this diagram's source content</strong>
                <p class="viewer-load-failed-hint">The diagram is stored on a Confluence page you can't access. Ask the page owner for read access, or contact your admin.</p>
              </div>
              <button class="viewer-load-failed-btn" @click="retry">I have permission, retry</button>
            </div>
            <!-- #151: generic load-failed empty state -->
            <div v-else-if="isLoadFailed" class="viewer-load-failed" role="alert" data-testid="load-failed-generic">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-load-failed-icon" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              <div class="viewer-load-failed-body">
                <strong>Couldn't load this diagram</strong>
                <span v-if="failedCustomContentId" class="viewer-load-failed-id">Content ID: {{ failedCustomContentId }}</span>
              </div>
              <button class="viewer-load-failed-btn" @click="retry">Retry</button>
              <a class="viewer-support-link" data-testid="load-failed-support-link" href="#" @click.prevent="contactSupport">Contact support →</a>
            </div>
            <div v-else class="screen-capture-content" :class="{'w-full': wide}">
              <slot></slot>
            </div>

            <div v-if="!isLoadFailed" class="viewer-edge-bottom-pill" role="toolbar" aria-label="Diagram actions">
              <!-- Graph viewer slots in multi-page nav (prev / X of Y / next) here. -->
              <slot name="pill-prefix"></slot>
              <button @click="copyCode" title="Copy code" aria-label="Copy code" class="viewer-pill-btn">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-icon">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                </svg>
              </button>
              <button @click="showExportModal = true" title="Export PNG" aria-label="Export PNG" class="viewer-pill-btn">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-icon">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
              </button>
              <button v-if="isCustomContent" @click="showContentVersions" title="Versions" aria-label="Versions" class="viewer-pill-btn">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-icon">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              </button>
              <button @click="copyLink" title="Copy link" aria-label="Copy link" class="viewer-pill-btn">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-icon">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                </svg>
              </button>
              <OverflowMenu trigger-label="More">
                <template #default="{ close }">
                  <button
                    type="button"
                    role="menuitem"
                    class="overflow-menu-item"
                    :disabled="isDownloadingDebug"
                    @click="onDownloadDebugInfo(close)"
                  >
                    <span class="overflow-menu-item-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M9 4.5a3 3 0 0 1 6 0M5 8h14M7 8v6a5 5 0 0 0 10 0V8M4 11h3M17 11h3M5 17l-1.5 2M19 17l1.5 2M12 14v6m0 0-2.25-2.25M12 20l2.25-2.25" />
                      </svg>
                    </span>
                    <span>Download debug info</span>
                  </button>
                </template>
              </OverflowMenu>
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
import OverflowMenu from '@/components/Viewer/OverflowMenu.vue'
import { toast } from '@/utils/toast'
import { buildAndDownloadDebugBundle } from '@/services/debugBundle'
import { MacroIdProvider } from '@/model/ContentProvider/MacroIdProvider'
import { openUrl } from '@/model/globals/forgeGlobal'

const DEFAULT_TITLE = 'Untitled diagram'

export default {
  name: "GenericViewer",
  props: ['wide', 'hideHeader'],
  data: () => ({
    canUserEdit: true,
    isHovering: false,
    showExportModal: false,
    isDownloadingDebug: false,
  }),
  components: {
    Debug,
    ErrorBoundary,
    ExportModal,
    OverflowMenu,
  },
  computed: {
    ...mapState({
      diagramType: state => state.diagram.diagramType,
      diagram: state => state.diagram,
      loadError: state => state.loadError,
    }),
    ...mapGetters({isDisplayMode: 'isDisplayMode'}),
    isLoadFailed() {
      return this.diagramType === 'unknown' && this.isDisplayMode;
    },
    isPermissionError() {
      return this.isLoadFailed && this.loadError?.httpStatus === 403;
    },
    failedCustomContentId() {
      return window.forgeGlobal?.forgeContext?.extension?.config?.customContentId;
    },
    isFullscreenMode() {
      return window.forgeGlobal?.forgeContext?.extension?.modal?.macroMode === 'fullscreen';
    },
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
      // ZEN-1170 Defect 1: legacy-content-property recoveries set
      // recoveredFromOrphan=true (reusing Defect 2b's UI flag). Without
      // this clause those docs have source=ContentProperty so showEdit
      // returns false and the disabled Edit button + tooltip steering the
      // user to the page editor never appears.
      return this.canUserEdit && (isCustomContent || this.diagram.recoveredFromOrphan);
    },
    recoveredFromOrphanMessage() {
      return 'This diagram was recovered from a backup. To save changes, click Edit on the page (top right), then click Edit on this macro.';
    },
    editDisabledReason() {
      // ZEN-1170 Defect 2b / Defect 1: when the diagram was loaded via
      // any recovery path (orphan-sibling CC or legacy page content
      // property), the macro XML doesn't reference a live customContentId.
      // Our in-viewer Edit opens a modal where view.submit({config}) can't
      // persist back to the macro — saves would silently create orphans
      // (2b) or fail to migrate the macro to the current shape (1).
      // Steer the user to Confluence's page editor where the macro-config
      // surface (isConfiguring=true) can actually persist the writeback.
      if (this.diagram.recoveredFromOrphan) {
        return this.recoveredFromOrphanMessage;
      }
      if (!this.diagram.isCopy) return null;
      return this.diagram.copyReason === 'cross-page'
        ? 'This diagram lives on another page. Edit it there to keep both in sync.'
        : 'There are multiple copies of this diagram on this page. Edits affect all of them.';
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
    retry() {
      location.reload();
    },
    async contactSupport() {
      const contentId = this.failedCustomContentId ?? '(unknown)';
      const ctx = window.forgeGlobal?.forgeContext ?? {};
      const payload = [
        'Diagram failed to load',
        `Content ID: ${contentId}`,
        `App version: ${import.meta.env.VITE_APP_VERSION ?? '(unknown)'} (${import.meta.env.PRODUCT_TYPE ?? '(unknown)'})`,
        `Forge env: ${ctx?.environment?.type ?? '(unknown)'}`,
        `cloudId: ${ctx?.cloudId ?? '(unknown)'}`,
      ].join('\n');
      const ok = await this.copyToClipboard(payload);
      toast({
        message: ok
          ? 'Diagnostic info copied — paste into your ticket'
          : `Couldn't auto-copy. Content ID: ${contentId}`,
        duration: ok ? 4000 : 6000,
      });
      trackEvent('support_link_clicked', 'click', 'load_failed_generic', { content_id: String(this.failedCustomContentId ?? '') });
      openUrl('https://zenuml.atlassian.net/servicedesk');
    },
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
    async onDownloadDebugInfo(closeMenu) {
      if (this.isDownloadingDebug) return;
      this.isDownloadingDebug = true;
      try {
        const provider = new MacroIdProvider(globals.apWrapper);
        const apRequest = (url) => globals.apWrapper.request(url);
        const { bundle, serialisedSize } = await buildAndDownloadDebugBundle(
          { diagram: this.diagram, diagramType: this.diagramType },
          {
            apRequest,
            getCustomContentId: () => provider.getId().then(v => v ?? null),
            getMacroUuid:       () => provider.getUuid().then(v => v ?? null),
          },
        );
        trackEvent('debug_bundle_downloaded', 'click', this.diagramType, {
          diagram_type:           bundle.identity.diagramType,
          product_type:           bundle.identity.productType,
          had_custom_content_id:  !!bundle.identity.customContentId,
          latest_version_number:  bundle.saved.latest?.versionNumber ?? null,
          error_count:            bundle.errors.length,
          bundle_size_bytes:      serialisedSize,
        });
      } catch (err) {
        console.error('[debug-bundle] failed', err);
        toast({ message: 'Could not produce debug bundle. Please retry.', duration: 3000 });
      } finally {
        this.isDownloadingDebug = false;
        if (typeof closeMenu === 'function') closeMenu();
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
/* ----- chrome-less viewer surface --------------------------------------- */
.viewer-frame {
  position: relative;
  display: block;
  background: #fff;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}
.viewer-frame--auto { width: fit-content; margin-left: auto; margin-right: auto; }
.viewer-frame--wide { width: 100%; }

.viewer-surface { position: relative; }

.viewer-edge-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: #fff;
  border-bottom: 1px solid transparent;
  transition: border-color 200ms ease;
}
.viewer-surface--hover .viewer-edge-top { border-bottom-color: #E5E7EB; }

.viewer-title-area {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-shrink: 1;
  margin-right: 12px;
}
.viewer-title {
  font-size: 14px;
  font-weight: 600;
  color: #172B4D;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 420px;
}
.viewer-embed-chip {
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
/* Variant A — quiet status row. Neutral chip + thin info strip beneath the
   header. The previous amber alert read like a critical error; "recovered"
   is informational, so it should look like metadata, not a warning. */
.viewer-recovered-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 2px 7px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: #4B5563;
  background: #F3F4F6;
  border: 1px solid #E5E7EB;
  border-radius: 4px;
  text-transform: uppercase;
  outline-offset: 2px;
}
.viewer-recovered-chip-icon {
  width: 11px;
  height: 11px;
  flex-shrink: 0;
}
.viewer-recovered-chip:focus-visible {
  outline: 2px solid #6B7280;
}
.viewer-recovered-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 16px 7px 19px;
  background: #F9FAFB;
  border-bottom: 1px solid #E5E7EB;
  color: #4B5563;
  font-size: 12px;
  line-height: 1.4;
}
.viewer-recovered-banner-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.viewer-recovered-banner-hint {
  color: #6B7280;
}

.viewer-top-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: 0;
  transition: opacity 200ms ease;
}
.viewer-surface--hover .viewer-top-actions { opacity: 1; }

.viewer-btn-ghost {
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
.viewer-btn-ghost:hover { background: #F3F4F6; color: #111827; }
.viewer-btn-ghost:disabled { opacity: 0.45; cursor: not-allowed; }
.viewer-btn-ghost:disabled:hover { background: transparent; color: #374151; }

.viewer-btn-primary {
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
.viewer-btn-primary:hover { background: #0747A6; }
.viewer-btn-primary:active { background: #064395; }

.viewer-icon { width: 16px; height: 16px; }

.viewer-load-failed {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 24px;
  text-align: center;
  color: #374151;
}
.viewer-load-failed-icon {
  width: 32px;
  height: 32px;
  color: #9CA3AF;
  flex-shrink: 0;
}
.viewer-load-failed-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.viewer-load-failed-body strong {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}
.viewer-load-failed-hint {
  font-size: 13px;
  color: #6B7280;
  max-width: 360px;
}
.viewer-load-failed-id {
  font-size: 12px;
  color: #9CA3AF;
  font-family: monospace;
}
.viewer-load-failed-btn {
  padding: 6px 14px;
  background: #F3F4F6;
  color: #374151;
  border: 1px solid #E5E7EB;
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 150ms ease;
}
.viewer-load-failed-btn:hover { background: #E5E7EB; }

.viewer-support-link {
  margin-top: 4px;
  font-size: 12px;
  color: #6B7280;
  text-decoration: none;
  cursor: pointer;
}
.viewer-support-link:hover { color: #374151; text-decoration: underline; }

.viewer-canvas {
  position: relative;
  background: #fff;
  min-height: 64px;
}
.viewer-canvas .screen-capture-content { position: relative; z-index: 0; }
.viewer-canvas .screen-capture-content.w-full { width: 100%; }

.viewer-edge-bottom-pill {
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
.viewer-surface--hover .viewer-edge-bottom-pill {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(-50%) translateY(0);
}

.viewer-pill-btn,
::v-slotted(.viewer-pill-btn) {
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
.viewer-pill-btn:hover,
::v-slotted(.viewer-pill-btn:hover) { background: #F3F4F6; color: #374151; }
::v-slotted(.viewer-pill-btn:disabled) { opacity: 0.4; cursor: not-allowed; }
::v-slotted(.viewer-pill-btn:disabled:hover) { background: transparent; color: #6B7280; }
::v-slotted(.viewer-icon) { width: 16px; height: 16px; }
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
