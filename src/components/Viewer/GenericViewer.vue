<template>
<!-- screen-capture-content class is used in Attachment.ts to select the node. -->
<div ref="viewerRoot" class="generic viewer" :class="{'generic--source-panel-open': isFullscreenMode && showSourcePanel}">
  <!-- The debug strip is a dev affordance for the inline macro. In the
       fullscreen modal it stacks above .viewer-frame, which is min-height:100vh,
       so the page ends up taller than the viewport and scrolls; it also eats the
       top of a surface whose whole point is showing the diagram large. -->
  <Debug v-if="!isFullscreenMode" />
    <!-- Syntax errors are surfaced by the SyntaxErrorBox (with AI Repair); no
         "Submit a ticket" error panel here. -->
    <!-- Embed/portal hosts request a chrome-less surface — render the diagram only. -->
    <template v-if="!isDisplayMode || hideHeader">
      <div class="screen-capture-content" ref="captureNode" :class="{'w-full': isWide, 'screen-capture-content--uncapped': fullscreenUncappedDiagram}">
        <slot></slot>
      </div>
    </template>

    <template v-else>
      <div class="viewer-frame" :class="{'viewer-frame--wide': isWide, 'viewer-frame--auto': !isWide, 'viewer-frame--fullscreen': isFullscreenMode, 'viewer-frame--export-entry': isExportEntryModal, 'viewer-frame--menu-open': moreMenuOpen || copyForAiMenuOpen, 'viewer-frame--connect-mcp': showConnectMcpDialog}" :data-stage="isFullscreenMode ? null : headerStage">
        <!-- viewer-body is a plain wrapper (no layout of its own) unless the
             Fullscreen Connect rail is showing, in which case it becomes a
             two-column flex row — see .viewer-body--with-agent-rail below. -->
        <div class="viewer-body" :class="{'viewer-body--with-agent-rail': agentLinkRailReserved, 'viewer-body--with-sidebar': !!$slots['viewer-sidebar']}">
        <div class="viewer-surface" :class="{'viewer-surface--hover': isHovering, 'viewer-surface--revealed': headerRevealed}"
             @mouseenter="isHovering = true" @mouseleave="isHovering = false"
             @focusin="onHeaderFocusIn" @focusout="onHeaderFocusOut">
          <!-- Top edge: title (left) + actions (right). Inline, the actions
               collapse in stages as the title runs out of room — see
               updateHeaderStage() and src/utils/viewerHeaderLayout.ts; the
               stage is published as data-stage on .viewer-frame. -->
          <div class="viewer-edge-top" :style="headerTitleSpace == null || isFullscreenMode ? null : { '--viewer-title-max': `${headerTitleSpace}px` }">
            <div class="viewer-title-area">
              <!-- Fullscreen diagram-type chip (Fullscreen Viewer v2). Read-only
                   type indicator, NOT the editor's TabSwitcher: this surface has
                   no type to switch to, and TabSwitcher.vue writes the user's
                   preferred type to localStorage on click. Renders the same
                   pixels the design system's TabSwitcher produces when handed a
                   single active tab (tray + accent-tinted pill). Inline macros
                   keep their current title row untouched. -->
              <span v-if="fullscreenTypeChip" class="viewer-type-chip-tray" data-testid="viewer-type-chip">
                <span class="viewer-type-chip" :class="`viewer-type-chip--${fullscreenTypeChip.id}`">
                  <span class="viewer-type-chip-dot" aria-hidden="true"></span>
                  {{ fullscreenTypeChip.label }}
                </span>
              </span>
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
              <!-- Fullscreen: multi-page navigation (Graph) sits beside the title. -->
              <div v-if="isFullscreenMode && $slots['header-nav']" class="viewer-header-nav" role="group" aria-label="Diagram pages">
                <slot name="header-nav"></slot>
              </div>
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
            <div v-if="!isLoadFailed" class="viewer-top-actions" :class="{ 'viewer-top-actions--with-create': showCreateGuide }">
              <!-- Inline Refined toggle (staged header): one pressed/unpressed
                   button instead of Fullscreen's two-segment switch. Same
                   availability gate. Stays visible at rest while pressed. -->
              <button v-if="showInlineRefined" type="button" class="viewer-refined-toggle"
                :class="{ 'viewer-refined-toggle--pressed': magicActive }"
                data-testid="magic-toggle" aria-label="Refined layout"
                :disabled="!magicActive && (!diagram?.magic || magicPending)"
                :title="magicActive ? 'Layout refined with AI. Click to show original layout' : 'Show refined layout'"
                :aria-pressed="magicActive ? 'true' : 'false'" :aria-busy="magicPending ? 'true' : 'false'"
                @click="toggleMagic('manual')">
                <svg xmlns="http://www.w3.org/2000/svg" class="viewer-magic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m4.5 19.5 11-11 2 2-11 11a1.4 1.4 0 0 1-2-2Z" />
                  <path d="m18 2 .55 1.75L20.3 4.3l-1.75.55L18 6.6l-.55-1.75-1.75-.55 1.75-.55L18 2ZM21 10l.35 1.15L22.5 11.5l-1.15.35L21 13l-.35-1.15-1.15-.35 1.15-.35L21 10Z" />
                </svg>
                <span class="viewer-btn-label">Refined</span>
              </button>
              <!-- Inline: multi-page navigation (Graph) — always visible, not hover-gated. -->
              <div v-if="!isFullscreenMode && $slots['header-nav']" class="viewer-header-nav" role="group" aria-label="Diagram pages">
                <slot name="header-nav"></slot>
              </div>
              <slot name="viewer-actions"></slot>
              <div v-if="isFullscreenMode && diagramType === 'mermaid' && (magicAvailable || magicActive)" class="viewer-version-switch" role="group" aria-label="Diagram version">
                <button type="button" class="viewer-version-option viewer-version-magic"
                  :class="{ 'viewer-version-option--selected': magicActive, 'viewer-version-magic--available': magicAvailable && !magicActive }"
                  data-testid="magic-toggle" :disabled="!magicActive && (!diagram?.magic || magicPending)"
                  :title="magicActive || magicAvailable ? 'Layout refined with AI.' : 'Refined layout is unavailable for the current diagram'"
                  :aria-pressed="magicActive ? 'true' : 'false'" :aria-busy="magicPending ? 'true' : 'false'"
                  @click="!magicActive && toggleMagic('manual')">
                  <svg xmlns="http://www.w3.org/2000/svg" class="viewer-magic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="m4.5 19.5 11-11 2 2-11 11a1.4 1.4 0 0 1-2-2Z" />
                    <path d="m18 2 .55 1.75L20.3 4.3l-1.75.55L18 6.6l-.55-1.75-1.75-.55 1.75-.55L18 2ZM21 10l.35 1.15L22.5 11.5l-1.15.35L21 13l-.35-1.15-1.15-.35 1.15-.35L21 10Z" />
                  </svg>
                  <span>Refined<span class="viewer-version-long"> layout</span></span>
                </button>
                <button type="button" class="viewer-version-option"
                  :class="{ 'viewer-version-option--selected': !magicActive }" data-testid="original-toggle"
                  :aria-pressed="!magicActive ? 'true' : 'false'" title="Show original layout"
                  @click="magicActive && toggleMagic('manual')">Original<span class="viewer-version-long"> layout</span></button>
              </div>
              <span v-if="isFullscreenMode && diagramType === 'mermaid' && (magicAvailable || magicActive)" class="viewer-header-sep" aria-hidden="true"></span>
              <!-- View Source (#333): visible to ALL viewers, including users without
                   edit permission. Text-DSL types only (sequence / mermaid / plantuml). -->
              <button
                v-if="showViewSource"
                type="button"
                class="viewer-btn-ghost viewer-act-source"
                aria-label="Source"
                title="View source"
                data-testid="view-source-btn"
                :aria-expanded="showSourcePanel ? 'true' : 'false'"
                @click="toggleViewSource"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-icon" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
                </svg>
                <span class="viewer-btn-label">Source</span>
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
              <div v-if="showViewSource && !showAgentLinkConnect && copyForAiSlotSettled" class="copy-for-ai-split viewer-act-copy">
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
                      <span class="viewer-btn-label">Copy for AI</span>
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
                <CopyForAiMenu ref="copyForAiMenu" @select="copyForAi" @opened="onCopyForAiMenuOpened" @closed="copyForAiMenuOpen = false" />
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
              <!-- Connect MCP (agent-link flag on, agent-editable types, inline
                   only) takes the Copy for AI slot and opens ConnectMcpDialog
                   with the headless MCP setup and a prompt naming this diagram.
                   Stage 3 moves it into More, as it does Copy for AI. -->
              <button
                v-if="showAgentLinkConnect"
                type="button"
                class="viewer-btn-ghost viewer-act-connect-mcp"
                aria-label="Connect MCP"
                title="Connect MCP"
                data-testid="connect-mcp-btn"
                aria-haspopup="dialog"
                :aria-expanded="showConnectMcpDialog ? 'true' : 'false'"
                @click="openConnectMcpDialog('toolbar')"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-icon" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" :d="connectMcpIcon" />
                </svg>
                <span class="viewer-btn-label">Connect MCP</span>
              </button>
              <span v-if="showViewSource && !isFullscreenMode" class="viewer-header-sep viewer-act-sep" aria-hidden="true"></span>
              <!-- Fullscreen: the actions the inline macro keeps in More are
                   header buttons here (labels by viewport width, see CSS). -->
              <template v-if="isFullscreenMode">
                <button v-for="action in fullscreenHeaderActions" :key="action.id" type="button"
                  class="viewer-btn-ghost viewer-fs-act" :class="`viewer-fs-act--${action.id}`"
                  :aria-label="action.label" :title="action.label" @click="onFullscreenHeaderAction(action.id)">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-icon" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" :d="action.icon" />
                  </svg>
                  <span class="viewer-btn-label">{{ action.label }}</span>
                </button>
              </template>
              <OverflowMenu ref="moreMenu" class="viewer-act-more" trigger-label="More" menu-label="More actions"
                @opened="onMoreMenuOpened" @closed="moreMenuOpen = false">
                <template #default="{ close }">
                  <template v-for="(item, index) in moreMenuEntries" :key="`${item}-${index}`">
                    <div v-if="item === 'separator'" role="separator" class="overflow-menu-separator"></div>
                    <button
                      v-else
                      type="button"
                      role="menuitem"
                      tabindex="-1"
                      class="overflow-menu-item"
                      :data-testid="`more-menu-${item}`"
                      :disabled="item === 'debug' && isDownloadingDebug"
                      @click="onMoreMenuSelect(item, close)"
                    >
                      <span class="overflow-menu-item-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path :d="moreMenuMeta[item].icon" />
                        </svg>
                      </span>
                      <span>{{ moreMenuMeta[item].label }}</span>
                    </button>
                  </template>
                </template>
              </OverflowMenu>
              <button v-if="showEdit && !isFullscreenMode" :disabled="!!editDisabledReason" :title="editDisabledReason || 'Edit'" @click="edit" aria-label="Edit" class="viewer-btn-ghost viewer-act-edit">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-icon">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                </svg>
                <span class="viewer-btn-label">Edit</span>
              </button>
              <button v-if="!isFullscreenMode" @click="fullscreen" aria-label="Fullscreen" title="Fullscreen" class="viewer-btn-primary viewer-act-fullscreen">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="viewer-icon">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                </svg>
                <span class="viewer-btn-label">Fullscreen</span>
              </button>
              <!-- Create: opens the slash-command creation guide (src/features/createGuide).
                   Last in the row and visible without hover — a discovery affordance. -->
              <button
                v-if="showCreateGuide"
                type="button"
                class="viewer-btn-ghost viewer-btn-create viewer-act-create"
                aria-label="Create"
                title="Add a diagram to this page"
                aria-haspopup="dialog"
                @click="openCreateGuide"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor" class="viewer-icon">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                <span class="viewer-btn-label">Create</span>
              </button>
              <template v-if="isFullscreenMode">
                <span class="viewer-header-sep" aria-hidden="true"></span>
                <button type="button" class="viewer-fs-exit" aria-label="Exit fullscreen" title="Exit fullscreen"
                  data-testid="fullscreen-exit" @click="exitFullscreen">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </template>
            </div>
          </div>

          <!-- Inline layout survey (staged header): the Fullscreen disclosure's
               question, under the same feedback-generation gate. Retires a few
               seconds after a vote; a stored vote keeps it hidden. -->
          <div v-if="showInlineMagicSurvey" class="magic-layout-feedback magic-inline-survey" role="group" aria-label="Which layout do you prefer?" data-testid="magic-layout-feedback">
            <span>Which layout do you prefer?</span>
            <div class="magic-inline-survey-options">
              <button v-for="option in [{ value: 'magic', label: 'Refined' }, { value: 'original', label: 'Original' }, { value: 'no_preference', label: 'No preference' }]" :key="option.value" type="button"
                :aria-pressed="magicLayoutFeedback === option.value ? 'true' : 'false'"
                @click="selectMagicLayoutFeedback(option.value)">{{ option.label }}</button>
            </div>
            <span v-if="magicFeedbackThanked" class="magic-inline-survey-thanks" role="status" aria-live="polite">Thanks for sharing. You can change this anytime.</span>
          </div>

          <div v-if="magicFeedback" class="magic-feedback" role="status" aria-live="polite" data-testid="magic-feedback">{{ magicFeedback }}</div>
          <div v-if="isFullscreenMode && magicFeedbackGeneration && (magicActive || magicAvailable)" class="magic-disclosure" data-testid="magic-disclosure">
            <span v-if="magicActive">Same content, refined layout.</span>
            <div class="magic-layout-feedback" role="group" aria-label="Which layout do you prefer?" data-testid="magic-layout-feedback">
              <span>Which layout do you prefer?</span>
              <button v-for="option in [{ value: 'magic', label: 'Refined' }, { value: 'original', label: 'Original' }, { value: 'no_preference', label: 'No preference' }]" :key="option.value" type="button"
                :aria-pressed="magicLayoutFeedback === option.value ? 'true' : 'false'"
                @click="selectMagicLayoutFeedback(option.value)">{{ option.label }}</button>
              <span v-if="magicFeedbackThanked" role="status" aria-live="polite">Thanks for sharing. You can change this anytime.</span>
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


          <!-- Canvas -->
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
            <div v-else class="screen-capture-content" ref="captureNode" :class="{'w-full': isWide, 'screen-capture-content--uncapped': fullscreenUncappedDiagram}">
              <DiagramViewport v-if="magicActive" ref="magicViewport" macro-type="mermaid"
                label="Refined layout" content-class="mermaid-diagram flex justify-center" :html="magicSvg" />
              <slot v-else></slot>
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
                :diagram-host="getCaptureNode"
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


          </div>
        </div>
        <slot name="viewer-sidebar"></slot>
        <!-- Fullscreen Connect rail (design §5.1, §9) — only mounted when the
             flag is on, the diagram type is MVP-supported, and we're actually
             in the Fullscreen modal. See connectToAgent()'s comment: this
             panel is driven by ITS OWN useAgentLinkSession() instance
             (a fresh Vue app boot inside the Fullscreen modal's iframe). -->
        <aside
          v-if="showAgentLinkPanel"
          class="agent-link-rail"
          :class="{'agent-link-rail--collapsed': !agentLinkRailReserved}"
          data-testid="agent-link-fullscreen-rail"
        >
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
        <ConnectMcpDialog
          v-if="showAgentLinkConnect"
          :visible="showConnectMcpDialog"
          :diagram-title="title"
          :cloud-id="connectMcpTarget.cloudId"
          :page-id="connectMcpTarget.pageId"
          :content-id="connectMcpTarget.contentId"
          @close="closeConnectMcpDialog"
          @copy="onConnectMcpCopied"
        />
      </div>
    </template>

  <ExportModal
    ref="exportModal"
    :visible="showExportModal"
    :capture-ready="!isExportEntryModal || exportPreviewReady"
    :macro-type="diagramType"
    :capture-node-getter="getCaptureNode"
    :diagram-source="viewSourceCode"
    :diagram-title="title"
    :surface="isFullscreenMode ? 'fullscreen' : 'viewer'"
    @close="onExportModalClose"
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
import ConnectMcpDialog from '@/components/AgentLink/ConnectMcpDialog.vue'
import { RELAY_SESSIONS_ENABLED } from '@/composables/agentLink/connectInstructions'
import ConnectPanel from '@/components/AgentLink/ConnectPanel.vue'
import LinkStatusChip from '@/components/AgentLink/LinkStatusChip.vue'
import LiveBadge from '@/components/AgentLink/LiveBadge.vue'
import ThinkingOverlay from '@/components/AgentLink/ThinkingOverlay.vue'
import { useAgentLinkSession } from '@/composables/agentLink/useAgentLinkSession'
import { createBridgeOps, createUnwiredBridgeOps } from '@/composables/agentLink/bridgeOps'
import { createForgeAgentLinkBridge } from '@/composables/agentLink/forgeBridge'
import { readSession, readAnySession } from '@/composables/agentLink/sessionHandoff'
import { isAgentLinkEnabled, isArchitectureTokensEnabled, isCreateGuideEnabled } from '@/apis/aiTitleFeatureFlag'
import { createGuideVariant } from '@/features/createGuide/createGuideVariant'
import { openCreateGuide } from '@/features/createGuide/openCreateGuide'
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
import DiagramViewport from '@/components/Viewer/DiagramViewport.vue'
import { validateMagicArtifact } from '@/utils/magic/artifact'
import { callRemote } from '@/utils/requestUtil'
import { magicGenerationKey, readMagicPreference, readMagicFeedback, writeMagicPreference, writeMagicFeedback } from '@/utils/magic/localPreference'
import { claimInlineMagicWriteback } from '@/utils/magic/inlineWriteback'
import { viewerAccountKind } from '@/utils/magic/viewerAccount'
import { parseMermaidFlowchart } from '@/utils/mermaid/renderMermaid'
import { normalizeMermaidWhitespace } from '@/utils/mermaid/normalizeWhitespace'
import { attachPreparedSvgHighlights } from '../../../tools/mermaid-highlights/src/mermaid-highlights.mjs'
import { controlsWidth, maxHeaderStage, moreMenuItems, pickHeaderStage } from '@/utils/viewerHeaderLayout'

const DEFAULT_TITLE = 'Untitled diagram'
const SUPPORT_PORTAL_URL = 'https://zenuml.atlassian.net/servicedesk'

function isMermaidSequenceSource(source) {
  return /^\s*\uFEFF?\s*(?:---(?:\r?\n)[\s\S]*?(?:\r?\n)---\s*)?(?:(?:%%[^\r\n]*)(?:\r?\n|$)\s*)*sequenceDiagram(?:\s|$)/.test(source ?? '')
}

/**
 * Last-resort floor for an export-entry Fullscreen open. Every renderer now
 * reports readiness — 'diagramLoaded' from the text-DSL viewers,
 * 'viewerRenderSettled' from Graph and OpenAPI — so this fires only when a
 * renderer never reports at all (a crashed DrawIO boot, a SwaggerUI throw).
 * Long enough that a slow-but-working render reports first: DrawIO's own boot
 * measured ~6s on production (MEMORY reference_graph_macro_load_anatomy).
 */
const EXPORT_AUTO_OPEN_FALLBACK_MS = 15000;

// How long the inline layout survey keeps its thank-you before retiring.
const INLINE_SURVEY_THANKS_MS = 4000;

// Header More-menu / Fullscreen header actions. Icon paths are the ones the
// removed bottom pill and the staged-header prototype use, verbatim.
const ICON_PATHS = {
  code: 'M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5',
  spark: 'M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.456-2.456L14.25 6l1.035-.259a3.375 3.375 0 0 0 2.456-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z',
  share: 'M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.933 2.185 2.25 2.25 0 0 0-3.933-2.185Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z',
  download: 'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3',
  clock: 'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  link: 'M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244',
  // Official Model Context Protocol mark, as its three stroke centerlines
  // scaled to this 24px grid so it takes the same stroke weight as the rest.
  mcp: 'M2.05 11.25L11.49 1.81C12.79 0.51 14.91 0.51 16.21 1.81C17.51 3.11 17.51 5.23 16.21 6.53L9.08 13.66M9.18 13.56L16.21 6.53C17.51 5.23 19.63 5.23 20.93 6.53L20.98 6.58C22.28 7.88 22.28 10 20.98 11.3L12.44 19.84C12.01 20.27 12.01 20.98 12.44 21.41L14.19 23.17M13.85 4.17L6.87 11.15C5.56 12.46 5.56 14.57 6.87 15.87C8.17 17.18 10.28 17.18 11.59 15.87L18.57 8.89',
  bug: 'M9 4.5a3 3 0 0 1 6 0M5 8h14M7 8v6a5 5 0 0 0 10 0V8M4 11h3M17 11h3M5 17l-1.5 2M19 17l1.5 2M12 14v6m0 0-2.25-2.25M12 20l2.25-2.25',
};
const MORE_MENU_META = {
  'source': { label: 'Source', icon: ICON_PATHS.code },
  'copy-for-ai': { label: 'Copy for AI', icon: ICON_PATHS.spark },
  'connect-mcp': { label: 'Connect MCP', icon: ICON_PATHS.mcp },
  'copy-diagram-link': { label: 'Copy diagram link', icon: ICON_PATHS.share },
  'copy-page-link': { label: 'Copy page link', icon: ICON_PATHS.link },
  'export-png': { label: 'Export PNG', icon: ICON_PATHS.download },
  'versions': { label: 'Versions', icon: ICON_PATHS.clock },
  'debug': { label: 'Download debug info', icon: ICON_PATHS.bug },
};

export default {
  name: "GenericViewer",
  // hideEdit: callers that render a reference to content they shouldn't edit
  // in place (e.g. the AsyncAPI embed macro) suppress the Edit pencil entirely.
  // Editing the source happens at the origin; re-targeting which doc is
  // embedded is a page-editor (macro-config) operation.
  props: {
    wide: Boolean,
    hideHeader: Boolean,
    hideEdit: Boolean,
    relationshipHighlights: { type: Boolean, default: false },
  },
  emits: ['capture-mode-change', 'magic-highlight-ready', 'magic-highlight-used'],
  data: () => ({
    canUserEdit: true,
    isHovering: false,
    // Staged header (see updateHeaderStage): collapse stage 0-3 of the inline
    // header, and what besides hover keeps its actions revealed.
    headerStage: 0,
    // Width the title gets at that stage. It caps the title, because on a
    // fit-content frame an uncapped nowrap title is the header's min-content
    // and would widen the card past the page column.
    headerTitleSpace: null,
    headerFocusWithin: false,
    moreMenuOpen: false,
    copyForAiMenuOpen: false,
    showExportModal: false,
    // Export-entry auto-open bookkeeping (see mounted / openExportOnce).
    exportAutoOpened: false,
    exportAutoOpenTimer: null,
    exportPreviewReady: false,
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
    // Connect MCP dialog (ConnectMcpDialog.vue) — inline only.
    showConnectMcpDialog: false,
    connectMcpOpenedAt: 0,
    // Set once isAgentLinkEnabled() settles either way (see copyForAiSlotSettled).
    agentLinkFlagResolved: false,
    copyForAiPermissionResolved: false,
    // Live Agent Link (docs/superpowers/specs/2026-07-08-live-agent-link-design.md)
    // master flag, resolved async in mounted(). Defaults false so the flag
    // controls the ENTIRE feature — until it resolves true, this macro
    // renders exactly as it does today.
    agentLinkFeatureEnabled: false,
    architectureTokensEnabled: false,
    createGuideFeatureEnabled: false,
    createGuideImpressionTracked: false,
    agentLinkSession: null,
    loadFailedTelemetryEmitted: false,
    // Onboarding funnel "second diagram" prompt (SecondDiagramPrompt.vue):
    // the current viewer's Forge accountId, resolved once in mounted() so
    // the prompt's author-match check needs no extra context round-trip of
    // its own. null until resolved / on any resolve failure — the prompt
    // fails closed (no accountId, no match, no render).
    currentAccountId: null,
    retryOutcomeEmitted: false,
    magicActive: false,
    magicSvg: null,
    magicHighlightController: null,
    magicHighlightCleanup: null,
    magicPending: false,
    magicGeneration: 0,
    magicStartedAt: null,
    magicFeedback: '',
    magicAvailable: false,
    magicCloudId: null,
    magicIdentityReady: false,
    magicInitializing: false,
    magicInitializeAttempt: 0,
    magicAvailabilityReported: [],
    magicWritebackAttempts: [],
    magicDefaultReported: [],
    magicSessionChoice: null,
    magicSessionChoiceKey: null,
    magicLayoutFeedback: null,
    magicPreviousFeedback: null,
    magicFeedbackGeneration: null,
    magicFeedbackThanked: false,
    magicFeedbackPrompted: {},
    magicThanksTimer: null,
  }),
  components: {
    Debug,
    ExportModal,
    OverflowMenu,
    CopyForAiMenu,
    DiagramViewport,
    ViewSourcePanel,
    ConnectMcpDialog,
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
    // Inline header actions show on hover, while keyboard focus is inside the
    // macro, or while one of its menus is open (a menu must not vanish when
    // the pointer leaves for it).
    headerRevealed() {
      return this.isHovering || this.headerFocusWithin || this.moreMenuOpen || this.copyForAiMenuOpen;
    },
    // Same availability gate as Fullscreen's version switch.
    showInlineRefined() {
      return !this.isFullscreenMode && this.diagramType === DiagramType.Mermaid
        && (this.magicAvailable || this.magicActive);
    },
    // Same feedback-generation gate as Fullscreen's magic-disclosure; hidden
    // once this viewer has a stored vote, except while thanking for it.
    showInlineMagicSurvey() {
      return this.showInlineRefined && !!this.magicFeedbackGeneration
        && (this.magicPreviousFeedback == null || this.magicFeedbackThanked);
    },
    // Only the parts of the header whose width depends on the stage; the rest
    // (chips, Connect, Create, slot actions, page nav) is measured as-is.
    headerModel() {
      return {
        hasSource: this.showViewSource,
        magic: this.showInlineRefined,
        pages: 0,
        hasEdit: this.showEdit && !this.isFullscreenMode,
      };
    },
    // Anything that changes the header's content without resizing the viewer.
    headerLayoutSignature() {
      return JSON.stringify([this.title, this.headerModel, this.showCreateGuide, this.showAgentLinkConnect,
        this.showAgentLinkBadge, this.isEmbedded, !!this.diagram?.recoveredFromOrphan, this.isLoadFailed]);
    },
    moreMenuEntries() {
      return moreMenuItems({
        stage: this.headerStage,
        hasSource: this.showViewSource,
        connectMcp: this.showAgentLinkConnect,
        isCustomContent: this.isCustomContent,
        hasDeeplinkHost: !!this.deeplinkHost,
        fullscreen: this.isFullscreenMode,
      });
    },
    moreMenuMeta() {
      return MORE_MENU_META;
    },
    // Fullscreen header buttons, in the prototype's order. Source and Copy for
    // AI keep their own (existing) buttons ahead of these.
    fullscreenHeaderActions() {
      const actions = [];
      if (this.isCustomContent && this.deeplinkHost) actions.push({ id: 'diagram-link', label: 'Diagram link', icon: ICON_PATHS.share });
      actions.push({ id: 'page-link', label: 'Page link', icon: ICON_PATHS.link });
      actions.push({ id: 'export-png', label: 'Export PNG', icon: ICON_PATHS.download });
      if (this.isCustomContent) actions.push({ id: 'versions', label: 'Versions', icon: ICON_PATHS.clock });
      return actions;
    },
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
    // This modal was opened BY Export PNG (forgeIndex's fullscreen handler puts
    // the flag in the modal context), not by someone asking for Fullscreen.
    isExportEntryModal() {
      return this.isFullscreenMode
        && window.forgeGlobal?.forgeContext?.extension?.modal?.openExport === true;
    },
    // Mermaid-only fullscreen fix. In the fullscreen modal `wide` is false (it's
    // wired to autoResize), so the frame is .viewer-frame--auto (width: fit-content).
    // ONLY mermaid breaks there: its SVG is width:100% with no intrinsic px, so in a
    // shrink-to-fit parent it collapses to the CSS default 300px. sequence (ZenUML,
    // explicit px) and plantuml (plantuml.com svg, explicit px) wrap correctly and stay
    // centered via fit-content — forcing THEM wide would left-align them. So only widen
    // the frame for mermaid; everything else keeps its centered fit-content behavior.
    isWide() {
      return this.diagramType === DiagramType.Markdown || this.wide || (this.isFullscreenMode && this.diagramType === DiagramType.Mermaid);
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
    // (deferred) hides the Copy diagram link menu item; see embedDeeplink.ts.
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
      return [DiagramType.Sequence, DiagramType.Mermaid, DiagramType.PlantUml, DiagramType.Markdown].includes(this.diagramType);
    },
    copyForAiImpressionEligible() {
      return this.copyForAiPermissionResolved
        && this.isDisplayMode
        && !this.hideHeader
        && !this.isLoadFailed
        && this.showViewSource
        && this.copyForAiSlotSettled
        && !this.showAgentLinkConnect;
    },
    // Fullscreen-only diagram-type indicator (Fullscreen Viewer v2). Fullscreen
    // drops Edit and Fullscreen from the action row and the Confluence modal
    // owns the close button, so the header has room the inline macro doesn't —
    // and unlike the inline macro, whose Confluence context surrounds it, the
    // fullscreen modal is the whole screen with nothing else naming the type.
    // Only the five types the accent system defines (colors_and_type.css's
    // --accent-<sequence|mermaid|plantuml|drawio|openapi>-* ramps, which the
    // design's TABS map names one-for-one). Graph and OpenAPI reach this
    // component through ForgeGraphViewer.vue / OpenApiViewer.vue, which wrap
    // GenericViewer for their own chrome, so the chip names them on the same
    // fullscreen surface. AsyncAPI and Embed have no accent and get no chip
    // rather than an invented one.
    fullscreenTypeChip() {
      if (!this.isFullscreenMode) return null;
      switch (this.diagramType) {
        case DiagramType.Sequence: return { id: 'sequence', label: 'Sequence' };
        case DiagramType.Markdown: return { id: 'markdown', label: 'Markdown' };
        case DiagramType.Mermaid: return { id: 'mermaid', label: 'Mermaid' };
        case DiagramType.PlantUml: return { id: 'plantuml', label: 'PlantUML' };
        case DiagramType.Graph: return { id: 'graph', label: 'Graph' };
        case DiagramType.OpenApi: return { id: 'openapi', label: 'OpenAPI' };
        default: return null;
      }
    },
    viewSourceCode() {
      return getCodeFromDiagram(this.diagram, this.diagramType) || '';
    },
    viewSourceDslLabel() {
      switch (this.diagramType) {
        case DiagramType.Markdown: return 'Markdown';
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
        case DiagramType.Markdown: return 'markdown';
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
    // The Copy for AI slot renders only once it is known not to be Connect
    // MCP's: on an inline agent-editable macro that waits for the async flag,
    // so Copy for AI never flashes and then swaps out. Fullscreen and the other
    // text types never show Connect MCP, so they need not wait.
    copyForAiSlotSettled() {
      return this.agentLinkFlagResolved || this.isFullscreenMode || !this.agentLinkMvpSupported;
    },
    connectMcpIcon() {
      return ICON_PATHS.mcp;
    },
    // The ids the headless tools take (read_diagram / update_diagram), so the
    // prompt sends the agent straight to this diagram. All synchronous: the
    // Forge context is populated during app boot.
    connectMcpTarget() {
      const ctx = window.forgeGlobal?.forgeContext ?? {};
      return {
        cloudId: ctx.cloudId ?? '',
        pageId: this.currentPageId ? String(this.currentPageId) : '',
        contentId: getForgeCustomContentId() ?? this.diagram?.id ?? '',
      };
    },
    createGuideVariant() {
      return createGuideVariant(this.diagramType);
    },
    // Lite only: the recorded guides show the Lite macro titles. Users who cannot edit the
    // page cannot insert a macro, so the guide would teach a dead end. The first three gates are
    // the action row's own, so the impression never counts a viewer whose row is not rendered
    // (editor preview, macro configuration, load failure).
    showCreateGuide() {
      return this.isDisplayMode
        && !this.hideHeader
        && !this.isLoadFailed
        && (this.createGuideFeatureEnabled || import.meta.env.DEV)
        && !!forgeGlobal.isLite
        && this.createGuideVariant !== null
        && !!this.canUserEdit
        && !this.hideEdit
        && !this.isFullscreenMode;
    },
    // Collapsed (non-fullscreen) "● live" indicator (design §3 decision #8).
    showAgentLinkBadge() {
      return RELAY_SESSIONS_ENABLED && this.agentLinkFeatureEnabled && this.agentLinkMvpSupported && !this.isFullscreenMode;
    },
    // The Fullscreen Connect rail (design §5.1 ConnectPanel / §9).
    showAgentLinkPanel() {
      return RELAY_SESSIONS_ENABLED && this.agentLinkFeatureEnabled && this.agentLinkMvpSupported && this.isFullscreenMode;
    },
    // The fullscreen column is capped at 1000px so the byline under the diagram keeps a
    // readable line length. That reasoning is about TEXT, so it holds for the types whose
    // content is text the reader tracks line by line (sequence, openapi) and not for the
    // rendered-picture types. Measured on lite-stg in a 1280px window:
    // PlantUML hands back a fixed-size image (6228px on the #626 repro) that overflows
    // the column and scrolls, so capping only makes it scroll sooner; Graph scales to its
    // container (a 1008px board drawn into exactly 1000px), so capping only makes it
    // smaller. Both spend the window's remaining ~230px on nothing. .viewer-footer-row
    // keeps the cap, so the byline stays readable — it just no longer shares the
    // diagram's right edge, which an overflowing diagram does not have on screen anyway.
    //
    // Mermaid was grouped with the text types here and left capped. That was a misread:
    // a mermaid flowchart is a rendered picture, not lines of text a reader tracks, and
    // it behaves exactly like Graph — normalizeSvgSizing hands it width:100% with
    // max-width at the diagram's natural width, so it scales DOWN into whatever column
    // it is given, and the viewer has no zoom control to win that size back. Measured in
    // a 1920px window: the mermaid column was 1000px where PlantUML got 1864px, so a
    // diagram wider than 1000px was shrunk while 920px of the window sat empty
    // (ZEN-1207). Uncapped it draws at its natural width and stops there.
    fullscreenUncappedDiagram() {
      if (!this.isFullscreenMode) return false;
      return [DiagramType.PlantUml, DiagramType.Graph, DiagramType.Mermaid].includes(this.diagramType);
    },
    // Whether the rail actually takes its 316px of the fullscreen width. ConnectPanel
    // has no `idle` branch — before a session exists it renders nothing — and the only
    // way to start one is the small-macro Connect button, which is hidden in
    // fullscreen. Reserving the column anyway left a blank 332px strip beside the
    // diagram, so a wide PlantUML diagram began scrolling long before it ran out of
    // window. The aside stays mounted (it owns the session composable that hydrates
    // an existing session on load); only its width collapses.
    agentLinkRailReserved() {
      return this.showAgentLinkPanel && this.agentLinkState !== 'idle';
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
    showExportModal: {
      flush: 'sync',
      handler(active) {
        this.$emit('capture-mode-change', active);
        if (active) this.clearMagicHighlights();
        else if (this.magicActive) this.$nextTick(this.installMagicHighlights);
      },
    },
    relationshipHighlights() {
      this.clearMagicHighlights();
      if (this.magicActive) this.$nextTick(this.installMagicHighlights);
    },
    showCreateGuide: {
      immediate: true,
      handler(shown) {
        if (!shown || this.createGuideImpressionTracked) return;
        this.createGuideImpressionTracked = true;
        trackAnalyticsEvent('create_guide_impression', {
          feature_area: 'macro',
          surface: 'viewer',
          macro_type: this.diagramType ?? 'none',
          create_guide_variant: this.createGuideVariant,
        });
      },
    },
    headerLayoutSignature() { this.$nextTick(this.scheduleHeaderLayout); },
    'diagram.mermaidCode'() { this.resetMagic(); this.$nextTick(this.initializeMagic); },
    diagramType() { this.resetMagic(); this.$nextTick(this.initializeMagic); },
    'diagram.magic'() { this.resetMagic(); this.$nextTick(this.initializeMagic); },
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
    // Escape dismisses one layer at a time: the Copy-for-AI menu first, then
    // the Source panel (Fullscreen Viewer v2). CopyForAiMenu.vue has its own
    // document-level Escape handler and calls stopPropagation(), which does
    // NOT stop a second listener on that same node — and because a child's
    // mounted() runs before its parent's, the menu would already have set
    // itself closed by the time this ran, so reading its state in the bubble
    // phase can't distinguish "menu was open" from "menu was never open".
    // Capture runs before either bubble listener, so the state read here is
    // the state at keypress.
    document.addEventListener('keydown', this.onEscapeKeydown, true);
    this.startHeaderLayout();
    // Export entry (see openExport): the modal was opened BY the Export PNG
    // button, so the dialog opens here on arrival. On 'diagramLoaded', not on
    // mount — the dialog captures its preview off the `visible` watcher, and
    // at mount the renderer has not painted yet, so the user would land on a
    // blank preview and a Refresh click. Graph and OpenAPI emit no such event;
    // they keep the button.
    if (this.isExportEntryModal) {
      // Cover the ungated Fullscreen viewer immediately. Preview capture waits
      // for the readiness signals below, but viewer-only controls must never be
      // exposed during that wait.
      this.showExportModal = true;
      // Two readiness signals, one per renderer family: the text-DSL viewers
      // emit 'diagramLoaded', Graph and OpenAPI emit 'viewerRenderSettled'
      // once their own output has painted. The dialog captures its preview the
      // moment it becomes visible, so opening before either would capture an
      // empty container.
      EventBus.$on('diagramLoaded', this.onDiagramLoadedOpenExport);
      EventBus.$on('viewerRenderSettled', this.onDiagramLoadedOpenExport);
      // Last resort, not the normal path: a renderer that never reports (a
      // crashed DrawIO boot, a SwaggerUI that throws) would otherwise leave the
      // user in Fullscreen with no dialog and no way to reach one.
      this.exportAutoOpenTimer = setTimeout(this.openExportOnce, EXPORT_AUTO_OPEN_FALLBACK_MS);
    }
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
      this.magicCloudId = ctx?.cloudId ?? null;
    } catch (e) {
      console.error('Failed to resolve current accountId:', e);
    } finally {
      this.magicIdentityReady = true;
      this.initializeMagic();
    }
    try {
      this.agentLinkFeatureEnabled = await isAgentLinkEnabled();
    } catch (e) {
      console.error('Failed to load agent-link feature flag:', e);
      this.agentLinkFeatureEnabled = false;
    } finally {
      this.agentLinkFlagResolved = true;
    }
    try {
      this.architectureTokensEnabled = await isArchitectureTokensEnabled();
    } catch {
      this.architectureTokensEnabled = false;
    }
    this.createGuideFeatureEnabled = await isCreateGuideEnabled();
    // Live Agent Link real bridge (design §4.2/§4.4): once the flag resolves
    // ON and a real Forge-bridge context (globals.apWrapper) is available,
    // swap the placeholder for the ApWrapper2-backed bridge so writeDiagram
    // actually persists via saveCustomContentV2 — wrapped in createBridgeOps
    // so the write-scope guard (only the bound contentId) still applies.
    // Standalone/dev/no-context keeps the unwired placeholder, which fails
    // loudly instead of silently doing nothing (see bridgeOps.ts).
    if (RELAY_SESSIONS_ENABLED && this.agentLinkFeatureEnabled && globals.apWrapper) {
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
    this.headerResizeObserver?.disconnect();
    this.headerResizeObserver = null;
    if (this.magicThanksTimer) {
      clearTimeout(this.magicThanksTimer);
      this.magicThanksTimer = null;
    }
    this.clearMagicHighlights();
    this.magicGeneration++;
    document.removeEventListener('keydown', this.onEscapeKeydown, true);
    EventBus.$off('diagramLoaded', this.onDiagramLoadedOpenExport);
    EventBus.$off('viewerRenderSettled', this.onDiagramLoadedOpenExport);
    if (this.exportAutoOpenTimer) {
      clearTimeout(this.exportAutoOpenTimer);
      this.exportAutoOpenTimer = null;
    }
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
    magicIdentity(sourceHash) {
      return { accountId: this.currentAccountId, cloudId: this.magicCloudId,
        contentId: this.diagram?.id, sourceHash };
    },
    magicSessionKey(sourceHash) {
      const id = this.magicIdentity(sourceHash);
      return JSON.stringify([id.accountId, id.cloudId, id.contentId, id.sourceHash]);
    },
    persistMagicChoice(choice, sourceHash) {
      this.magicSessionChoice = choice;
      this.magicSessionChoiceKey = this.magicSessionKey(sourceHash);
      const persistent = writeMagicPreference(this.magicIdentity(sourceHash), choice);
      this.magicEvent('magic_preference_changed', {
        magic_preference: choice, magic_preference_storage: persistent ? 'persistent' : 'session',
      });
    },
    reportMagicAssessment(eventName, propertyName, value, source, artifact) {
      if (this.diagramType !== DiagramType.Mermaid || (this.diagram?.mermaidCode ?? '') !== source
        || this.diagram?.magic !== artifact) return;
      const reported = eventName === 'magic_availability_checked'
        ? this.magicAvailabilityReported : this.magicDefaultReported;
      const contentId = this.diagram?.id;
      if (reported.some(item => item.source === source && item.artifact === artifact && item.contentId === contentId)) return;
      reported.push({ source, artifact, contentId });
      this.magicEvent(eventName, { [propertyName]: value });
    },
    async initializeMagic() {
      // Runs inline too since the staged header's Refined toggle (2026-10).
      if (!this.magicIdentityReady || this.diagramType !== DiagramType.Mermaid
        || this.magicActive || this.magicPending || this.magicInitializing) return;
      const generation = this.magicGeneration;
      const attempt = ++this.magicInitializeAttempt;
      const source = this.diagram.mermaidCode ?? '';
      const artifact = this.diagram.magic;
      if (!artifact) {
        // Inline, a Mermaid diagram without an artifact is the common case, not
        // a Magic assessment: reporting it would add an event per page view.
        // Writeback still runs inline (rate-limited per browser) so a staged
        // layout reaches viewers who never open Fullscreen.
        this.requestMagicWriteback();
        if (!this.isFullscreenMode) return;
        this.reportMagicAssessment('magic_availability_checked', 'magic_availability', 'missing_artifact', source, artifact);
        this.reportMagicAssessment('magic_default_resolved', 'magic_default_result', 'original_unavailable', source, artifact);
        return;
      }
      this.magicInitializing = true;
      try {
        const result = await validateMagicArtifact(artifact, source);
        if (generation !== this.magicGeneration || this.diagramType !== DiagramType.Mermaid
          || this.diagram.mermaidCode !== source || this.diagram.magic !== artifact) return;
        if ('reason' in result) {
          if (result.reason === 'stale_source') this.requestMagicWriteback();
          this.reportMagicAssessment('magic_availability_checked', 'magic_availability', result.reason, source, artifact);
          this.reportMagicAssessment('magic_default_resolved', 'magic_default_result', 'original_unavailable', source, artifact);
          return;
        }
        this.reportMagicAssessment('magic_availability_checked', 'magic_availability', 'available', source, artifact);
        this.magicAvailable = true;
        await this.loadMagicFeedback(artifact, source);
        if (generation !== this.magicGeneration || this.diagram.mermaidCode !== source || this.diagram.magic !== artifact) return;
        const persisted = readMagicPreference(this.magicIdentity(artifact.sourceHash));
        const session = this.magicSessionChoiceKey === this.magicSessionKey(artifact.sourceHash) ? this.magicSessionChoice : null;
        if ((persisted ?? session) === 'original') {
          this.reportMagicAssessment('magic_default_resolved', 'magic_default_result', 'original_preferred', source, artifact);
          return;
        }
        await this.showMagic('automatic', result);
        if (this.magicGeneration === generation + 1) {
          this.reportMagicAssessment('magic_default_resolved', 'magic_default_result',
            this.magicActive ? 'magic_shown' : 'original_render_failed', source, artifact);
        }
      } catch {
        if (generation === this.magicGeneration && this.diagram.mermaidCode === source && this.diagram.magic === artifact) {
          this.reportMagicAssessment('magic_availability_checked', 'magic_availability', 'check_failed', source, artifact);
          this.reportMagicAssessment('magic_default_resolved', 'magic_default_result', 'original_unavailable', source, artifact);
        }
      } finally {
        if (attempt === this.magicInitializeAttempt) this.magicInitializing = false;
      }
    },
    async requestMagicWriteback() {
      const diagram = this.diagram;
      const contentId = diagram?.id;
      const source = diagram?.mermaidCode;
      const artifact = diagram?.magic;
      if (this.diagramType !== DiagramType.Mermaid
        || diagram?.source !== DataSource.CustomContent || diagram?.isCopy || diagram?.recoveredFromOrphan
        || typeof contentId !== 'string' || !/^\d{1,30}$/.test(contentId) || typeof source !== 'string') return;
      // One attempt per diagram/source per iframe. Duplicate readiness signals
      // and unavailable backend responses must not create a polling loop.
      if (this.magicWritebackAttempts.some(item => item.contentId === contentId && item.source === source)) return;
      // Inline adds a per-browser 24h limit (~10k inline Mermaid views a day);
      // Fullscreen keeps retrying once per iframe.
      const inline = !this.isFullscreenMode;
      // Inline means the page-view macro only: the editor preview (Workspace ->
      // DiagramPortal, hide-header / non-display mode) would send one request
      // per edited source and cannot show the refined layout anyway.
      if (inline && (!this.isDisplayMode || this.hideHeader)) return;
      // Record the attempt before the first await: the account lookup below must
      // not open a window for a duplicate readiness signal to slip past the
      // check above and send a second request.
      this.magicWritebackAttempts.push({ contentId, source });
      // The inline per-browser claim comes first and covers the skipped path
      // too: a guest reloading a 20-diagram page reports each diagram once a
      // day, not once per page view, and a repeat view costs no lookup.
      if (inline && !claimInlineMagicWriteback(contentId, source)) return;
      // Forge sends no user token on invokeRemote for guest and anonymous
      // viewers, so the call could only fail. Ask before sending anything.
      // Anything unclear ('unknown') proceeds; the backend's 403
      // no_user_credential is the backstop.
      let kind = 'unknown';
      try {
        kind = await viewerAccountKind({ accountId: this.currentAccountId ?? undefined, clientDomain: getClientDomain() });
      } catch { /* Fail open, like an unknown answer. */ }
      if (kind === 'guest' || kind === 'anonymous') {
        this.magicEvent('magic_writeback_skipped', { magic_writeback_reason: `${kind}_viewer` });
        return;
      }
      const started = performance.now();
      const generation = this.magicGeneration;
      if (!inline) this.magicEvent('magic_writeback_requested');
      let outcome = 'unavailable';
      let reason = 'unknown';
      try {
        const result = await callRemote('/magic-writeback', 'POST', { contentId });
        const known = ['written', 'existing', 'miss', 'source_changed', 'unavailable', 'conflict', 'invalid_target'];
        if (known.includes(result?.outcome)) outcome = result.outcome;
        if (outcome === 'unavailable') reason = typeof result?.reason === 'string' && /^[a-z_]{1,24}(_\d{3})?$/.test(result.reason) ? result.reason : 'unknown';
        if ((outcome === 'written' || outcome === 'existing') && result.artifact
          && this.magicGeneration === generation && this.diagram === diagram
          && this.diagram.id === contentId && this.diagram.mermaidCode === source && this.diagram.magic === artifact) {
          const validated = await validateMagicArtifact(result.artifact, source);
          if ('svg' in validated && this.magicGeneration === generation && this.diagram === diagram
            && this.diagram.id === contentId && this.diagram.mermaidCode === source && this.diagram.magic === artifact) {
            this.diagram.magic = result.artifact;
          }
        }
      } catch (error) {
        // Original remains usable when optional delivery is unavailable. Only a
        // status code is kept; never the error text.
        const message = error instanceof Error ? error.message : '';
        const status = /^HTTP (\d{3})/.exec(message)?.[1];
        // The backend answers 403 { error: 'no_user_credential' } when Forge sent
        // no user token. Check it before the generic status mapping.
        if (message.includes('no_user_credential')) reason = 'no_user_credential';
        else reason = status ? `remote_${status}` : 'client_exception';
      }
      finally {
        // Inline, a miss is the common no-op answer; only real deliveries and
        // failures are worth an event.
        if (!inline || outcome !== 'miss') this.magicEvent('magic_writeback_completed', { magic_writeback_outcome: outcome, ...(outcome === 'unavailable' ? { magic_writeback_reason: reason } : {}), duration_ms: Math.round(performance.now() - started) });
      }
    },
    magicEvent(name, properties = {}) {
      trackAnalyticsEvent(name, {
        feature_area: 'ai', surface: this.isFullscreenMode ? 'fullscreen' : 'viewer', macro_type: 'mermaid', ...properties,
      });
    },
    resetMagic(preserveAvailable = false) {
      this.clearMagicHighlights();
      const wasAvailable = this.magicAvailable;
      if (this.magicPending && this.magicStartedAt != null) {
        this.magicEvent('magic_view_failed', {
          magic_failure_reason: 'source_changed',
          duration_ms: Math.round(performance.now() - this.magicStartedAt),
        });
      }
      this.magicGeneration++;
      this.magicInitializeAttempt++;
      this.magicActive = false;
      this.magicSvg = null;
      this.magicPending = false;
      this.magicStartedAt = null;
      this.magicFeedback = '';
      this.magicAvailable = preserveAvailable && wasAvailable;
      if (!preserveAvailable) {
        this.magicLayoutFeedback = null;
        this.magicPreviousFeedback = null;
        this.magicFeedbackGeneration = null;
        this.magicFeedbackThanked = false;
      }
      this.magicInitializing = false;
    },
    async toggleMagic(activation = 'manual') {
      if (this.magicActive) {
        this.persistMagicChoice('original', this.diagram.magic.sourceHash);
        this.resetMagic(true);
        this.magicEvent('magic_view_restored');
        return;
      }
      if (this.magicPending || this.diagramType !== DiagramType.Mermaid) return;
      await this.showMagic(activation);
    },
    async showMagic(activation = 'manual', validated = null) {
      const started = performance.now();
      this.magicStartedAt = started;
      const generation = ++this.magicGeneration;
      const source = this.diagram.mermaidCode ?? '';
      const artifact = this.diagram.magic;
      this.magicPending = true;
      this.magicFeedback = '';
      this.magicEvent('magic_view_requested', { magic_activation: activation });
      try {
        const result = validated ?? await validateMagicArtifact(artifact, source);
        if (generation !== this.magicGeneration || this.diagramType !== DiagramType.Mermaid
          || this.diagram.mermaidCode !== source || this.diagram.magic !== artifact) return;
        if ('reason' in result) {
          this.magicAvailable = false;
          this.magicFeedback = result.reason === 'stale_source'
            ? 'This refined layout is for an earlier version of the diagram.'
            : 'Refined layout could not be shown. The original diagram is still available.';
          this.magicEvent('magic_view_failed', { magic_failure_reason: result.reason, duration_ms: Math.round(performance.now() - started) });
          return;
        }
        this.magicSvg = result.svg;
        this.magicAvailable = true;
        this.magicActive = true;
        await this.$nextTick();
        if (generation !== this.magicGeneration) return;
        if (!this.$refs.magicViewport?.$el?.querySelector('svg')) throw new Error('Magic SVG did not render');
        await this.$refs.magicViewport.attach();
        if (generation === this.magicGeneration) {
          await this.installMagicHighlights();
          if (generation !== this.magicGeneration) return;
          if (activation === 'manual') this.persistMagicChoice('magic', artifact.sourceHash);
          this.magicEvent('magic_view_succeeded', { magic_activation: activation, duration_ms: Math.round(performance.now() - started) });
          await this.loadMagicFeedback(artifact, source);
        }
      } catch {
        if (generation !== this.magicGeneration) return;
        this.magicActive = false;
        this.magicAvailable = false;
        this.magicSvg = null;
        this.magicFeedback = 'Refined layout could not be shown. The original diagram is still available.';
        this.magicEvent('magic_view_failed', { magic_failure_reason: 'render_failed', duration_ms: Math.round(performance.now() - started) });
      } finally {
        if (generation === this.magicGeneration) {
          this.magicPending = false;
          this.magicStartedAt = null;
        }
      }
    },
    clearMagicHighlights() {
      this.magicHighlightCleanup?.();
      this.magicHighlightCleanup = null;
      this.magicHighlightController?.destroy();
      this.magicHighlightController = null;
      this.$emit('magic-highlight-ready', false);
    },
    async installMagicHighlights() {
      if (!this.magicActive || !this.relationshipHighlights || this.showExportModal
        || !this.isFullscreenMode || this.diagramType !== DiagramType.Mermaid) return;
      const generation = this.magicGeneration;
      const source = this.diagram?.mermaidCode ?? '';
      const artifact = this.diagram?.magic;
      try {
        const model = await parseMermaidFlowchart(normalizeMermaidWhitespace(source));
        if (generation !== this.magicGeneration || !this.magicActive || !this.relationshipHighlights
          || this.showExportModal || this.diagram?.mermaidCode !== source || this.diagram?.magic !== artifact) return;
        const svg = this.$refs.magicViewport?.$el?.querySelector('svg');
        if (!svg) return;
        this.clearMagicHighlights();
        this.magicHighlightController = attachPreparedSvgHighlights(svg, model);
        let used = false, timer = null, hovered = null;
        const target = event => {
          const el = event.target.closest?.('[data-hit-node],[data-hit-edge],g[data-node],path[data-edge]');
          if (!el || !svg.contains(el)) return null;
          return { el, kind: el.hasAttribute('data-hit-group') || el.hasAttribute('data-group')
            ? 'group' : el.hasAttribute('data-hit-node') || el.hasAttribute('data-node') ? 'node' : 'edge' };
        };
        const cancel = () => { clearTimeout(timer); timer = null; hovered = null; };
        const report = item => {
          if (!item || used || generation !== this.magicGeneration) return;
          used = true; cancel(); this.$emit('magic-highlight-used', { kind: item.kind });
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
        this.magicHighlightCleanup = () => { cancel(); for (const [name, handler] of listeners) svg.removeEventListener(name, handler); };
        this.$emit('magic-highlight-ready', true);
      } catch {
        // A drawing without a complete source binding remains readable, with
        // the optional relationship overlay unavailable.
        this.clearMagicHighlights();
      }
    },
    async loadMagicFeedback(artifact, source) {
      try {
        const generation = await magicGenerationKey(artifact);
        if (this.diagram?.magic !== artifact || this.diagram?.mermaidCode !== source) return;
        this.magicFeedbackGeneration = generation;
        const sessionKey = this.magicSessionKey(artifact.sourceHash) + ':' + generation;
        this.magicPreviousFeedback = readMagicFeedback(this.magicIdentity(artifact.sourceHash), generation);
        // Inline, the survey only shows to viewers who have not voted yet.
        if (!this.magicFeedbackPrompted[sessionKey] && (this.isFullscreenMode || this.magicPreviousFeedback == null)) {
          this.magicFeedbackPrompted[sessionKey] = true;
          this.magicEvent('magic_layout_feedback_prompt_shown');
        }
      } catch {
        // Optional browser-local feedback must not affect diagram rendering.
      }
    },
    selectMagicLayoutFeedback(choice) {
      if ((!this.magicActive && !this.magicAvailable) || !this.magicFeedbackGeneration
        || !['magic', 'original', 'no_preference'].includes(choice)) return;
      const previous = this.magicLayoutFeedback ?? this.magicPreviousFeedback;
      if (this.magicLayoutFeedback === choice) return;
      this.magicLayoutFeedback = choice;
      this.magicPreviousFeedback = choice;
      this.magicFeedbackThanked = true;
      if (!this.isFullscreenMode) {
        if (this.magicThanksTimer) clearTimeout(this.magicThanksTimer);
        this.magicThanksTimer = setTimeout(() => {
          this.magicThanksTimer = null;
          this.magicFeedbackThanked = false;
        }, INLINE_SURVEY_THANKS_MS);
      }
      writeMagicFeedback(this.magicIdentity(this.diagram.magic.sourceHash), this.magicFeedbackGeneration, choice);
      this.magicEvent(previous == null ? 'magic_layout_feedback_submitted' : 'magic_layout_feedback_updated', { magic_layout_preference: choice });
    },
    // See the addEventListener comment in mounted() for why this is a
    // capture-phase listener. Yields to the Copy-for-AI menu while it is open
    // so one Escape dismisses one layer.
    onEscapeKeydown(e) {
      if (e.key !== 'Escape') return;
      if (this.$refs.copyForAiMenu?.open || this.$refs.moreMenu?.open) return;
      if (this.showConnectMcpDialog) {
        this.closeConnectMcpDialog();
        return;
      }
      if (!this.showSourcePanel) return;
      this.showSourcePanel = false;
    },
    // Export PNG (code review): give ExportModal the actual DOM node instead
    // of a global document.querySelector('.screen-capture-content'), which
    // only worked by the accident of exactly one copy ever being mounted at
    // once. Same ref name on mutually exclusive branches resolves to
    // whichever one is actually rendered; null while the load-failed panel
    // has replaced the capture branch.
    // ----- staged header ---------------------------------------------------
    // The stage is measured against the WHOLE viewer's width, not
    // .viewer-frame / .viewer-edge-top: an auto frame is fit-content, so its
    // width follows the header itself and observing it would feed back.
    startHeaderLayout() {
      // $refs, not $el: the template opens with a comment, so $el is not the root element.
      const root = this.$refs.viewerRoot;
      if (this.isFullscreenMode || typeof ResizeObserver === 'undefined' || !(root instanceof Element)) return;
      this.headerResizeObserver = new ResizeObserver(() => this.scheduleHeaderLayout());
      this.headerResizeObserver.observe(root);
      // Web fonts change every text width the stage was computed from.
      document.fonts?.ready?.then(() => this.scheduleHeaderLayout()).catch(() => {});
      this.$nextTick(this.scheduleHeaderLayout);
    },
    scheduleHeaderLayout() {
      if (this.headerLayoutFrame) return;
      const raf = window.requestAnimationFrame?.bind(window) ?? (cb => setTimeout(cb, 16));
      this.headerLayoutFrame = raf(() => {
        this.headerLayoutFrame = null;
        this.updateHeaderStage();
      });
    },
    headerTextContext() {
      if (!this.headerCanvasContext) {
        this.headerCanvasContext = document.createElement('canvas').getContext?.('2d') ?? null;
      }
      return this.headerCanvasContext;
    },
    // Picks the smallest collapse stage at which the title shows enough of
    // itself (viewerHeaderLayout.ts). Only the stage-dependent controls are
    // modelled; everything else in the row is read off the DOM as it stands,
    // so chips, Connect, Create and slot actions are accounted for exactly.
    updateHeaderStage() {
      if (this.isFullscreenMode || !this.isDisplayMode || this.hideHeader || this.isLoadFailed) return;
      const root = this.$refs.viewerRoot;
      const edge = root?.querySelector?.('.viewer-edge-top');
      const area = edge?.querySelector('.viewer-title-area');
      const titleEl = edge?.querySelector('.viewer-title');
      const actions = edge?.querySelector('.viewer-top-actions');
      const frame = root?.querySelector?.('.viewer-frame');
      const surface = root?.querySelector?.('.viewer-surface');
      if (!edge || !area || !titleEl || !actions || !frame || !surface) return;
      // A viewer-sidebar slot shares the row with the surface.
      const besideSurface = Array.from(surface.parentElement?.children ?? [])
        .filter(el => el !== surface)
        .reduce((total, el) => total + el.getBoundingClientRect().width, 0);
      const column = root.clientWidth - besideSurface;
      if (!column) return; // detached, or a layout-less test DOM
      const ctx = this.headerTextContext();
      if (!ctx) return;
      const edgeStyle = getComputedStyle(edge);
      const titleStyle = getComputedStyle(titleEl);
      const titleFont = `${titleStyle.fontWeight} ${titleStyle.fontSize} ${titleStyle.fontFamily}`;
      const measureTitle = (text) => { ctx.font = titleFont; return ctx.measureText(text).width; };
      const measureLabel = (text, size) => { ctx.font = `500 ${size}px ${edgeStyle.fontFamily}`; return ctx.measureText(text).width; };
      const chrome = (frame.offsetWidth - frame.clientWidth)
        + parseFloat(edgeStyle.paddingLeft) + parseFloat(edgeStyle.paddingRight)
        + (parseFloat(getComputedStyle(area).marginRight) || 0);
      const titleNeighbours = Math.max(0, area.getBoundingClientRect().width - titleEl.getBoundingClientRect().width);
      const model = this.headerModel;
      const measuredActions = actions.getBoundingClientRect().width;
      const modelledNow = controlsWidth(model, this.headerStage, measureLabel);
      const { stage, titleSpace } = pickHeaderStage({
        title: this.title,
        maxStage: maxHeaderStage(model),
        measureTitle,
        titleSpaceAt: (s) => column - chrome - titleNeighbours
          - (measuredActions - modelledNow + controlsWidth(model, s, measureLabel)),
      });
      if (stage !== this.headerStage) this.headerStage = stage;
      if (titleSpace !== this.headerTitleSpace) this.headerTitleSpace = titleSpace;
    },
    onHeaderFocusIn() {
      this.headerFocusWithin = true;
    },
    onHeaderFocusOut(e) {
      if (!e.currentTarget?.contains(e.relatedTarget)) this.headerFocusWithin = false;
    },
    onMoreMenuOpened() {
      this.moreMenuOpen = true;
      trackAnalyticsEvent('viewer_more_menu_opened', {
        feature_area: 'macro',
        surface: this.isFullscreenMode ? 'fullscreen' : 'viewer',
        macro_type: this.diagramType ?? 'none',
        ...(this.isFullscreenMode ? {} : { header_stage: this.headerStage }),
      });
    },
    // The action runs inside the click (clipboard writes need the user
    // activation); closing returns focus to the More trigger.
    onMoreMenuSelect(item, close) {
      const where = 'header_more_menu';
      switch (item) {
        case 'source': close(); this.openViewSource(where); return;
        case 'copy-for-ai': this.copyForAi('generic', where); close(); return;
        case 'connect-mcp': close(); this.openConnectMcpDialog(where); return;
        case 'copy-diagram-link': this.copyDeeplink(where); close(); return;
        case 'copy-page-link': this.copyLink(where); close(); return;
        case 'export-png': close(); this.openExport(where); return;
        case 'versions': close(); this.showContentVersions(where); return;
        case 'debug': this.onDownloadDebugInfo(close, where); return;
        default:
      }
    },
    onFullscreenHeaderAction(id) {
      const where = 'fullscreen_header';
      switch (id) {
        case 'diagram-link': this.copyDeeplink(where); return;
        case 'page-link': this.copyLink(where); return;
        case 'export-png': this.openExport(where); return;
        case 'versions': this.showContentVersions(where); return;
        default:
      }
    },
    exitFullscreen() {
      EventBus.$emit('closeFullscreen');
    },
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
    // The Source button is a toggle: a second click closes the panel it opened
    // (Fullscreen Viewer v2). Only the opening half is tracked —
    // `viewer_source_opened` still counts one event per open, so the toggle
    // does not change what the funnel measures.
    toggleViewSource() {
      if (this.showSourcePanel) {
        this.showSourcePanel = false;
        return;
      }
      this.openViewSource();
    },
    // View Source panel (#333). Uses in-memory diagram DSL — no refetch.
    // Available to all viewers; do not gate on canUserEdit.
    openViewSource(actionLocation) {
      this.showSourcePanel = true;
      trackAnalyticsEvent('viewer_source_opened', {
        feature_area: 'macro',
        surface: 'viewer',
        macro_type: this.diagramType ?? 'none',
        has_edit_permission: !!this.canUserEdit,
        ...(actionLocation ? { action_location: actionLocation } : {}),
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
      this.copyForAiMenuOpen = true;
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
    // Connect MCP (headless only in the first release — see
    // connectInstructions.ts RELAY_SESSIONS_ENABLED): nothing to mint, so the
    // dialog only shows the setup command and a prompt naming this diagram.
    connectMcpAnalytics(extra = {}) {
      return {
        feature_area: 'agent_link',
        surface: 'viewer',
        macro_type: this.diagramType ?? 'none',
        mcp_mode: 'headless',
        ...extra,
      };
    },
    openConnectMcpDialog(where = 'toolbar') {
      if (this.showConnectMcpDialog) return;
      this.showConnectMcpDialog = true;
      this.connectMcpOpenedAt = Date.now();
      trackAnalyticsEvent('agent_link_mcp_dialog_opened', this.connectMcpAnalytics(
        where === 'header_more_menu' ? { action_location: where } : {}));
    },
    closeConnectMcpDialog() {
      if (!this.showConnectMcpDialog) return;
      this.showConnectMcpDialog = false;
      trackAnalyticsEvent('agent_link_mcp_dialog_closed', this.connectMcpAnalytics({
        dwell_ms: Date.now() - this.connectMcpOpenedAt,
      }));
    },
    onConnectMcpCopied(target, ok) {
      trackAnalyticsEvent('agent_link_mcp_dialog_copied', this.connectMcpAnalytics({
        mcp_copy_target: target,
        outcome: ok ? 'copied' : 'clipboard_failed',
      }));
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
    /**
     * Export PNG's entry point. The dialog needs room the inline macro does not
     * have: the iframe is 564x256 on production page 2774138946, which leaves
     * the annotation controls in a 24px scroller over 312px of form. Rendering
     * it in flow grows the iframe but then pushes the preview out of the
     * viewport while those controls are edited, so the dialog opens on the
     * surface that has room. In Fullscreen it is already there — open it in
     * place rather than nesting another modal.
     */
    // Once. A later re-render (or the fallback timer firing after the event)
    // must not reopen a dialog the user has closed.
    openExportOnce() {
      if (this.exportAutoOpened) return;
      this.exportAutoOpened = true;
      this.exportPreviewReady = true;
      EventBus.$off('diagramLoaded', this.onDiagramLoadedOpenExport);
      EventBus.$off('viewerRenderSettled', this.onDiagramLoadedOpenExport);
      if (this.exportAutoOpenTimer) {
        clearTimeout(this.exportAutoOpenTimer);
        this.exportAutoOpenTimer = null;
      }
      this.showExportModal = true;
    },
    onDiagramLoadedOpenExport() {
      this.openExportOnce();
    },
    /**
     * An export-entry modal exists only to host the dialog. The route skips the
     * fullscreen-viewer paywall (the user pressed Export PNG, which is ungated
     * inline), so leaving the fullscreen viewer standing behind a dismissed
     * dialog would hand a saturated Lite space a free read-only fullscreen
     * viewer — exactly what that gate protects. Dismissing the dialog therefore
     * leaves the modal. A dialog the user opened by hand inside Fullscreen just
     * closes.
     */
    onExportModalClose() {
      this.showExportModal = false;
      if (this.isExportEntryModal) {
        // A close before either readiness signal fired must permanently
        // cancel the auto-open, not just hide the dialog once — otherwise a
        // 'diagramLoaded'/'viewerRenderSettled' event still in flight (or the
        // fallback timer) reopens the dialog the user just dismissed.
        this.exportAutoOpened = true;
        EventBus.$off('diagramLoaded', this.onDiagramLoadedOpenExport);
        EventBus.$off('viewerRenderSettled', this.onDiagramLoadedOpenExport);
        if (this.exportAutoOpenTimer) {
          clearTimeout(this.exportAutoOpenTimer);
          this.exportAutoOpenTimer = null;
        }
        EventBus.$emit('closeFullscreen');
      }
    },
    openExport(actionLocation) {
      if (this.isFullscreenMode) {
        this.showExportModal = true;
        return;
      }
      this.fullscreen({ openExport: true, actionLocation });
    },
    openCreateGuide() {
      openCreateGuide({
        variant: this.createGuideVariant,
        macroType: this.diagramType ?? 'none',
        hasEditPermission: !!this.canUserEdit,
      });
    },
    fullscreen(options = {}) {
      const openExport = options.openExport === true;
      trackEvent('fullscreen', 'click', 'viewing');
      trackAnalyticsEvent('fullscreen_opened', {
        feature_area: 'macro',
        surface: 'viewer',
        macro_type: this.diagramType ?? 'none',
        entry_point: openExport ? 'export' : 'page_view',
        ...(options.actionLocation ? { action_location: options.actionLocation } : {}),
      });
      // Single-argument emit on the ordinary path: every existing listener and
      // test treats `fullscreen` as a bare signal.
      if (openExport) {
        EventBus.$emit('fullscreen', { openExport: true });
      } else {
        EventBus.$emit('fullscreen');
      }
    },
    showContentVersions(actionLocation) {
      if (actionLocation) trackEvent('show_content_versions', 'click', 'viewing', { action_location: actionLocation });
      else trackEvent('show_content_versions', 'click', 'viewing');
      if (!this.diagram.id) {
        toast({ message: 'Version history unavailable', duration: 2000 });
        return;
      }
      // READ BY tests/e2e-tests/tests/fullscreen/viewer-actions.spec.ts:55,87,119
      console.log(`Getting versions for content ID: ${this.diagram.id}`);
      globals.apWrapper.getAndPrintContentVersions(this.diagram.id)
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
    async copyDeeplink(linkSource = 'header_more_menu') {
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
          link_source: linkSource,
          outcome,
        });
      }
    },
    async onDownloadDebugInfo(closeMenu, actionLocation) {
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
          ...(actionLocation ? { action_location: actionLocation } : {}),
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
    async copyLink(actionLocation) {
      if (actionLocation) trackEvent('copy_link', 'click', 'viewing', { action_location: actionLocation });
      else trackEvent('copy_link', 'click', 'viewing');
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
    async copyForAi(job = 'generic', actionLocation) {
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
        ...(actionLocation ? { action_location: actionLocation } : {}),
      });
    },
  },
}
</script>

<style scoped>
/* ----- chrome-less viewer surface --------------------------------------- */
.viewer-frame {
  /* DESIGN.md tokens are not loaded globally in this viewer. Keep scoped,
     documented fallbacks so the Magic controls resolve in Forge and Storybook. */
  --magic-primary: var(--color-blue-600, #2563EB);
  --magic-primary-hover: var(--color-blue-700, #1D4ED8);
  --magic-surface: var(--bg1, #FFFFFF);
  --magic-subtle: var(--gray-50, #F9FAFB);
  --magic-hover: var(--gray-100, #F3F4F6);
  --magic-border: var(--gray-200, #E5E7EB);
  --magic-border-strong: var(--gray-300, #D1D5DB);
  --magic-text: var(--gray-700, #374151);
  --magic-text-soft: var(--gray-600, #4B5563);
  --magic-on-primary: var(--fg-on-primary, #FFFFFF);
  --magic-danger: var(--color-danger, #CA3521);
  --magic-radius: var(--radius-md, 6px);
  position: relative;
  display: block;
  background: #fff;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}
.viewer-frame--auto { width: fit-content; margin-left: auto; margin-right: auto; }
/* A header menu (More, Copy for AI) is taller than a short diagram's card and,
   on a narrow card, wider than the space left of its trigger. While one is
   open the frame stops clipping so the menu shows whole; the header keeps the
   frame's top corners (its own radius below). */
.viewer-frame--menu-open { overflow: visible; }
.viewer-frame--wide { width: 100%; }
/* Connect MCP dialog open (inline): the dialog overlays .viewer-frame, so give
   the frame room for it. Inline autoResize then grows the Forge iframe; the
   frame shrinks back when the dialog closes. */
.viewer-frame--connect-mcp { min-height: 540px; min-width: min(540px, 100%); }

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

/* ----- Fullscreen Viewer v2 ---------------------------------------------
   Fullscreen is the surface where the diagram is the whole point, so its
   chrome is designed rather than borrowed from the inline macro: a solid
   56px header that always shows its actions, and the design system's cream
   dot-grid canvas (--canvas-bg / --canvas-dot in colors_and_type.css; the
   same pair Workspace.vue already paints in the editor) instead of the flat
   white that made the diagram look like it had failed to load.

   The ZenUML embed itself is deliberately untouched: @zenuml/core renders
   the frame, its own bottom toolbar and the watermark as one unit, and this
   redesign only changes what surrounds it and how much room it gets.

   Everything here is scoped to --fullscreen. The inline macro's hover-quiet
   chrome (transparent border, actions at opacity 0) is correct in a
   Confluence page and is not changed. */
.viewer-frame--fullscreen .viewer-edge-top {
  flex-shrink: 0;
  height: 56px;
  padding: 0 20px;
  border-bottom-color: #E5E7EB;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  /* Above the canvas, so the header's shadow falls onto the dot grid. */
  position: relative;
  z-index: 2;
}
/* Hover-to-reveal is an inline-macro affordance — it keeps a page of macros
   quiet. In fullscreen the user opened this surface to act on the diagram,
   and there is no page to keep quiet, so the actions are always present
   (the reveal rule below is scoped to non-fullscreen frames). */
.viewer-frame--fullscreen .viewer-title {
  font-size: 16px;
}
/* The design's header row is 12px-gapped; the inline macro's tighter 10px is
   tuned for a row with no chip in it. */
.viewer-frame--fullscreen .viewer-title-area {
  gap: 12px;
}

/* Read-only diagram-type indicator. Reproduces what the design system's
   TabSwitcher renders for a single active tab — tray plus accent-tinted
   pill — without the editor TabSwitcher's click-to-switch behaviour, which
   this surface has no use for. Accents are the shared five from DESIGN.md §2
   (--accent-<type>-50 / -500 / -800). */
.viewer-type-chip-tray {
  display: inline-flex;
  flex-shrink: 0;
  padding: 3px;
  background: #F4F5F7;
  border-radius: 6px;
}
.viewer-type-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}
.viewer-type-chip-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}
.viewer-type-chip--sequence { background: #E8F6FD; color: #054E76; }
.viewer-type-chip--sequence .viewer-type-chip-dot { background: #0094D9; }
.viewer-type-chip--mermaid { background: #FFF0F4; color: #8E0F33; }
.viewer-type-chip--mermaid .viewer-type-chip-dot { background: #FF3670; }
.viewer-type-chip--plantuml { background: #FDF1E9; color: #6B2900; }
.viewer-type-chip--plantuml .viewer-type-chip-dot { background: #B84800; }
.viewer-type-chip--graph { background: #FFF7E8; color: #8A4B00; }
.viewer-type-chip--graph .viewer-type-chip-dot { background: #F08705; }
.viewer-type-chip--openapi { background: #F1F8EA; color: #3A5C1D; }
.viewer-type-chip--openapi .viewer-type-chip-dot { background: #6BA539; }

/* .viewer-frame--auto sizes the frame to fit-content, which in fullscreen made
   it as wide as the diagram — leaving the rest of the window bare (the
   min-height rule above fixed the same thing vertically). That was survivable
   while the frame was white on white; a canvas has to reach the edges or it
   reads as a stripe down the middle. The diagram keeps its centered position
   below, now against a canvas that owns the whole surface. */
.viewer-frame--fullscreen { width: 100%; }

/* Export PNG opens a separate fullscreen host so the annotation workspace has
   room. Preserve the natural text-diagram card from the preceding inline view
   in that host; Graph uses its own rendered-box metadata and is unaffected. */
.viewer-frame--export-entry:not(.viewer-frame--wide) {
  width: fit-content;
}
.viewer-frame--export-entry:not(.viewer-frame--wide) .screen-capture-content {
  width: fit-content;
  max-width: none;
}
.viewer-frame--export-entry:not(.viewer-frame--wide) :deep(.zenuml > div) {
  min-width: 0;
}
.viewer-frame--export-entry:not(.viewer-frame--wide) :deep(.plantuml-render > svg) {
  min-width: 0;
}

.viewer-frame--fullscreen .viewer-canvas {
  padding: 24px;
  align-items: center;
  background-color: #F8F7F4;
  background-image: radial-gradient(circle, #D0CEC7 1px, transparent 1px);
  background-size: 20px 20px;
}
/* One column, one width: the diagram and the byline under it share this box,
   which is what puts the byline's right edge on the diagram's right edge.
   1000px is the design's number — the diagram stops growing before the text
   under it becomes a long, hard-to-track line on a wide monitor. */
.viewer-frame--fullscreen .screen-capture-content,
.viewer-frame--fullscreen .viewer-footer-row {
  width: 100%;
  max-width: 1000px;
}
/* See fullscreenUncappedDiagram(). Only the diagram box opts out; .viewer-footer-row
   above keeps the 1000px so the byline stays a readable line. */
.viewer-frame--fullscreen .screen-capture-content--uncapped {
  max-width: none;
}
/* @zenuml/core's root is `inline-block`, so the frame shrink-wraps the diagram.
   Inline that is right — the macro should not claim a page's width it isn't
   using. In fullscreen it left a two-participant diagram as a ~330px card
   pinned to the left of a 1000px column, with the byline's right edge 660px
   away from the diagram's: the column alignment this redesign is built on only
   holds if the frame actually fills the column. Width only — a stretched
   HEIGHT is measurably worse, because @zenuml/core's bottom toolbar does not
   follow the taller frame and a short diagram gets an empty white slab under
   it. Vertical fill belongs in @zenuml/core, not in an override here. */
/* :deep() because these nodes are rendered by @zenuml/core, not by this
   template, so a scoped selector alone never matches them.

   `max-content` rather than `100%`: a diagram wider than the column has to
   stay reachable. @zenuml/core's own wrapper is `overflow: hidden`, so pinning
   its root to the column's width silently cut the right-hand participants off
   with nothing to scroll — the frame is allowed to be as wide as its content,
   and the column scrolls to it. `min-width: 100%` is what makes the narrow
   case fill rather than shrink-wrap. */
.viewer-frame--fullscreen :deep(.zenuml) {
  overflow-x: auto;
}
.viewer-frame--fullscreen :deep(.zenuml > div) {
  display: block;
  width: max-content;
  min-width: 100%;
}
/* PlantUML gets the same treatment as .zenuml above, for the same reason
   (conf-app#626). Normalising the server SVG makes it scale proportionally, but a
   6228px diagram fitted into the column is a correct picture nobody can read. The
   wrapper is allowed to be as wide as the drawing and scrolls to it; `min-width:
   100%` keeps a narrow diagram centered rather than shrink-wrapped. The intrinsic
   width comes from PlantUml.vue, which reads it off the viewBox before the width
   attribute is dropped — without it the SVG would fall back to the 300px CSS
   default here. `justify-content` is reset because a scrolled flex row would otherwise
   center the overflow and make the left edge unreachable.

   Scoped to the EXPORT-ENTRY host, not all of fullscreen: since DiagramViewport
   landed, live fullscreen pans and zooms the diagram instead of scrolling it, and
   the two mechanisms cannot both size the same SVG. Export PNG renders on the
   non-interactive surface (openExport), where no viewport attaches, so 1:1 plus
   scroll is still exactly what the capture needs. */
.viewer-frame--export-entry :deep(.plantuml-render) {
  overflow-x: auto;
  justify-content: flex-start;
}
.viewer-frame--export-entry :deep(.plantuml-render > svg) {
  /* `flex: 0 0 auto` is the part that matters: as a shrinkable flex item the SVG
     would collapse back to the column width and there would be nothing to scroll. */
  flex: 0 0 auto;
  max-width: none;
  width: var(--plantuml-intrinsic-width, 100%);
  min-width: 100%;
  height: auto;
}
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
/* Idle: mounted but taking no width — see agentLinkRailReserved(). */
.agent-link-rail--collapsed {
  flex: 0 0 0;
  width: 0;
  border-left: none;
  overflow: hidden;
}

.viewer-edge-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  border-radius: 7px 7px 0 0;
  box-sizing: border-box;
  padding: 6px 12px;
  background: #fff;
  border-bottom: 1px solid transparent;
  transition: border-color 200ms ease;
}
.viewer-surface--revealed .viewer-edge-top { border-bottom-color: #E5E7EB; }

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
}
/* An uncapped nowrap title is the header's min-content, and on a fit-content
   (.viewer-frame--auto) frame that widens the card past the page column. The
   cap is the title space the staged layout computed from the column width;
   420px is the pre-measurement fallback (and the old fixed cap). */
.viewer-frame:not(.viewer-frame--fullscreen) .viewer-title {
  max-width: var(--viewer-title-max, 420px);
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
  /* The title truncates instead; a squeezed row wrapped "Connect to Agent" onto two lines. */
  flex-shrink: 0;
}
/* Inline reveal, per control: hidden until hover, keyboard focus inside the
   macro, or an open header menu (headerRevealed). Create (a discovery
   affordance), the page navigation and a pressed Refined toggle stay visible
   at rest. Opacity only — a hidden control still takes focus, which reveals. */
.viewer-top-actions > * { transition: opacity 200ms ease; }
.viewer-frame:not(.viewer-frame--fullscreen) .viewer-surface:not(.viewer-surface--revealed) .viewer-top-actions > :not(.viewer-btn-create):not(.viewer-header-nav):not(.viewer-refined-toggle--pressed) {
  opacity: 0;
}
/* Inline order (prototype), in DOM order so Tab follows what is seen:
   Refined, page nav, slot actions, Source, Copy for AI, |, Connect, More,
   Edit, Fullscreen, Create. */

.viewer-header-sep {
  flex-shrink: 0;
  width: 1px;
  height: 16px;
  background: #E5E7EB;
}
.viewer-frame--fullscreen .viewer-header-sep { margin: 0 2px; }

.viewer-header-nav {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

/* Inline Refined toggle (pressed = refined layout showing). */
.viewer-refined-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 28px;
  height: 28px;
  box-sizing: border-box;
  padding: 0 8px;
  border: 1px solid var(--magic-border-strong);
  border-radius: var(--magic-radius);
  background: var(--magic-subtle);
  color: var(--magic-primary);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: opacity 200ms ease, background-color 200ms ease, color 200ms ease;
}
.viewer-refined-toggle--pressed {
  background: var(--magic-primary);
  border-color: var(--magic-primary);
  color: var(--magic-on-primary);
}
.viewer-refined-toggle--pressed:hover { background: var(--magic-primary-hover); }
.viewer-refined-toggle:focus-visible { outline: 2px solid var(--magic-primary); outline-offset: 2px; }
.viewer-refined-toggle:disabled { opacity: .5; cursor: not-allowed; }

.viewer-btn-create {
  color: #0052CC;
  background: #F0F6FF;
  border-color: #B3D4FF;
}
.viewer-btn-create:hover { background: #DEEBFF; border-color: #85B8FF; }


.magic-feedback {
  padding: 8px 20px;
  color: var(--magic-danger);
  background: var(--magic-subtle);
  border-bottom: 1px solid var(--magic-border);
  font-size: 12px;
}

.magic-disclosure {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 14px;
  padding: 8px 20px;
  border-bottom: 1px solid var(--magic-border);
  background: var(--magic-subtle);
  color: var(--magic-text);
  font-size: 12px;
}
.magic-layout-feedback { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-left: auto; }
.magic-layout-feedback button {
  min-height: 24px; padding: 2px 8px; border: 1px solid var(--magic-border-strong); border-radius: var(--magic-radius);
  color: var(--magic-text); background: var(--magic-surface);
}
.magic-layout-feedback button[aria-pressed="true"] { color: var(--magic-on-primary); background: var(--magic-primary); border-color: var(--magic-primary); }
.magic-layout-feedback button[aria-pressed="true"]:hover { background: var(--magic-primary-hover); }
.magic-layout-feedback button:focus-visible, .viewer-version-option:focus-visible { outline: 2px solid var(--magic-primary); outline-offset: 2px; }

/* Inline layout survey strip, directly under the header. */
.magic-inline-survey {
  display: flex;
  gap: 6px 10px;
  margin-left: 0;
  padding: 6px 12px;
  background: var(--magic-subtle);
  border-bottom: 1px solid var(--magic-border);
  color: var(--magic-text);
  font-size: 12px;
}
.magic-inline-survey-options { display: flex; align-items: center; gap: 6px; }
.magic-inline-survey button { font-family: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; }
.magic-inline-survey-thanks { color: var(--magic-text-soft); }

.viewer-version-switch { display: inline-flex; align-items: stretch; border: 1px solid var(--magic-border-strong); border-radius: var(--magic-radius); overflow: hidden; background: var(--magic-surface); }
.viewer-version-option { display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border: 0; background: transparent; color: var(--magic-text-soft); font-family: inherit; font-size: 12px; font-weight: 500; line-height: 1.3; cursor: pointer; transition: background-color 200ms ease, color 200ms ease; }
.viewer-version-option + .viewer-version-option { border-left: 1px solid var(--magic-border-strong); }
.viewer-version-option:hover:not(:disabled):not(.viewer-version-option--selected) { background: var(--magic-hover); }
.viewer-version-option--selected, .viewer-version-option--selected:hover { background: var(--magic-primary); color: var(--magic-on-primary); }
.viewer-version-option--selected:hover { background: var(--magic-primary-hover); }
.viewer-version-magic--available { color: var(--magic-primary); background: var(--magic-subtle); }
.viewer-version-option:disabled { opacity: .5; cursor: not-allowed; }
.viewer-magic-icon { width: 16px; height: 16px; flex: none; }

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

/* ----- Header buttons (staged-header prototype) ---------------------------
   28px controls in a 40px header (56px in Fullscreen). Icon-only buttons are
   28px squares. */
.viewer-top-actions .viewer-btn-ghost,
.viewer-top-actions .viewer-btn-primary {
  height: 28px;
  box-sizing: border-box;
  justify-content: center;
}
.viewer-top-actions .viewer-btn-ghost { padding: 0 8px; }
.viewer-top-actions .viewer-btn-primary { padding: 0 10px; }
.viewer-top-actions .viewer-btn-ghost:focus-visible { outline: 2px solid #0C66E4; outline-offset: 1px; }
.viewer-top-actions .viewer-btn-primary:focus-visible { outline: 2px solid #0C66E4; outline-offset: 2px; }

/* Inline Source and Copy for AI are icon-only at every stage; the Copy for AI
   sizer drops its inactive cells, and "Copied" shows as a green check. A
   transient text state (Copying… / Copy failed / Nothing to copy) still
   shows its words briefly. */
.viewer-frame:not(.viewer-frame--fullscreen) .viewer-act-source,
.viewer-frame:not(.viewer-frame--fullscreen) .viewer-act-connect-mcp,
.viewer-frame:not(.viewer-frame--fullscreen) .copy-for-ai-split-primary {
  min-width: 28px;
  padding: 0;
  color: #6B7280;
}
.viewer-frame:not(.viewer-frame--fullscreen) .viewer-act-source:hover,
.viewer-frame:not(.viewer-frame--fullscreen) .viewer-act-connect-mcp:hover,
.viewer-frame:not(.viewer-frame--fullscreen) .copy-for-ai-split-primary:hover { color: #374151; }
.viewer-frame:not(.viewer-frame--fullscreen) .viewer-act-copy { margin-left: -4px; }
.viewer-frame:not(.viewer-frame--fullscreen) .viewer-act-source .viewer-btn-label,
.viewer-frame:not(.viewer-frame--fullscreen) .viewer-act-connect-mcp .viewer-btn-label,
.viewer-frame:not(.viewer-frame--fullscreen) .viewer-act-copy .viewer-btn-label,
.viewer-frame:not(.viewer-frame--fullscreen) .viewer-act-copy .copy-for-ai-label-cell[data-active="false"],
.viewer-frame:not(.viewer-frame--fullscreen) .viewer-act-copy .copy-for-ai-label-cell svg + span { display: none; }
.viewer-frame:not(.viewer-frame--fullscreen) .viewer-act-copy .copy-for-ai-label-cell > span:only-child { padding: 0 6px; }
.copy-for-ai-split-primary[data-copy-state="copied"] .viewer-icon { color: #36B37E; }

/* Staged collapse (data-stage on .viewer-frame, set by updateHeaderStage).
   1: Edit + Refined → icon. 2: Fullscreen → icon. 3: Source + Copy for AI
   move into More (the Copy for AI wrapper stays mounted, visually hidden,
   so its live region still announces a copy started from the menu). */
.viewer-frame[data-stage="1"] .viewer-act-edit .viewer-btn-label,
.viewer-frame[data-stage="2"] .viewer-act-edit .viewer-btn-label,
.viewer-frame[data-stage="3"] .viewer-act-edit .viewer-btn-label,
.viewer-frame[data-stage="1"] .viewer-refined-toggle .viewer-btn-label,
.viewer-frame[data-stage="2"] .viewer-refined-toggle .viewer-btn-label,
.viewer-frame[data-stage="3"] .viewer-refined-toggle .viewer-btn-label,
.viewer-frame[data-stage="2"] .viewer-act-fullscreen .viewer-btn-label,
.viewer-frame[data-stage="3"] .viewer-act-fullscreen .viewer-btn-label { display: none; }
.viewer-frame[data-stage="1"] .viewer-act-edit,
.viewer-frame[data-stage="2"] .viewer-act-edit,
.viewer-frame[data-stage="3"] .viewer-act-edit,
.viewer-frame[data-stage="2"] .viewer-act-fullscreen,
.viewer-frame[data-stage="3"] .viewer-act-fullscreen { width: 28px; padding: 0; }
.viewer-frame[data-stage="1"] .viewer-refined-toggle,
.viewer-frame[data-stage="2"] .viewer-refined-toggle,
.viewer-frame[data-stage="3"] .viewer-refined-toggle { padding: 0; }
.viewer-frame[data-stage="3"] .viewer-act-source,
.viewer-frame[data-stage="3"] .viewer-act-connect-mcp,
.viewer-frame[data-stage="3"] .viewer-act-sep,
.viewer-frame[data-stage="3"] .viewer-act-copy > .copy-for-ai-split-primary,
.viewer-frame[data-stage="3"] .viewer-act-copy > .copy-for-ai-menu { display: none; }
.viewer-frame[data-stage="3"] .viewer-act-copy {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* ----- Fullscreen header actions -----------------------------------------
   Labels by viewport (the modal is the viewport): >= 1280px every action is
   labelled; 1100-1279px only Source and Copy for AI; below 1100px all are
   icon-only and the version switch reads Refined / Original. */
.viewer-fs-act .viewer-icon { color: #6B7280; flex-shrink: 0; }
.viewer-frame--fullscreen .viewer-fs-act { min-width: 28px; padding: 0; }
.viewer-frame--fullscreen .viewer-fs-act .viewer-btn-label { display: none; }
@media (min-width: 1280px) {
  .viewer-frame--fullscreen .viewer-fs-act { padding: 0 8px; }
  .viewer-frame--fullscreen .viewer-fs-act .viewer-btn-label { display: inline; }
}
@media (max-width: 1099px) {
  .viewer-frame--fullscreen .viewer-act-source,
  .viewer-frame--fullscreen .copy-for-ai-split-primary { min-width: 28px; padding: 0; }
  .viewer-frame--fullscreen .viewer-act-source .viewer-btn-label,
  .viewer-frame--fullscreen .viewer-act-copy .viewer-btn-label,
  .viewer-frame--fullscreen .viewer-act-copy .copy-for-ai-label-cell[data-active="false"],
  .viewer-frame--fullscreen .viewer-act-copy .copy-for-ai-label-cell svg + span,
  .viewer-frame--fullscreen .viewer-version-long { display: none; }
}
.viewer-fs-exit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #44546F;
  cursor: pointer;
}
.viewer-fs-exit svg { width: 20px; height: 20px; }
.viewer-fs-exit:hover { background: #F3F4F6; color: #172B4D; }
.viewer-fs-exit:focus-visible { outline: 2px solid #0C66E4; outline-offset: 1px; }

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
/* Fullscreen Viewer v2: the byline belongs to the diagram, not to the window.
   It used to be a full-width white bar pinned to the bottom of the viewport,
   which read as a status bar and left it stranded far below a short diagram.
   In flow at the end of the canvas column it sits directly under the unit and
   shares its right edge, because both fill the same 24px-padded content box. */
.viewer-frame--fullscreen .viewer-footer-row {
  position: static;
  flex: 0 0 auto;
}
.viewer-frame--fullscreen .viewer-footer-row :deep(.diagram-attribution) {
  padding: 10px 0 0;
}

.viewer-body--with-sidebar { display: flex; }
.viewer-frame--fullscreen .viewer-body--with-sidebar { flex-direction: row; }
.viewer-body--with-sidebar > .viewer-surface { flex: 1 1 auto; min-width: 0; }
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
