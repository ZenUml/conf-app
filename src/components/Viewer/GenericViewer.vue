<template>
<!-- screen-capture-content class is used in Attachment.ts to select the node. -->
<div class="generic viewer">
  <Debug />
    <!-- Syntax errors are surfaced by the SyntaxErrorBox (with AI Repair); no
         "Submit a ticket" error panel here. -->
    <!-- Embed/portal hosts request a chrome-less surface — render the diagram only. -->
    <template v-if="!isDisplayMode || hideHeader">
      <div class="screen-capture-content" :class="{'w-full': isWide}">
        <slot></slot>
      </div>
    </template>

    <template v-else>
      <div class="viewer-frame" :class="{'viewer-frame--wide': isWide, 'viewer-frame--auto': !isWide}">
        <!-- viewer-body is a plain wrapper (no layout of its own) unless the
             Fullscreen Connect rail is showing, in which case it becomes a
             two-column flex row — see .viewer-body--with-agent-rail below. -->
        <div class="viewer-body" :class="{'viewer-body--with-agent-rail': showAgentLinkPanel}">
        <div class="viewer-surface" :class="{'viewer-surface--hover': isHovering}"
             @mouseenter="isHovering = true" @mouseleave="isHovering = false">
          <!-- Top edge: title (left) + Edit / Fullscreen (right) -->
          <div class="viewer-edge-top">
            <div class="viewer-title-area">
              <span v-if="isEmbedded" class="viewer-embed-chip" title="Content is embedded from another page">EMBED</span>
              <LiveBadge
                v-if="showAgentLinkBadge"
                :state="agentLinkState"
                :last-activity-at="agentLinkLastActivityAt"
              />
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
              <!-- Live Agent Link — Fullscreen toolbar link-status chip (Track H
                   design contract): names the bound diagram + token TTL. Shown
                   only in Fullscreen once a session exists; the inline collapsed
                   macro keeps its LiveBadge (above) untouched. -->
              <LinkStatusChip
                v-if="showAgentLinkChip"
                :state="agentLinkState"
                :diagram-title="title"
                :expires-at="agentLinkExpiresAt"
              />
            </div>
            <div v-if="!isLoadFailed" class="viewer-top-actions">
              <button v-if="showEdit && !isFullscreenMode" :disabled="!!editDisabledReason" :title="editDisabledReason || undefined" @click="edit" aria-label="Edit" class="viewer-btn-ghost">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-icon">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                </svg>
                <span>Edit</span>
              </button>
              <!-- View Source (#333): visible to ALL viewers, including users without
                   edit permission. Text-DSL types only (sequence / mermaid / plantuml). -->
              <button
                v-if="showViewSource"
                type="button"
                class="viewer-btn-ghost"
                aria-label="Source"
                title="View source"
                data-testid="view-source-btn"
                @click="openViewSource"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-icon" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
                </svg>
                <span>Source</span>
              </button>
              <ConnectButton v-if="showAgentLinkConnect" @connect="connectToAgent" />
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
            <div v-if="isLoadFailed" class="viewer-load-failed" role="alert" data-testid="load-failed-generic">
              <div class="viewer-lf-icon-wrap">
                <svg v-if="hasRetryableFailure" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" class="viewer-lf-icon" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" class="viewer-lf-icon" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-1.5 1.5M10.81 15.31a4.5 4.5 0 0 1-1.242-7.244l1.5-1.5M3 3l18 18" />
                </svg>
              </div>

              <h3 class="viewer-lf-heading">
                {{ hasRetryableFailure ? "This diagram isn't available" : 'The diagram data is no longer available' }}
              </h3>

              <p class="viewer-lf-body">
                <template v-if="hasRetryableFailure">
                  You may not have permission to view it, or the source content has been removed.
                  Other people on this page might still see it.
                </template>
                <template v-else>
                  The original diagram data couldn't be recovered. Contact support — or, if you manage this page, remove and recreate this macro.
                </template>
              </p>

              <div class="viewer-lf-actions">
                <button v-if="hasRetryableFailure" type="button" class="viewer-lf-btn-primary" @click="retry">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="14" height="14" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>
                  Try again
                </button>
                <button
                  v-else
                  type="button"
                  class="viewer-lf-btn-primary"
                  data-testid="load-failed-support-link"
                  @click="contactSupport"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="14" height="14" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/></svg>
                  Contact support
                </button>
                <button
                  v-if="hasRetryableFailure"
                  type="button"
                  class="viewer-lf-btn-secondary"
                  data-testid="load-failed-support-link"
                  @click="contactSupport"
                >
                  Contact support
                </button>
              </div>
            </div>
            <div v-else class="screen-capture-content" :class="{'w-full': isWide}">
              <slot></slot>
            </div>

            <!-- Live Agent Link perceived-latency overlay (charter §6 Track F).
                 Flag-gated exactly like the Connect affordance so the flag-off
                 DOM is unchanged; renders nothing internally while idle. Shows
                 on BOTH surfaces (inline + Fullscreen) because both render this
                 .viewer-canvas — Fullscreen mirrors the state via the handoff. -->
            <ThinkingOverlay v-if="showAgentLinkThinking" :state="agentLinkThinking" />

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
        <!-- Fullscreen Connect rail (design §5.1, §9) — only mounted when the
             flag is on, the diagram type is MVP-supported, and we're actually
             in the Fullscreen modal. See connectToAgent()'s comment: this
             panel is driven by ITS OWN useAgentLinkSession() instance
             (a fresh Vue app boot inside the Fullscreen modal's iframe). -->
        <aside v-if="showAgentLinkPanel" class="agent-link-rail" data-testid="agent-link-fullscreen-rail">
          <ConnectPanel
            :state="agentLinkState"
            :token="agentLinkToken"
            :activity-feed="agentLinkActivityFeed"
            :thinking="agentLinkThinking"
            :diagram-title="title"
            :expires-at="agentLinkExpiresAt"
            :last-activity-at="agentLinkLastActivityAt"
            :lock-expires-at="agentLinkLockExpiresAt"
            :at-cap="agentLinkAtCap"
            @disconnect="onAgentLinkDisconnect"
            @revoke="onAgentLinkRevoke"
            @reconnect="onAgentLinkReconnect"
          />
        </aside>
        </div>
        <ViewSourcePanel
          :visible="showSourcePanel"
          :source="viewSourceCode"
          :dsl-label="viewSourceDslLabel"
          @close="showSourcePanel = false"
          @copy="onViewSourceCopied"
        />
      </div>
    </template>

  <ExportModal :visible="showExportModal" @close="showExportModal = false" />
</div>
</template>

<script>
import {trackEvent} from "@/utils/window";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";

import { markRaw } from 'vue'
import {mapState, mapGetters} from "vuex";
import EventBus from '../../EventBus'
import Debug from '@/components/Debug/Debug.vue'
import globals from '@/model/globals';
import {DataSource, DiagramType} from "@/model/Diagram/Diagram";
import { getCodeFromDiagram, getStoreUpdateAction } from "@/model/Diagram/DiagramTypeConfig";
import ExportModal from '@/components/ExportModal/ExportModal.vue'
import OverflowMenu from '@/components/Viewer/OverflowMenu.vue'
import ViewSourcePanel from '@/components/Viewer/ViewSourcePanel.vue'
import { toast } from '@/utils/toast'
import { buildAndDownloadDebugBundle } from '@/services/debugBundle'
import { MacroIdProvider } from '@/model/ContentProvider/MacroIdProvider'
import ConnectButton from '@/components/AgentLink/ConnectButton.vue'
import ConnectPanel from '@/components/AgentLink/ConnectPanel.vue'
import LinkStatusChip from '@/components/AgentLink/LinkStatusChip.vue'
import LiveBadge from '@/components/AgentLink/LiveBadge.vue'
import ThinkingOverlay from '@/components/AgentLink/ThinkingOverlay.vue'
import { useAgentLinkSession } from '@/composables/agentLink/useAgentLinkSession'
import { createBridgeOps, createUnwiredBridgeOps } from '@/composables/agentLink/bridgeOps'
import { createForgeAgentLinkBridge } from '@/composables/agentLink/forgeBridge'
import { readSession, readAnySession } from '@/composables/agentLink/sessionHandoff'
import { isAgentLinkEnabled } from '@/apis/aiTitleFeatureFlag'
import forgeGlobal, { getContext, openUrl } from '@/model/globals/forgeGlobal'
import { getClientDomain, getSpaceKey } from '@/utils/ContextParameters/ContextParameters'
import { getForgeCustomContentId } from '@/utils/viewerLoadOutcome'

const DEFAULT_TITLE = 'Untitled diagram'
const SUPPORT_PORTAL_URL = 'https://zenuml.atlassian.net/servicedesk'

export default {
  name: "GenericViewer",
  // hideEdit: callers that render a reference to content they shouldn't edit
  // in place (e.g. the AsyncAPI embed macro) suppress the Edit pencil entirely.
  // Editing the source happens at the origin; re-targeting which doc is
  // embedded is a page-editor (macro-config) operation.
  props: ['wide', 'hideHeader', 'hideEdit'],
  data: () => ({
    canUserEdit: true,
    isHovering: false,
    showExportModal: false,
    showSourcePanel: false,
    isDownloadingDebug: false,
    // Live Agent Link (docs/superpowers/specs/2026-07-08-live-agent-link-design.md)
    // master flag, resolved async in mounted(). Defaults false so the flag
    // controls the ENTIRE feature — until it resolves true, this macro
    // renders exactly as it does today.
    agentLinkFeatureEnabled: false,
    agentLinkSession: null,
    loadFailedTelemetryEmitted: false,
  }),
  components: {
    Debug,
    ExportModal,
    OverflowMenu,
    ViewSourcePanel,
    ConnectButton,
    ConnectPanel,
    LinkStatusChip,
    LiveBadge,
    ThinkingOverlay,
  },
  computed: {
    ...mapState({
      diagramType: state => state.diagram.diagramType,
      diagram: state => state.diagram,
      viewerLoadState: state => state.viewerLoadState,
      loadError: state => state.loadError,
    }),
    ...mapGetters({isDisplayMode: 'isDisplayMode'}),
    isLoadFailed() {
      return this.isDisplayMode
        && (this.viewerLoadState === 'failed_with_source'
          || this.viewerLoadState === 'failed_without_source');
    },
    hasRetryableFailure() {
      return this.viewerLoadState === 'failed_with_source';
    },
    failedCustomContentId() {
      return getForgeCustomContentId();
    },
    isFullscreenMode() {
      return window.forgeGlobal?.forgeContext?.extension?.modal?.macroMode === 'fullscreen';
    },
    // Mermaid-only fullscreen fix. In the fullscreen modal `wide` is false (it's
    // wired to autoResize), so the frame is .viewer-frame--auto (width: fit-content).
    // ONLY mermaid breaks there: its SVG is width:100% with no intrinsic px, so in a
    // shrink-to-fit parent it collapses to the CSS default 300px. sequence (ZenUML,
    // explicit px) and plantuml (plantuml.com svg, explicit px) wrap correctly and stay
    // centered via fit-content — forcing THEM wide would left-align them. So only widen
    // the frame for mermaid; everything else keeps its centered fit-content behavior.
    isWide() {
      return this.wide || (this.isFullscreenMode && this.diagramType === DiagramType.Mermaid);
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
      // Embeds are references to content owned elsewhere — no inline Edit; the
      // source is edited at its origin and re-targeting stays in the page editor.
      if (this.hideEdit) return false;
      if (import.meta.env.DEV) return true;
      const isCustomContent = this.diagram.source === DataSource.CustomContent;
      // ZEN-1170 Defect 1: legacy-content-property recoveries set
      // recoveredFromOrphan=true (reusing Defect 2b's UI flag). Without
      // this clause those docs have source=ContentProperty so showEdit
      // returns false and the disabled Edit button + tooltip steering the
      // user to the page editor never appears.
      // Snapshot fallback: same surface — Edit is shown disabled with a
      // "cached copy" tooltip (see editDisabledReason).
      return this.canUserEdit && (isCustomContent || this.diagram.recoveredFromOrphan || this.diagram.snapshotFallback);
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
      // Source-snapshot fallback: live CC unreachable; showing host-page cache.
      // Place before the isCopy branch so a snapshot-restored doc always gets
      // the honest cached-copy notice (not a cross-page-copy message).
      if (this.diagram.snapshotFallback) {
        const when = this.diagram.snapshotAt ? new Date(this.diagram.snapshotAt).toLocaleDateString() : '';
        return `Showing a cached copy${when ? ` from ${when}` : ''}. The original diagram is unavailable — it may have been deleted, or you may not have permission to view its source page.`;
      }
      if (!this.diagram.isCopy) return null;
      return this.diagram.copyReason === 'cross-page'
        ? 'This diagram lives on another page. Edit it there to keep both in sync.'
        // CustomContentStorageProvider.save() forks a copy into a NEW custom-content
        // record (createCustomContentV2) rather than updating the original shared one
        // in place — editing a same-page copy creates an independent diagram, it does
        // not affect the other copies. (The previous "Edits affect all of them" wording
        // was factually wrong.)
        : 'This is one of several copies of this diagram on this page. Editing it will create an independent diagram.';
    },
    // Live Agent Link MVP scope (design §11/§12): agent-native DSL types only.
    // Graph/OpenAPI/AsyncAPI/Embed are not offered the Connect affordance.
    agentLinkMvpSupported() {
      return [DiagramType.Sequence, DiagramType.Mermaid, DiagramType.PlantUml].includes(this.diagramType);
    },
    // View Source (#333): text-DSL types only. NOT gated on canUserEdit — the
    // audience includes readers without edit permission.
    showViewSource() {
      return [DiagramType.Sequence, DiagramType.Mermaid, DiagramType.PlantUml].includes(this.diagramType);
    },
    viewSourceCode() {
      return getCodeFromDiagram(this.diagram, this.diagramType) || '';
    },
    viewSourceDslLabel() {
      switch (this.diagramType) {
        case DiagramType.Mermaid: return 'Mermaid';
        case DiagramType.PlantUml: return 'PlantUML';
        case DiagramType.Sequence:
        default: return 'ZenUML';
      }
    },
    // Small-macro action-area affordance — hidden once already in Fullscreen
    // (that surface shows the Connect *rail* instead, see showAgentLinkPanel).
    showAgentLinkConnect() {
      return this.agentLinkFeatureEnabled && this.agentLinkMvpSupported && !this.isFullscreenMode;
    },
    // Collapsed (non-fullscreen) "● live" indicator (design §3 decision #8).
    showAgentLinkBadge() {
      return this.agentLinkFeatureEnabled && this.agentLinkMvpSupported && !this.isFullscreenMode;
    },
    // The Fullscreen Connect rail (design §5.1 ConnectPanel / §9).
    showAgentLinkPanel() {
      return this.agentLinkFeatureEnabled && this.agentLinkMvpSupported && this.isFullscreenMode;
    },
    // Fullscreen toolbar link-status chip (Track H). Same gating as the rail,
    // but only once a session actually exists (connected/suspended/closed/
    // expired) — it names the bound diagram + TTL, so it has nothing to say
    // pre-pairing. #314 adds 'expired' so the chip actually leaves the live
    // variant once the client-side TTL watchdog fires, instead of staying on
    // whatever it last showed forever.
    showAgentLinkChip() {
      return this.showAgentLinkPanel && ['connected', 'suspended', 'closed', 'expired'].includes(this.agentLinkState);
    },
    agentLinkExpiresAt() {
      return this.agentLinkSession?.expiresAt.value ?? null;
    },
    agentLinkLastActivityAt() {
      return this.agentLinkSession?.lastActivityAt.value ?? null;
    },
    // Amendment D: the composable's honest already-linked lock countdown
    // (set from a mint 409's lockExpiresAt) — forwarded to the Fullscreen
    // ConnectPanel's already_linked SessionNotice.
    agentLinkLockExpiresAt() {
      return this.agentLinkSession?.alreadyLinkedUntil.value ?? null;
    },
    // Amendment F: the DO reported the 60-min absolute cap now bounds the
    // deadline — forwarded to ConnectPanel/SessionTtl to drop the "extends"
    // hint once bumps no longer move the meter.
    agentLinkAtCap() {
      return this.agentLinkSession?.atCap.value ?? false;
    },
    // Perceived-latency overlay gate (charter §6 Track F). Same flag/type
    // gating as the other affordances, but NOT restricted to Fullscreen: the
    // "AI is thinking" state must show on the inline macro surface too (both
    // surfaces render .viewer-canvas). Off ⇒ overlay never mounts ⇒ flag-off
    // DOM is unchanged.
    showAgentLinkThinking() {
      return this.agentLinkFeatureEnabled && this.agentLinkMvpSupported;
    },
    agentLinkThinking() {
      return this.agentLinkSession?.thinkingState.value ?? 'idle';
    },
    agentLinkState() {
      return this.agentLinkSession?.state.value ?? 'idle';
    },
    agentLinkToken() {
      return this.agentLinkSession?.token.value ?? null;
    },
    agentLinkActivityFeed() {
      return this.agentLinkSession?.activityFeed.value ?? [];
    },
  },
  watch: {
    // Fire viewer_load_failed when the error store slot becomes truthy while
    // the macro is in display (viewer) mode. The isDisplayMode guard prevents
    // false positives from editor-context syntax validation errors, which also
    // flow through the same store slot.
    '$store.state.error': {
      handler(error) {
        if (!error || !this.isDisplayMode) return;
        trackAnalyticsEvent('viewer_load_failed', {
          feature_area: 'macro',
          surface: 'viewer',
          macro_type: this.diagramType,
          failure_reason: typeof error === 'string' ? error : (error?.message ?? String(error)),
        });
      },
      immediate: true,
    },
    viewerLoadState: {
      immediate: true,
      handler(state) {
        if (!this.isDisplayMode) {
          return;
        }
        if (state !== 'failed_with_source' && state !== 'failed_without_source') {
          return;
        }
        if (this.loadFailedTelemetryEmitted) {
          return;
        }
        this.loadFailedTelemetryEmitted = true;
        trackEvent('load_failed_shown', 'view', 'load_failed_generic', {
          state: state === 'failed_with_source' ? 'with_id' : 'no_id',
          content_id: String(this.failedCustomContentId ?? ''),
        });
      },
    },
  },
  created() {
    // One useAgentLinkSession() instance per GenericViewer mount, shared by
    // the Connect button / live badge / Fullscreen rail below (whichever
    // template branch is active in THIS mount — see the cross-iframe note
    // on connectToAgent()). This placeholder instance is provisional: the
    // agent-link flag resolves async in mounted() below, and nothing in this
    // window can invoke startConnect()/applyEdit() — the Connect affordance
    // is flag-gated and not yet rendered. mounted() swaps in the real
    // Forge-bridge-backed ops once the flag settles (or keeps this one for
    // standalone/dev/no-context).
    this.agentLinkSession = markRaw(useAgentLinkSession(createUnwiredBridgeOps(), {
      macroType: this.diagramType || 'none',
      clickSurface: 'viewer',
      // Wire the live-render seam even on this provisional instance. The
      // Fullscreen modal hydrates + applies an agent edit through whatever
      // agentLinkSession instance it has, and mounted()'s relay-backed swap does
      // NOT reliably run the same way in the modal iframe (see the hydration
      // block's comment) — so the Fullscreen may still be on THIS placeholder
      // when a dsl update arrives over the handoff. applyAgentDiagramUpdate
      // only needs $store (no bridge/relay), so it is safe here and is what
      // makes ISSUE-1 (Fullscreen re-render) robust to instance selection.
      onDiagramUpdated: (dsl, macroType) => this.applyAgentDiagramUpdate(dsl, macroType),
    }));
  },
  async mounted() {
    try {
      this.canUserEdit = await globals.apWrapper.canUserEdit();
    } catch (e) {
      console.error('canUserEdit failed', e);
    }
    try {
      this.agentLinkFeatureEnabled = await isAgentLinkEnabled();
    } catch (e) {
      console.error('Failed to load agent-link feature flag:', e);
      this.agentLinkFeatureEnabled = false;
    }
    // Live Agent Link real bridge (design §4.2/§4.4): once the flag resolves
    // ON and a real Forge-bridge context (globals.apWrapper) is available,
    // swap the placeholder for the ApWrapper2-backed bridge so writeDiagram
    // actually persists via saveCustomContentV2 — wrapped in createBridgeOps
    // so the write-scope guard (only the bound contentId) still applies.
    // Standalone/dev/no-context keeps the unwired placeholder, which fails
    // loudly instead of silently doing nothing (see bridgeOps.ts).
    if (this.agentLinkFeatureEnabled && globals.apWrapper) {
      const bridge = createForgeAgentLinkBridge({ apWrapper: globals.apWrapper });
      // Relay wiring (design §4.3): only in a real Forge runtime — cloudId
      // has no standalone-context equivalent (getStandaloneContext() never
      // sets one), so standalone/dev keeps the flag-on Connect UI usable
      // (state machine, activity feed) without a live relay channel behind it.
      let relay;
      if (forgeGlobal.isForge) {
        try {
          const ctx = await getContext();
          const pageId = await globals.apWrapper._getCurrentPageId();
          relay = {
            boundContext: {
              cloudId: ctx.cloudId,
              pageId: String(pageId),
              contentId: this.diagram.id,
            },
          };
        } catch (e) {
          console.error('Failed to resolve agent-link relay context:', e);
        }
      }
      this.agentLinkSession = markRaw(useAgentLinkSession(createBridgeOps(bridge, this.diagram.id), {
        macroType: this.diagramType || 'none',
        clickSurface: 'viewer',
        relay,
        onDiagramUpdated: (dsl, macroType) => this.applyAgentDiagramUpdate(dsl, macroType),
      }));
      // Track G: an INLINE (non-Fullscreen) mount may be a fresh iframe reload
      // that just lost a previous instance's live relay WS — forgeIndex.ts's
      // Fullscreen onClose calls `location.reload()` on this iframe
      // UNCONDITIONALLY, not only for an explicit Disconnect (see
      // attemptReattach()'s doc comment). Reattach to that instance's own
      // persisted session by the SAME token rather than resetting to idle.
      // Fullscreen-mode mounts must NEVER call this — they have their own
      // display-only hydration below (showAgentLinkPanel), and opening a
      // second relay socket here would violate "one live connection" (design
      // §3 decision #8).
      if (!this.isFullscreenMode) {
        this.agentLinkSession.attemptReattach();
      }
    }
    // Fullscreen hydration (finding #3, manual test 2026-07-08; finding #4,
    // live spot-check 2026-07-09): this mount may BE the separate Fullscreen
    // iframe/Vue-app instance that connectToAgent() opens (see that method's
    // comment) — freshly idle, with no token of its own. If the inline
    // instance already persisted a live session (sessionHandoff.ts), show it
    // instead of rendering ConnectPanel with nothing. hydrateFrom() is
    // display-only — never mints a second token or opens a second relay
    // socket — so this is safe to run unconditionally whenever the rail is
    // actually showing.
    //
    // DELIBERATELY NOT gated on `agentLinkFeatureEnabled && globals.apWrapper`
    // above: live spot-check found the Fullscreen modal iframe's `agentLinkSession`
    // stuck in 'idle' with a real session already sitting in localStorage —
    // that block (which builds the Forge-bridge-backed instance AND used to
    // own this hydration) doesn't reliably run the same way in the
    // Fullscreen iframe as it does inline. The rail is display-only; it
    // doesn't need the bridge/relay to show a token, so hydration must not
    // depend on that block having run.
    if (this.showAgentLinkPanel) {
      // pageId without apWrapper (finding #4): the block above resolves
      // relay.boundContext.pageId via `globals.apWrapper._getCurrentPageId()`,
      // which this hydration no longer waits on. Try the same synchronous,
      // apWrapper-free source copyLink() already uses (forgeContext is
      // populated during the app's boot, before any component mounts — see
      // forgeIndex.ts's initializeContext()/initForgeContext()). Fall back to
      // readAnySession()/watchForAnyHandoff() (sessionHandoff.ts) — a scan of
      // every `agentLinkSession:*` key for the freshest live one — when no
      // pageId is resolvable at all; there is normally exactly one active
      // session, so "freshest session, any pageId" is an acceptable stand-in.
      // Hydrate the current record immediately (so the token/prompt shows on
      // first paint), then ALWAYS keep watching. The handoff record starts
      // 'waiting' and later flips to 'connected' when an agent pairs (the
      // relay owner persists that via onAgentConnected). A one-shot hydrate on
      // a found record would miss that later update and the Fullscreen panel
      // would never reach 'connected' (no green border) even though
      // localStorage says connected. watchForHandoff() re-reads + hydrates
      // idempotently, so the extra immediate hydrate above is harmless.
      const pageId = window.forgeGlobal?.forgeContext?.extension?.content?.id;
      if (pageId != null) {
        const handoff = readSession(String(pageId));
        if (handoff) this.agentLinkSession.hydrateFrom(handoff);
        this._agentLinkHandoffUnsubscribe = this.agentLinkSession.watchForHandoff(String(pageId));
      } else {
        const handoff = readAnySession();
        if (handoff) this.agentLinkSession.hydrateFrom(handoff);
        this._agentLinkHandoffUnsubscribe = this.agentLinkSession.watchForAnyHandoff();
      }
    }
  },
  beforeUnmount() {
    // Cleans up the storage-event listener + poll interval started by
    // watchForHandoff() above (no-op if it was never set up, e.g. flag-off
    // or non-fullscreen).
    this._agentLinkHandoffUnsubscribe?.();
    this._agentLinkHandoffUnsubscribe = null;
  },
  methods: {
    retry() {
      location.reload();
    },
    async contactSupport() {
      const contentId = this.failedCustomContentId ?? '(unknown)';
      const ctx = window.forgeGlobal?.forgeContext ?? {};
      const extension = ctx?.extension ?? {};
      const payload = [
        "ZenUML couldn't display a diagram",
        `Custom content ID: ${contentId}`,
        `Page ID: ${extension?.content?.id ?? '(unknown)'}`,
        `Macro UUID: ${ctx?.localId ?? '(unknown)'}`,
        `Space key: ${getSpaceKey() || '(unknown)'}`,
        `Client domain: ${getClientDomain() || '(unknown)'}`,
        `Module key: ${ctx?.moduleKey ?? '(unknown)'}`,
        `App version: ${import.meta.env.VITE_APP_VERSION ?? '(unknown)'} (${import.meta.env.PRODUCT_TYPE ?? '(unknown)'})`,
        `Forge environment: ${ctx?.environmentType ?? ctx?.environment?.type ?? '(unknown)'}`,
        `Cloud ID: ${ctx?.cloudId ?? '(unknown)'}`,
        `Direct fetch status: ${this.loadError?.directFetchStatus ?? '(unknown)'}`,
        `Load error HTTP status: ${this.loadError?.httpStatus ?? '(unknown)'}`,
        `Load error code: ${this.loadError?.errorCode ?? '(unknown)'}`,
        `Load error class: ${this.loadError?.errorClass ?? '(unknown)'}`,
      ].join('\n');
      const ok = await this.copyToClipboard(payload);
      toast({
        message: ok
          ? 'Diagnostic info copied — paste into your ticket'
          : `Couldn't auto-copy. Content ID: ${contentId}`,
        duration: ok ? 6000 : 8000,
      });
      trackEvent('support_link_clicked', 'click', 'load_failed_generic', {
        content_id: String(this.failedCustomContentId ?? ''),
      });
      await new Promise(resolve => setTimeout(resolve, 1500));
      openUrl(SUPPORT_PORTAL_URL);
    },
    edit() {
      trackEvent('edit', 'click', 'editing');
      EventBus.$emit('edit');
    },
    // View Source panel (#333). Uses in-memory diagram DSL — no refetch.
    // Available to all viewers; do not gate on canUserEdit.
    openViewSource() {
      this.showSourcePanel = true;
      trackAnalyticsEvent('viewer_source_opened', {
        feature_area: 'macro',
        surface: 'viewer',
        macro_type: this.diagramType ?? 'none',
        has_edit_permission: !!this.canUserEdit,
      });
    },
    onViewSourceCopied() {
      trackAnalyticsEvent('viewer_source_copied', {
        feature_area: 'macro',
        surface: 'viewer',
        macro_type: this.diagramType ?? 'none',
        has_edit_permission: !!this.canUserEdit,
      });
    },
    // Connect-to-Agent affordance (design §5.1, §9): kicks off this mount's
    // local session state, then reuses the EXISTING, unmodified Fullscreen
    // open path (EventBus 'fullscreen' -> forgeIndex.ts's openModal). Forge
    // opens Fullscreen as a SEPARATE modal iframe (confirmed by onClose's
    // location.reload() on the underlying macro) — that iframe re-boots this
    // same component fresh, with its OWN useAgentLinkSession() instance. Real
    // state continuity across that boundary (so the rail shows the token this
    // click minted) is handled by sessionHandoff.ts's localStorage handoff +
    // this mount's own hydrateFrom() call above — see that file's header
    // comment for the fix and its same-origin assumption; see
    // docs/superpowers/specs/2026-07-08-live-agent-link-design.md §4.3.
    connectToAgent() {
      this.agentLinkSession?.startConnect();
      this.fullscreen();
    },
    onAgentLinkDisconnect() {
      this.agentLinkSession?.disconnect('user');
    },
    // Track G: "Revoke & re-link" — closes the current (possibly suspended
    // or stuck-with-a-dead-agent) session and immediately mints a fresh one.
    onAgentLinkRevoke() {
      this.agentLinkSession?.revokeAndRelink();
    },
    // Track H: "Reconnect" from the terminal (closed) notice — mints a fresh
    // session after an explicit Disconnect or TTL expiry. revokeAndRelink()
    // force-resets to 'idle' then startConnect()s, so it works even from the
    // absorbing 'closed' terminal state (a plain startConnect() would no-op).
    onAgentLinkReconnect() {
      this.agentLinkSession?.revokeAndRelink();
    },
    // Live Agent Link render fix: an agent's update_diagram op PERSISTS via
    // the Forge bridge (writeDiagram -> saveCustomContentV2), but that write
    // does nothing to the currently-mounted Vue app's state — nobody re-reads
    // Confluence after the initial load. The macro only redraws when
    // store.state.diagram.{code,mermaidCode,plantUmlCode} changes (see
    // Sequence.vue/Mermaid.vue/PlantUml.vue's `watch` on that field), which is
    // exactly the mechanism the in-app code editor uses (Editor.vue's
    // onEditorCodeChange: store.dispatch(getStoreUpdateAction(diagramType), newCode)).
    // Mirror that here so a relay-driven edit renders live, without a reload.
    applyAgentDiagramUpdate(dsl, macroType) {
      const type = macroType || this.diagramType;
      this.$store.dispatch(getStoreUpdateAction(type), dsl);
      // Track F: signal the composable once the COMPLETE new diagram has
      // actually painted (next tick after the store change the viewer watches),
      // so it clears the "thinking" overlay exactly when the new diagram is on
      // screen — never before — and measures a real view-layer render_ms.
      this.$nextTick(() => this.agentLinkSession?.notifyRenderSettled());
    },
    fullscreen() {
      trackEvent('fullscreen', 'click', 'viewing');
      trackAnalyticsEvent('fullscreen_opened', {
        feature_area: 'macro',
        surface: 'viewer',
        macro_type: this.diagramType ?? 'none',
        entry_point: 'page_view',
      });
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

/* ----- Live Agent Link mounting seam (flag-gated, see showAgentLinkPanel) --
   .viewer-body is a no-op wrapper (default block) when the rail is hidden —
   it changes nothing about layout/sizing for the flag-off / non-fullscreen
   path. It only becomes a two-column row when the Fullscreen Connect rail
   is actually showing. */
.viewer-body--with-agent-rail {
  display: flex;
  align-items: stretch;
  gap: 16px;
}
.viewer-body--with-agent-rail .viewer-surface { flex: 1 1 auto; min-width: 0; }

/* Track H: 316px rail per the design contract. The rail stretches to the row
   height (align-items:stretch above) and ConnectPanel owns its own internal
   scroll + pinned footer, so the aside itself doesn't scroll. */
.agent-link-rail {
  flex: 0 0 316px;
  width: 316px;
  border-left: 1px solid #E5E7EB;
  display: flex;
  min-height: 0;
}

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
  padding: 44px 24px;
  text-align: center;
  color: #374151;
}

.viewer-lf-icon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin-bottom: 16px;
  background: #F3F4F6;
  border-radius: 50%;
  color: #6B7280;
  flex-shrink: 0;
}

.viewer-lf-icon {
  width: 22px;
  height: 22px;
}

.viewer-lf-heading {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #111827;
  line-height: 1.3;
}

.viewer-lf-body {
  margin: 8px 0 0;
  max-width: 420px;
  text-align: center;
  font-size: 14px;
  color: #4B5563;
  line-height: 1.55;
}

.viewer-lf-actions {
  display: flex;
  gap: 8px;
  margin-top: 22px;
  flex-wrap: wrap;
  justify-content: center;
}

.viewer-lf-btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 16px;
  background: #0052CC;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 150ms ease;
}

.viewer-lf-btn-primary:hover {
  background: #0747A6;
}

.viewer-lf-btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 14px;
  background: #fff;
  color: #374151;
  border: 1px solid #D1D5DB;
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 150ms ease;
}

.viewer-lf-btn-secondary:hover {
  background: #F9FAFB;
}

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
