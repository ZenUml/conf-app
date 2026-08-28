<template>
<!-- screen-capture-content class is used in Attachment.ts to select the node. -->
<div class="generic viewer" :class="{'generic--source-panel-open': isFullscreenMode && showSourcePanel}">
  <!-- The debug strip is a dev affordance for the inline macro. In the
       fullscreen modal it stacks above .viewer-frame, which is min-height:100vh,
       so the page ends up taller than the viewport and scrolls; it also eats the
       top of a surface whose whole point is showing the diagram large. -->
  <Debug v-if="!isFullscreenMode" />
    <!-- Syntax errors are surfaced by the SyntaxErrorBox (with AI Repair); no
         "Submit a ticket" error panel here. -->
    <!-- Embed/portal hosts request a chrome-less surface — render the diagram only. -->
    <template v-if="!isDisplayMode || hideHeader">
      <div class="screen-capture-content" ref="captureNode" :class="{'w-full': isWide}">
        <slot></slot>
      </div>
    </template>

    <template v-else>
      <div class="viewer-frame" :class="{'viewer-frame--wide': isWide, 'viewer-frame--auto': !isWide, 'viewer-frame--fullscreen': isFullscreenMode}">
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
              <!-- Copy for AI split button: primary segment (one click = copy
                   with the generic prompt, job: 'generic') + chevron segment
                   opening a menu of five job-framed entry points (explain /
                   update / implement / audit / tests — CopyForAiMenu.vue).
                   Every entry copies the SAME diagram DSL + page-context
                   payload (buildCopyForAiPrompt.ts) — only the preamble
                   differs by job. Same gate as View Source (text-DSL types
                   only) — not restricted by edit permission or fullscreen,
                   mirroring that button's audience. -->
              <div v-if="showViewSource" class="copy-for-ai-split">
                <button
                  type="button"
                  class="viewer-btn-ghost copy-for-ai-split-primary"
                  :aria-label="copyForAiButtonLabel"
                  title="Copy diagram + page context for an AI agent"
                  data-testid="copy-for-ai-btn"
                  :data-copy-state="copyForAiState"
                  :disabled="copyForAiState === 'copying'"
                  :aria-busy="copyForAiState === 'copying'"
                  @click="copyForAi('generic')"
                >
                  <!-- Constant-width sizer: every possible label (icon+text pair)
                       is stacked in the same grid cell (grid-area: 1 / 1) so the
                       button's width is permanently the widest of the five —
                       identical in idle and through every transition. Only the
                       state matching copyForAiActiveLabelKey is visible
                       (visibility, not display:none, so it keeps sizing the
                       grid); the rest stay in the layout aria-hidden. The
                       button's own aria-label (above) already carries the
                       correct accessible name regardless of which cell is
                       visible. -->
                  <span class="copy-for-ai-label-stack">
                    <span
                      class="copy-for-ai-label-cell"
                      :data-active="copyForAiActiveLabelKey === 'idle' ? 'true' : 'false'"
                      :aria-hidden="copyForAiActiveLabelKey === 'idle' ? null : 'true'"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-icon" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.456-2.456L14.25 6l1.035-.259a3.375 3.375 0 0 0 2.456-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
                      </svg>
                      <span>Copy for AI</span>
                    </span>
                    <span
                      class="copy-for-ai-label-cell"
                      :data-active="copyForAiActiveLabelKey === 'copying' ? 'true' : 'false'"
                      :aria-hidden="copyForAiActiveLabelKey === 'copying' ? null : 'true'"
                    >
                      <span>Copying…</span>
                    </span>
                    <span
                      class="copy-for-ai-label-cell"
                      :data-active="copyForAiActiveLabelKey === 'copied' ? 'true' : 'false'"
                      :aria-hidden="copyForAiActiveLabelKey === 'copied' ? null : 'true'"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-icon" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      <span>Copied</span>
                    </span>
                    <span
                      class="copy-for-ai-label-cell"
                      :data-active="copyForAiActiveLabelKey === 'copy-failed' ? 'true' : 'false'"
                      :aria-hidden="copyForAiActiveLabelKey === 'copy-failed' ? null : 'true'"
                    >
                      <span>Copy failed</span>
                    </span>
                    <span
                      class="copy-for-ai-label-cell"
                      :data-active="copyForAiActiveLabelKey === 'nothing-to-copy' ? 'true' : 'false'"
                      :aria-hidden="copyForAiActiveLabelKey === 'nothing-to-copy' ? null : 'true'"
                    >
                      <span>Nothing to copy</span>
                    </span>
                  </span>
                </button>
                <CopyForAiMenu @select="copyForAi" @opened="onCopyForAiMenuOpened" />
                <!-- Mintlify-style inline feedback: the button's own label already
                     shows Copying…/Copied/Copy failed/Nothing to copy visibly, but a
                     visually-hidden live region also announces the terminal states
                     (Copied / Copy failed / Nothing to copy) for screen-reader users
                     who aren't focused on the button when it changes. 'copying' is
                     already communicated via aria-busy on the button itself, so it's
                     deliberately not echoed here. No toast anywhere in this flow (see
                     copyForAi()) — this replaces the old toast confirmation. -->
                <span class="sr-only" role="status" aria-live="polite" data-testid="copy-for-ai-announcement">{{ copyForAiAnnouncement }}</span>
              </div>
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
                <button v-if="hasRetryableFailure" type="button" class="viewer-lf-btn-primary" data-testid="load-failed-retry" @click="retry">
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
            <div v-else class="screen-capture-content" ref="captureNode" :class="{'w-full': isWide}">
              <slot></slot>
            </div>
            <div
              v-if="!isLoadFailed && (diagramAttribution || (architectureTokensEnabled && showRelatedDiagrams))"
              class="viewer-footer-row"
            >
              <RelatedDiagramsFooter
                v-if="architectureTokensEnabled && showRelatedDiagrams"
                :custom-content-id="relatedCustomContentId"
                :ready="viewerLoadState === 'ready'"
                :enabled="architectureTokensEnabled"
                :surface="isFullscreenMode ? 'fullscreen' : 'viewer'"
                :svg-host="getCaptureNode"
                :page-id="currentPageId"
              />
              <DiagramAttributionFooter
                v-if="diagramAttribution"
                :attribution="diagramAttribution"
                :macro-type="diagramType"
                :ready="viewerLoadState === 'ready'"
              />
            </div>
            <!-- Onboarding funnel "second diagram" prompt — build-time-gated,
                 defaults OFF (VITE_SECOND_DIAGRAM_PROMPT_ENABLED in
                 vite.config.mjs). See SecondDiagramPrompt.vue for the full
                 display-condition contract. -->
            <SecondDiagramPrompt
              v-if="!isLoadFailed"
              :attribution="diagramAttribution"
              :macro-type="diagramType"
              :ready="viewerLoadState === 'ready'"
              :current-account-id="currentAccountId"
            />

            <!-- Live Agent Link perceived-latency overlay (charter §6 Track F).
                 Flag-gated exactly like the Connect affordance so the flag-off
                 DOM is unchanged; renders nothing internally while idle. Shows
                 on BOTH surfaces (inline + Fullscreen) because both render this
                 .viewer-canvas — Fullscreen mirrors the state via the handoff. -->
            <ThinkingOverlay v-if="showAgentLinkThinking" :state="agentLinkThinking" />

            <div v-if="!isLoadFailed" class="viewer-edge-bottom-pill" role="toolbar" aria-label="Diagram actions">
              <!-- Graph viewer slots in multi-page nav (prev / X of Y / next) here. -->
              <slot name="pill-prefix"></slot>
              <!-- Diagram deeplink (task 6, docs/superpowers/sdd/
                   2026-07-26-embed-deeplink-productization): the supply side
                   of the autoConvert paste->embed flow. Only rendered when
                   both a custom content id exists (same isCustomContent gate
                   as Versions below) AND the variant has a mapped host
                   (deeplinkHostForProductType — asyncapi has none yet).
                   Reuses the slot freed by deleting the "Copy code" button
                   (same payload as the Source panel's Copy, at ~1/8th the
                   usage — see the task brief's Step 1 measurement). -->
              <button v-if="isCustomContent && deeplinkHost" @click="copyDeeplink" title="Copy diagram link" aria-label="Copy diagram link" class="viewer-pill-btn">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-icon">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.933 2.185 2.25 2.25 0 0 0-3.933-2.185Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
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
              <!-- Renamed from "Copy link" (was ambiguous once "Copy diagram
                   link" landed above) — same page-URL behavior and legacy
                   copy_link tracking, unchanged. -->
              <button @click="copyLink" title="Copy page link" aria-label="Copy page link" class="viewer-pill-btn">
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
          :fullscreen="isFullscreenMode"
          @close="showSourcePanel = false"
          @copy="onViewSourceCopied"
        />
      </div>
    </template>

  <ExportModal
    :visible="showExportModal"
    :macro-type="diagramType"
    :capture-node-getter="getCaptureNode"
    :diagram-title="title"
    @close="showExportModal = false"
  />
</div>
</template>

<script>
import {trackEvent} from "@/utils/window";
import { trackAnalyticsEvent, trackAnalyticsEventBeforeUnload } from "@/utils/analytics/trackAnalyticsEvent";

import { markRaw } from 'vue'
import {mapState, mapGetters} from "vuex";
import EventBus from '../../EventBus'
import Debug from '@/components/Debug/Debug.vue'
import globals from '@/model/globals';
import {DataSource, DiagramType} from "@/model/Diagram/Diagram";
import { getCodeFromDiagram, getStoreUpdateAction } from "@/model/Diagram/DiagramTypeConfig";
import ExportModal from '@/components/ExportModal/ExportModal.vue'
import OverflowMenu from '@/components/Viewer/OverflowMenu.vue'
import CopyForAiMenu from '@/components/Viewer/CopyForAiMenu.vue'
import ViewSourcePanel from '@/components/Viewer/ViewSourcePanel.vue'
import { toast } from '@/utils/toast'
import { buildCopyForAiPrompt } from '@/utils/copyForAi/buildCopyForAiPrompt'
import { htmlToPlainText } from '@/utils/htmlToPlainText'
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
import { isAgentLinkEnabled, isArchitectureTokensEnabled } from '@/apis/aiTitleFeatureFlag'
import forgeGlobal, { getContext, openUrl } from '@/model/globals/forgeGlobal'
import { getClientDomain, getSpaceKey } from '@/utils/ContextParameters/ContextParameters'
import { getForgeCustomContentId } from '@/utils/viewerLoadOutcome'
import { readRetryMarker, startRetryMarker, settleRetryMarker, clearRetryMarker, reloadViewer } from '@/utils/loadFailedRetry'
import { deeplinkHostForProductType, buildEmbedDeeplink } from '@/utils/embedDeeplink'
import DiagramAttributionFooter from '@/components/Viewer/DiagramAttributionFooter.vue'
import { getRenderIdentity } from '@/utils/analytics/renderIdentity'
import { recordSuccessfulCopyAttribution } from '@/utils/analytics/copyAttribution'
import SecondDiagramPrompt from '@/components/Viewer/SecondDiagramPrompt.vue'
import RelatedDiagramsFooter from '@/components/Viewer/RelatedDiagramsFooter.vue'

const DEFAULT_TITLE = 'Untitled diagram'
const SUPPORT_PORTAL_URL = 'https://zenuml.atlassian.net/servicedesk'

function isMermaidSequenceSource(source) {
  return /^\s*\uFEFF?\s*(?:---(?:\r?\n)[\s\S]*?(?:\r?\n)---\s*)?(?:(?:%%[^\r\n]*)(?:\r?\n|$)\s*)*sequenceDiagram(?:\s|$)/.test(source ?? '')
}

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
    // Copy for AI inline feedback state machine (Mintlify-style — replaces the
    // old shared-toast confirmation). 'idle' | 'copying' | 'copied' | 'failed'.
    // See setCopyForAiState()/copyForAi() below for the transitions and
    // copy-for-ai-announcement's doc comment above for the live-region pairing.
    copyForAiState: 'idle',
    copyForAiLabel: '',
    copyForAiAnnouncement: '',
    copyForAiRevertTimer: null,
    copyForAiImpressionTracked: false,
    copyForAiPermissionResolved: false,
    // Live Agent Link (docs/superpowers/specs/2026-07-08-live-agent-link-design.md)
    // master flag, resolved async in mounted(). Defaults false so the flag
    // controls the ENTIRE feature — until it resolves true, this macro
    // renders exactly as it does today.
    agentLinkFeatureEnabled: false,
    architectureTokensEnabled: false,
    agentLinkSession: null,
    loadFailedTelemetryEmitted: false,
    // Onboarding funnel "second diagram" prompt (SecondDiagramPrompt.vue):
    // the current viewer's Forge accountId, resolved once in mounted() so
    // the prompt's author-match check needs no extra context round-trip of
    // its own. null until resolved / on any resolve failure — the prompt
    // fails closed (no accountId, no match, no render).
    currentAccountId: null,
    retryOutcomeEmitted: false,
  }),
  components: {
    Debug,
    ExportModal,
    OverflowMenu,
    CopyForAiMenu,
    ViewSourcePanel,
    ConnectButton,
    ConnectPanel,
    LinkStatusChip,
    LiveBadge,
    ThinkingOverlay,
    DiagramAttributionFooter,
    SecondDiagramPrompt,
    RelatedDiagramsFooter,
  },
  computed: {
    ...mapState({
      diagramType: state => state.diagram.diagramType,
      diagram: state => state.diagram,
      viewerLoadState: state => state.viewerLoadState,
      loadError: state => state.loadError,
      diagramAttribution: state => state.diagramAttribution,
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
    showRelatedDiagrams() {
      const isSupportedDiagram = this.diagramType === DiagramType.Sequence
        || (this.diagramType === DiagramType.Mermaid && isMermaidSequenceSource(this.diagram?.mermaidCode));
      return isSupportedDiagram && Boolean(this.relatedCustomContentId);
    },
    relatedCustomContentId() {
      return getForgeCustomContentId() ?? this.diagramAttribution?.customContentId ?? '';
    },
    currentPageId() {
      return window.forgeGlobal?.forgeContext?.extension?.content?.id ?? undefined;
    },
    // Every macro on the page shares one sessionStorage (same Forge iframe
    // origin), so the retry marker is keyed on the macro's own localId. The
    // custom content id is the fallback for contexts that carry no localId.
    retryMarkerKey() {
      const ctx = window.forgeGlobal?.forgeContext ?? {};
      return String(ctx?.localId ?? this.failedCustomContentId ?? 'unknown_macro');
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
    // Deeplink mint host for this build's variant (task 6) — static per
    // PRODUCT_TYPE, so no need to re-derive per click. undefined for asyncapi
    // (deferred) hides the pill button entirely; see embedDeeplink.ts.
    deeplinkHost() {
      return deeplinkHostForProductType(import.meta.env.PRODUCT_TYPE);
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
        // Same-page duplicates reach this disabled state via the click-time
        // Edit gate (model/editDupGate.ts): saving from the in-viewer modal
        // would fork a new custom content (CustomContentStorageProvider.save /
        // saveCustomContentV2 count>1) that can never be written back into the
        // macro config (#170), silently stranding the edit — so steer to the
        // page editor, the one surface where the fork can be linked.
        : 'This is one of several copies of this diagram on this page. To edit it, open the page in edit mode and edit this macro there — it will become an independent diagram.';
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
    copyForAiImpressionEligible() {
      return this.copyForAiPermissionResolved
        && this.isDisplayMode
        && !this.hideHeader
        && !this.isLoadFailed
        && this.showViewSource;
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
    // Fence language for the "Copy for AI" markdown code block. Only
    // reachable when showViewSource is true (the button's gate), so the
    // default only exists to satisfy the type — it never observes a
    // non-text-DSL diagramType in practice.
    copyForAiFenceLang() {
      switch (this.diagramType) {
        case DiagramType.Mermaid: return 'mermaid';
        case DiagramType.PlantUml: return 'plantuml';
        case DiagramType.Sequence:
        default: return 'zenuml';
      }
    },
    // Copy for AI split-button primary segment's visible label + accessible
    // name — idle keeps the original static text, every other state shows
    // whatever setCopyForAiState() last set (Copying… / Copied / Copy failed
    // / Nothing to copy).
    copyForAiButtonLabel() {
      return this.copyForAiState === 'idle' ? 'Copy for AI' : this.copyForAiLabel;
    },
    // Selects which grid-stack cell (see the template) is the currently
    // visible one. Mirrors copyForAiButtonLabel's state->text mapping, but as
    // a fixed key: the 'failed' state carries two different possible labels
    // (empty-DSL guard vs. clipboard-write failure), and the sizer needs a
    // literal, always-present cell per label — not one cell whose text swaps
    // at runtime — so the button's width truly never changes.
    copyForAiActiveLabelKey() {
      if (this.copyForAiState !== 'failed') return this.copyForAiState;
      return this.copyForAiLabel === 'Nothing to copy' ? 'nothing-to-copy' : 'copy-failed';
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
    copyForAiImpressionEligible: {
      immediate: true,
      handler(eligible) {
        if (!eligible || this.copyForAiImpressionTracked) return;
        this.copyForAiImpressionTracked = true;
        trackAnalyticsEvent('copy_for_ai_impression', {
          feature_area: 'macro',
          surface: this.isFullscreenMode ? 'fullscreen' : 'viewer',
          macro_type: this.diagramType,
          has_edit_permission: !!this.canUserEdit,
          instance_nonce: getRenderIdentity().instance_nonce,
        });
      },
    },
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
        const failed = state === 'failed_with_source' || state === 'failed_without_source';
        if (state !== 'ready' && !failed) {
          return;
        }
        // A 'ready' here is only interesting as the answer to a retry — it is
        // the sole reason this watcher looks at the success state at all.
        this.reportRetryOutcome(state === 'ready' ? 'recovered' : 'failed_again');
        if (!failed) {
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
    } finally {
      this.copyForAiPermissionResolved = true;
    }
    try {
      // SecondDiagramPrompt's author-match display condition — fails closed
      // (stays null) on any resolve error, which the prompt already treats
      // as "not the creator".
      const ctx = await getContext();
      this.currentAccountId = ctx?.accountId ?? null;
    } catch (e) {
      console.error('Failed to resolve current accountId:', e);
    }
    try {
      this.agentLinkFeatureEnabled = await isAgentLinkEnabled();
    } catch (e) {
      console.error('Failed to load agent-link feature flag:', e);
      this.agentLinkFeatureEnabled = false;
    }
    try {
      this.architectureTokensEnabled = await isArchitectureTokensEnabled();
    } catch {
      this.architectureTokensEnabled = false;
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
    if (this.copyForAiRevertTimer) {
      clearTimeout(this.copyForAiRevertTimer);
      this.copyForAiRevertTimer = null;
    }
  },
  methods: {
    // Export PNG (code review): give ExportModal the actual DOM node instead
    // of a global document.querySelector('.screen-capture-content'), which
    // only worked by the accident of exactly one copy ever being mounted at
    // once. Same ref name on mutually exclusive branches resolves to
    // whichever one is actually rendered; null while the load-failed panel
    // has replaced the capture branch.
    getCaptureNode() {
      return this.$refs.captureNode ?? null;
    },
    // The reload on the last line aborts an XHR-transported event, so the click
    // goes out on the unload-safe path and the reload waits for it. Production
    // recorded 0 load_failed_retry_clicked against 1 load_failed_retry_resolved
    // on 2026-08-23 with the fire-and-forget call this replaces. A blocked or
    // failing beacon must never strand the user on the panel, hence the catch.
    async retry() {
      const attempt = startRetryMarker(this.retryMarkerKey);
      try {
        await trackAnalyticsEventBeforeUnload('load_failed_retry_clicked', {
          feature_area: 'macro',
          surface: 'viewer',
          macro_type: this.diagramType,
          content_id: String(this.failedCustomContentId ?? ''),
          retry_attempt: attempt,
        });
      } catch (e) {
        console.error('[analytics] retry click tracking failed', e);
      }
      reloadViewer();
    },
    // Runs on the OTHER side of that reload. Without it the panel's own
    // impression count cannot separate a transient content-fetch failure from
    // a diagram that is permanently unavailable.
    reportRetryOutcome(outcome) {
      if (this.retryOutcomeEmitted) {
        return;
      }
      const marker = readRetryMarker(this.retryMarkerKey);
      if (!marker || !marker.pending) {
        return;
      }
      this.retryOutcomeEmitted = true;
      trackAnalyticsEvent('load_failed_retry_resolved', {
        feature_area: 'macro',
        surface: 'viewer',
        macro_type: this.diagramType,
        content_id: String(this.failedCustomContentId ?? ''),
        retry_attempt: marker.attempt,
        retry_outcome: outcome,
      });
      if (outcome === 'recovered') {
        clearRetryMarker(this.retryMarkerKey);
      } else {
        // Keep the attempt count: the next click on this macro is attempt N+1.
        settleRetryMarker(this.retryMarkerKey);
      }
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
      const attribution = recordSuccessfulCopyAttribution({
        customContentId: getForgeCustomContentId(),
        source: 'view_source',
      });
      trackAnalyticsEvent('viewer_source_copied', {
        feature_area: 'macro',
        surface: 'viewer',
        macro_type: this.diagramType ?? 'none',
        has_edit_permission: !!this.canUserEdit,
        outcome: 'copied',
        copy_source: 'view_source',
        ...(attribution ? { copy_id: attribution.copy_id } : {}),
      });
    },
    onCopyForAiMenuOpened() {
      trackAnalyticsEvent('copy_for_ai_menu_opened', {
        feature_area: 'macro',
        surface: this.isFullscreenMode ? 'fullscreen' : 'viewer',
        macro_type: this.diagramType ?? 'none',
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
    // #442: Safari-safe clipboard write. MUST be called before any await in
    // the click task: the ClipboardItem is constructed synchronously with a
    // still-pending payload promise — the pattern WebKit supports for async
    // clipboard content, keeping the write tied to the user gesture.
    // Resolves false when the modern API is unavailable or the write is
    // rejected; the caller then retries via copyToClipboard's legacy order.
    writeClipboardKeepingActivation(resultPromise) {
      const supported = navigator.clipboard
        && typeof navigator.clipboard.write === 'function'
        && typeof window.ClipboardItem === 'function'
        && window.isSecureContext;
      if (!supported) return Promise.resolve(false);
      const item = new window.ClipboardItem({
        'text/plain': resultPromise.then(r => new Blob([r.text], { type: 'text/plain' })),
      });
      return navigator.clipboard.write([item]).then(() => true, (error) => {
        console.warn('copyForAi: ClipboardItem write rejected, falling back to legacy copy', error);
        return false;
      });
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
      // finally: execCommand can throw (e.g. no user activation); without it the
      // off-screen textarea leaks into the DOM on every failed copy.
      try {
        textarea.select();
        textarea.setSelectionRange(0, text.length);
        return document.execCommand('copy');
      } catch {
        return false;
      } finally {
        document.body.removeChild(textarea);
      }
    },
    // Mints and copies the bare embed deeplink (task 6). Fires
    // deeplink_copied ONCE per click, in a finally block, after the terminal
    // outcome is known — same outcome convention as copy_for_ai_clicked
    // (see that method below): 'copied' = clipboard write succeeded,
    // 'clipboard_failed' = the write itself returned false or threw,
    // 'unavailable' = the link couldn't even be minted (no host/contentId,
    // or cloudId unresolved) — three silent-failure paths that used to fire
    // the exact same event as success. cloudId comes from the Forge context
    // (getContext() memoizes and degrades to an unresolvable standalone
    // context outside Forge — see forgeGlobal.ts); contentId is the
    // diagram's custom content id, already gated present by the template's
    // isCustomContent check.
    async copyDeeplink() {
      let outcome;
      try {
        const host = this.deeplinkHost;
        const contentId = this.diagram.id;
        if (!host || !contentId) {
          outcome = 'unavailable';
          toast({ message: 'Diagram link not available', duration: 2000 });
          return;
        }
        const ctx = await getContext();
        const cloudId = ctx?.cloudId;
        if (!cloudId) {
          outcome = 'unavailable';
          toast({ message: 'Diagram link not available', duration: 2000 });
          return;
        }
        const url = buildEmbedDeeplink(host, cloudId, String(contentId));
        const ok = await this.copyToClipboard(url);
        outcome = ok ? 'copied' : 'clipboard_failed';
        toast({ message: ok ? 'Diagram link copied to clipboard' : 'Failed to copy diagram link', duration: 2000 });
      } catch (error) {
        console.error('copyDeeplink failed', error);
        outcome = 'clipboard_failed';
        toast({ message: 'Failed to copy diagram link', duration: 2000 });
      } finally {
        trackAnalyticsEvent('deeplink_copied', {
          feature_area: 'macro',
          surface: this.isFullscreenMode ? 'fullscreen' : 'viewer',
          macro_type: this.diagramType ?? 'none',
          link_source: 'viewer_pill',
          outcome,
        });
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
    // Shared page-URL lookup for copyLink and copyForAi's page context.
    // Dynamic import keeps the standalone (non-Forge) preview harness from
    // breaking at module load. Returns '' (not a throw) when the page has no
    // usable base+webui links; throws only on a failed lookup request.
    async resolvePageUrl(pageId) {
      const { requestConfluence } = await import('@forge/bridge');
      const res = await requestConfluence(`/wiki/api/v2/pages/${pageId}`);
      if (!res.ok) throw new Error(`Page lookup failed: ${res.status}`);
      const page = await res.json();
      const base = page._links?.base || '';
      const webui = page._links?.webui || '';
      return (base && webui) ? `${base}${webui}` : '';
    },
    async copyLink() {
      trackEvent('copy_link', 'click', 'viewing');
      try {
        const pageId = window.forgeGlobal?.forgeContext?.extension?.content?.id;
        if (!pageId) { toast({ message: 'Link not available', duration: 2000 }); return; }
        const url = await this.resolvePageUrl(pageId);
        if (!url) { toast({ message: 'Link not available', duration: 2000 }); return; }
        const ok = await this.copyToClipboard(url);
        toast({ message: ok ? 'Link copied to clipboard' : 'Failed to copy link', duration: 2000 });
      } catch (error) {
        console.error('copyLink failed', error);
        toast({ message: 'Failed to copy link', duration: 2000 });
      }
    },
    // Page context for "Copy for AI" — same read agentLink's readPage uses
    // (ApWrapper2.getCurrentPage() + _getCurrentPageId(), see
    // composables/agentLink/forgeBridge.ts's readPage). The page URL is
    // derived from that SAME response's _links (base+webui) rather than a
    // second /pages/{id} round trip via resolvePageUrl() — the v2 API
    // includes _links regardless of body-format (verified live). Returns
    // undefined only when the page fetch itself fails (standalone/dev with
    // no page context, a rejected request) so the caller falls back to a
    // diagram-only payload instead of blocking the copy. A page that fetched
    // fine but has no resolvable URL still comes back with url: '' — title +
    // text are real context on their own (buildCopyForAiPrompt omits the URL
    // line when url is empty).
    async resolveCopyForAiPage() {
      try {
        const currentPage = await globals.apWrapper.getCurrentPage();
        const text = htmlToPlainText(currentPage?.body?.export_view?.value || '');
        const base = currentPage?._links?.base || '';
        const webui = currentPage?._links?.webui || '';
        const url = (base && webui) ? `${base}${webui}` : '';
        return { title: currentPage?.title || '', url, text };
      } catch (error) {
        console.error('copyForAi: page context unavailable, falling back to diagram-only', error);
        return undefined;
      }
    },
    // Drives the Copy for AI split button's inline (Mintlify-style) feedback
    // state machine — idle -> copying -> copied|failed -> (revert) idle.
    // Clears any pending revert timer first so a fresh copy started while a
    // previous 'copied'/'failed' label is still showing (the button is only
    // disabled during 'copying', not during those terminal states) doesn't
    // get yanked back to idle by the OLD timer mid-flight. 'copied'/'failed'
    // arm a ~2s revert timer and update the visually-hidden live region
    // (copy-for-ai-announcement in the template) so screen-reader users not
    // focused on the button hear the outcome too; 'copying' is announced via
    // aria-busy on the button itself instead, so the live region is cleared
    // for it. beforeUnmount() clears this timer on unmount.
    setCopyForAiState(state, label) {
      if (this.copyForAiRevertTimer) {
        clearTimeout(this.copyForAiRevertTimer);
        this.copyForAiRevertTimer = null;
      }
      this.copyForAiState = state;
      this.copyForAiLabel = label;
      this.copyForAiAnnouncement = (state === 'copied' || state === 'failed') ? label : '';
      if (state === 'copied' || state === 'failed') {
        this.copyForAiRevertTimer = setTimeout(() => {
          this.copyForAiState = 'idle';
          this.copyForAiLabel = '';
          this.copyForAiAnnouncement = '';
          this.copyForAiRevertTimer = null;
        }, 2000);
      }
    },
    // "Copy for AI" (catalog.ts: copy_for_ai_clicked): writes the diagram DSL
    // (same source View Source shows) plus best-effort page context to the
    // clipboard as one plain-text payload, for pasting into an external AI
    // chat. `job` (default 'generic') selects which preamble
    // buildCopyForAiPrompt.ts opens the payload with — the split button's
    // primary segment passes 'generic' explicitly, CopyForAiMenu.vue's five
    // menu items pass their own job value on @select and drive this SAME
    // method, so the state machine below plays on the primary segment no
    // matter which entry point triggered it. Every job shares the exact same
    // clipboard/analytics outcome logic below; only the copied text and the
    // tracked `job` property vary. Page context is optional —
    // buildCopyForAiPrompt/resolveCopyForAiPage decide the fallback; this
    // method only decides the clipboard/analytics outcome.
    // Empty-DSL guard: no clipboard write and no analytics event, since an
    // empty copy carries no demand signal; the button surfaces "Nothing to
    // copy" instead of a toast. Overlapping-click guard: 'copying' disables
    // the button in the template, but also short-circuit here for
    // non-pointer activation paths (e.g. a held Enter key repeating faster
    // than Vue re-renders).
    async copyForAi(job = 'generic') {
      if (this.copyForAiState === 'copying') return;
      if (!this.viewSourceCode) { this.setCopyForAiState('failed', 'Nothing to copy'); return; }
      this.setCopyForAiState('copying', 'Copying…');
      // #442: the clipboard call must be issued in the click's own task.
      // Safari drops the transient user activation across an awaited fetch,
      // so the previous order (await page fetch, then write) threw
      // NotAllowedError on every Safari click. The payload is therefore
      // built as a promise and handed to the clipboard API synchronously via
      // writeClipboardKeepingActivation; no await may precede that call.
      const resultPromise = this.resolveCopyForAiPage().then(page => buildCopyForAiPrompt({
        dslLabel: this.viewSourceDslLabel,
        fenceLang: this.copyForAiFenceLang,
        diagramTitle: this.title,
        dsl: this.viewSourceCode,
        page,
        job,
      }));

      let ok = false;
      try {
        ok = await this.writeClipboardKeepingActivation(resultPromise);
      } catch (error) {
        console.error('copyForAi: activation-preserving clipboard write failed', error);
      }
      if (!ok) {
        // Legacy order (resolve payload first, then writeText/execCommand):
        // the only path for browsers without ClipboardItem, and the retry
        // when the modern write is rejected. On Safari a rejection here is
        // expected — the activation is already gone — and surfaces as
        // outcome=clipboard_failed, same as before this fix.
        try {
          const built = await resultPromise;
          ok = await this.copyToClipboard(built.text);
        } catch (error) {
          console.error('copyForAi: clipboard write failed', error);
          ok = false;
        }
      }

      const result = await resultPromise;
      let outcome;
      if (ok) {
        outcome = result.pageBytes > 0 ? 'copied' : 'copied_diagram_only';
        this.setCopyForAiState('copied', 'Copied');
      } else {
        outcome = 'clipboard_failed';
        this.setCopyForAiState('failed', 'Copy failed');
      }

      const attribution = ok
        ? recordSuccessfulCopyAttribution({
            customContentId: getForgeCustomContentId(),
            source: 'copy_for_ai',
            job,
          })
        : null;

      trackAnalyticsEvent('copy_for_ai_clicked', {
        feature_area: 'macro',
        surface: this.isFullscreenMode ? 'fullscreen' : 'viewer',
        macro_type: this.diagramType,
        outcome,
        dsl_bytes: result.dslBytes,
        page_bytes: result.pageBytes,
        job,
        copy_source: 'copy_for_ai',
        copy_job: job,
        ...(attribution ? { copy_id: attribution.copy_id } : {}),
      });
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

/* Fullscreen modal gets the whole browser viewport (Forge's autoResize is
   disabled there — see forgeIndex.ts), but .viewer-frame itself has no height
   rule, so a diagram shorter than the window left most of the screen a bare
   void beneath it (spotted once the View Source panel was fixed to actually
   fill that same viewport — the mismatch between a full-height panel and a
   content-height diagram card became visible). min-height ties the frame to
   the viewport; the flex chain lets .viewer-canvas absorb the extra space and
   center its (possibly short) diagram in it, without touching isWide's own
   width math above. */
.viewer-frame--fullscreen {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
/* height:100% here would need a DEFINITE height on .viewer-body, but
   min-height alone never makes a flex container's resolved size definite for
   percentage-resolution purposes — .viewer-surface's height would compute to
   auto and the centering below would never engage. Flex the whole chain
   instead so each level's size comes from layout, not a percentage. */
.viewer-frame--fullscreen .viewer-body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.viewer-frame--fullscreen .viewer-surface { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
.viewer-frame--fullscreen .viewer-canvas { flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; min-height: 0; }
/* .viewer-frame--fullscreen .viewer-body (0,2,0) would otherwise outrank
   .viewer-body--with-agent-rail (0,1,0) below and force its Connect-rail row
   back into a column. */
.viewer-frame--fullscreen .viewer-body--with-agent-rail { flex-direction: row; }

/* The Source panel is position:fixed in fullscreen (ViewSourcePanel.vue) —
   out of layout flow — so neither .viewer-frame--auto's fit-content+auto-
   margin centering nor .viewer-frame--wide's width:100% has any way to know
   the panel now covers part of the screen; both centered on the FULL width,
   landing the diagram visibly right of the actually-visible left pane.
   Reserving that same width as padding on the root shrinks the space both
   centering paths compute against, for either case, with one rule. Width
   must match ViewSourcePanel.vue's --fullscreen panel width (min(560px,
   45vw)) — kept as a literal in both files: Vue's scoped-style :root
   rewriting (:root becomes :root[data-v-xxx], which never matches the real
   root element) rules out sharing it via a CSS custom property. */
.generic--source-panel-open .viewer-frame--fullscreen {
  padding-right: min(560px, 45vw);
}

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

/* Copy for AI split button: primary segment (unchanged viewer-btn-ghost look,
   right corners squared off to join the chevron) + CopyForAiMenu.vue's own
   chevron trigger (left corners squared off, shares the primary's border).
   NOT `overflow: hidden` on the wrapper — CopyForAiMenu's popover is a
   descendant positioned outside this wrapper's own box (top: calc(100% +
   8px)) and must not be clipped by it. */
.copy-for-ai-split {
  display: inline-flex;
  align-items: stretch;
}
.copy-for-ai-split-primary {
  border-radius: 6px 0 0 6px;
}

/* Constant-width sizer (see the template comment above the button markup):
   every label cell shares grid-area 1/1, so the grid's own size — and with
   it the button's content-box width — is permanently the widest cell,
   independent of which one is visible. visibility:hidden (not display:none)
   keeps the inactive cells sized-but-invisible so they keep contributing to
   that measurement through every transition. */
.copy-for-ai-label-stack {
  display: grid;
  justify-items: center;
  align-items: center;
}
.copy-for-ai-label-cell {
  grid-area: 1 / 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.copy-for-ai-label-cell[data-active="false"] {
  visibility: hidden;
}

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

.viewer-footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.viewer-footer-row :deep(.diagram-attribution) { margin-left: auto; }
.viewer-frame--fullscreen .viewer-footer-row {
  position: absolute;
  left: 0;
  bottom: 0;
  border-top: 1px solid #E5E7EB;
  background: #fff;
  z-index: 1;
}
.viewer-footer-row:not(:empty) ~ .viewer-edge-bottom-pill { bottom: 44px; }

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
